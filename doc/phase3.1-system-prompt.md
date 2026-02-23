# Phase 3.1: 系统提示词配置

## 目标

实现 **Layer 1: Agent 角色与规则**，让每个 Agent 拥有可配置的角色定义，并通过 Claude CLI 的 `--append-system-prompt` 或 `--append-system-prompt-file` 将角色信息注入 system prompt，保持 user prompt 纯净。

## 设计要点

### 1. 数据结构扩展

#### agents 表新增字段

```sql
ALTER TABLE agents ADD COLUMN role TEXT DEFAULT '';
ALTER TABLE agents ADD COLUMN responsibilities TEXT DEFAULT '[]';  -- JSON 数组
ALTER TABLE agents ADD COLUMN system_prompt TEXT DEFAULT '';  -- 自定义 system prompt 片段
```

#### 示例数据

```javascript
{
  id: 1,
  name: "Claude CLI",
  builtin_key: "claude-cli",
  role: "架构师",
  responsibilities: JSON.stringify([
    "代码审查",
    "架构设计", 
    "技术决策",
    "性能优化建议"
  ]),
  system_prompt: "你是一个专业的软件架构师。注重代码质量、可维护性和性能。回答时优先提供代码示例。"
}
```

### 2. System Prompt 模板

#### 默认模板

```javascript
const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `
# Agent 角色定义

## 名称
{agent_name}

## 角色
{role}

## 职责
{responsibilities}

## 上下文
你正在参与一个多 Agent 协作对话。对话中可能有其他 Agent（如 Opencode CLI），你们需要共同协作完成任务。

{custom_system_prompt}

## 行为准则
1. 基于你的专业领域提供高质量回答
2. 如果问题超出你的专业范围，明确说明
3. 保持回答简洁，除非需要详细解释
4. 尊重其他 Agent 的专业领域
`;
```

### 3. Claude CLI 调用方式变更

#### 当前方式（问题）

```javascript
// agentRunner.js - 当前实现
const enrichedPrompt = `${prompt} - 上下文: ${memoryContext}`;
spawn('claude', ['-p', enrichedPrompt, ...]);
```

#### 新方式（Phase 3.1）

```javascript
// agentRunner.js - Phase 3.1
const systemPrompt = buildSystemPrompt(agent);  // Layer 1
const userPrompt = prompt;  // 仅用户输入，纯净

// 方式 1：短 system prompt 直接传参
if (systemPrompt.length < 2000) {
  spawn('claude', [
    '--append-system-prompt', sanitizeForShell(systemPrompt),
    '-p', userPrompt,
    ...otherArgs
  ]);
}

// 方式 2：长 system prompt 写入临时文件
else {
  const tmpFile = writeTempFile(systemPrompt);
  spawn('claude', [
    '--append-system-prompt-file', tmpFile,
    '-p', userPrompt,
    ...otherArgs
  ]);
  // 进程退出后清理临时文件
}
```

### 4. Opencode CLI 处理

Opencode CLI 暂不支持单次运行的 system prompt 注入，采用以下策略：

```javascript
// Opencode: 将角色信息作为受控前缀
const rolePrefix = `[${agent.name} - ${agent.role}] `;
const fullPrompt = rolePrefix + userPrompt;
```

## 实现步骤

### Step 1: 数据库迁移

```javascript
// server/db.js

// 新增字段
try {
  db.run('ALTER TABLE agents ADD COLUMN role TEXT DEFAULT ""');
  save();
} catch { /* column exists */ }

try {
  db.run('ALTER TABLE agents ADD COLUMN responsibilities TEXT DEFAULT "[]"');
  save();
} catch { /* column exists */ }

try {
  db.run('ALTER TABLE agents ADD COLUMN system_prompt TEXT DEFAULT ""');
  save();
} catch { /* column exists */ }

// 为内置 Agent 设置默认角色
const defaultRoles = {
  'claude-cli': {
    role: '架构师',
    responsibilities: ['代码审查', '架构设计', '技术决策', '性能优化建议'],
    system_prompt: '你是一个专业的软件架构师。注重代码质量、可维护性和性能。'
  },
  'opencode-cli': {
    role: '开发者助手',
    responsibilities: ['代码生成', 'Bug 修复', '功能实现', '技术问答'],
    system_prompt: '你是一个高效的开发者助手。快速理解需求并提供可用的代码实现。'
  }
};

// 更新内置 Agent
for (const [key, config] of Object.entries(defaultRoles)) {
  db.run(
    'UPDATE agents SET role = ?, responsibilities = ?, system_prompt = ? WHERE builtin_key = ?',
    [config.role, JSON.stringify(config.responsibilities), config.system_prompt, key]
  );
}
```

### Step 2: System Prompt 构建器

```javascript
// server/services/systemPromptBuilder.js

import db from '../db.js';

export function buildSystemPrompt(agentId, conversationId = null) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return '';
  
  let responsibilities = [];
  try {
    responsibilities = JSON.parse(agent.responsibilities || '[]');
  } catch {
    responsibilities = [];
  }
  
  const template = `
# Agent 角色

## 名称
${agent.name}

## 角色
${agent.role || '通用助手'}

## 职责
${responsibilities.map(r => `- ${r}`).join('\n')}

## 自定义指令
${agent.system_prompt || '无'}

## 协作上下文
你正在参与一个多 Agent 协作对话。请基于你的专业领域提供回答。
`;

  return template.trim();
}

/**
 * 安全化字符串用于命令行参数
 * 建议优先使用临时文件，避免 shell 转义问题
 */
export function sanitizeForShell(str) {
  if (!str) return '""';
  // 替换双引号为转义双引号
  return '"' + str.replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

/**
 * 写入临时文件用于 --append-system-prompt-file
 */
export function writeSystemPromptFile(content) {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `claude-system-${Date.now()}.txt`);
  
  fs.writeFileSync(tmpFile, content, 'utf8');
  return tmpFile;
}
```

### Step 3: 修改 agentRunner

```javascript
// server/services/agentRunner.js

import { buildSystemPrompt, writeSystemPromptFile } from './systemPromptBuilder.js';

export function runClaudeCli(agentId, prompt, onOutput, onExit, conversationId) {
  // ... 现有检查逻辑 ...
  
  // 构建 system prompt (Layer 1)
  const systemPrompt = buildSystemPrompt(agentId, conversationId);
  
  // 记忆上下文 (Layer 3) - 暂时保留现有逻辑
  const memoryContext = memoryManager.buildAgentContext(agentId, conversationId);
  
  // Layer 4: 纯净用户输入
  const userPrompt = prompt;
  
  logger.log('[agentRunner] runClaudeCli() systemPrompt=%d chars, userPrompt=%d chars',
    systemPrompt.length, userPrompt.length);
  
  // 决定注入方式
  let systemPromptFile = null;
  const useFile = systemPrompt.length > 2000 || containsSpecialChars(systemPrompt);
  
  if (useFile) {
    systemPromptFile = await writeSystemPromptFile(systemPrompt);
  }
  
  const args = [
    ...sessionConfig.args,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits'
  ];
  
  if (useFile) {
    args.push('--append-system-prompt-file', systemPromptFile);
  } else {
    args.push('--append-system-prompt', systemPrompt);
  }
  
  args.push('-p', userPrompt);
  
  const child = spawn('claude', args, { ... });
  
  // 清理临时文件
  child.on('exit', () => {
    if (systemPromptFile) {
      fs.unlinkSync(systemPromptFile);
    }
  });
  
  // ...
}

function containsSpecialChars(str) {
  // 检测可能导致 Windows shell 问题的字符
  return /[()&|<>^]/.test(str);
}
```

### Step 4: 前端配置界面

```jsx
// client/components/AgentConfigPanel.jsx

function AgentConfigPanel({ agent, onSave }) {
  const [role, setRole] = useState(agent.role || '');
  const [responsibilities, setResponsibilities] = useState(
    JSON.parse(agent.responsibilities || '[]').join('\n')
  );
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt || '');
  
  const handleSave = async () => {
    const respArray = responsibilities.split('\n').filter(r => r.trim());
    await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        responsibilities: JSON.stringify(respArray),
        system_prompt: systemPrompt
      })
    });
    onSave();
  };
  
  return (
    <div className="agent-config">
      <h3>Agent 角色配置</h3>
      
      <label>角色</label>
      <input value={role} onChange={e => setRole(e.target.value)}
             placeholder="如：架构师、前端专家、测试工程师" />
      
      <label>职责（每行一个）</label>
      <textarea value={responsibilities} 
                onChange={e => setResponsibilities(e.target.value)}
                placeholder="代码审查&#10;架构设计&#10;技术决策" />
      
      <label>自定义 System Prompt</label>
      <textarea value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                placeholder="输入自定义的系统级指令..." />
      
      <button onClick={handleSave}>保存</button>
    </div>
  );
}
```

### Step 5: API 扩展

```javascript
// server/routes/agents.js

// 扩展 PATCH 接口支持新字段
router.patch('/:id', (req, res) => {
  const { name, cli_command, cli_cwd, role, responsibilities, system_prompt } = req.body;
  
  const updates = [];
  const values = [];
  
  if (name !== undefined) { updates.push('name = ?'); values.push(name); }
  if (cli_command !== undefined) { updates.push('cli_command = ?'); values.push(cli_command); }
  if (cli_cwd !== undefined) { updates.push('cli_cwd = ?'); values.push(cli_cwd); }
  if (role !== undefined) { updates.push('role = ?'); values.push(role); }
  if (responsibilities !== undefined) { updates.push('responsibilities = ?'); values.push(responsibilities); }
  if (system_prompt !== undefined) { updates.push('system_prompt = ?'); values.push(system_prompt); }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  values.push(req.params.id);
  
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ success: true });
});
```

## 测试计划

### 单元测试

```javascript
// test/unit/systemPromptBuilder.test.js

describe('SystemPromptBuilder', () => {
  test('should build system prompt from agent config', () => {
    const prompt = buildSystemPrompt(1);  // Claude CLI
    expect(prompt).toContain('Claude CLI');
    expect(prompt).toContain('架构师');
    expect(prompt).toContain('代码审查');
  });
  
  test('should handle missing responsibilities', () => {
    // Agent with no responsibilities
    const prompt = buildSystemPrompt(mockAgentWithEmptyConfig);
    expect(prompt).toContain('通用助手');
  });
  
  test('should sanitize special chars', () => {
    const sanitized = sanitizeForShell('Hello (world) & "quotes"');
    expect(sanitized).not.toMatch(/[()&]/);
  });
});
```

### 集成测试

```javascript
// test/integration/claude-system-prompt.test.js

describe('Claude CLI System Prompt', () => {
  test('should pass system prompt via --append-system-prompt-file', async () => {
    // 设置 Agent 角色
    await updateAgent(1, { role: '测试专家', system_prompt: '你是一个测试助手' });
    
    // 调用 runClaudeCli
    const output = await runClaudeCliWithPrompt(1, '你好');
    
    // 验证 Claude 响应体现了角色设定
    expect(output).toMatch(/测试|助手|验证/);
  });
});
```

## 验收标准

- [ ] `agents` 表新增 `role`, `responsibilities`, `system_prompt` 字段
- [ ] 内置 Agent（Claude CLI, Opencode CLI）有默认角色配置
- [ ] Claude CLI 使用 `--append-system-prompt` 或 `--append-system-prompt-file` 注入角色
- [ ] Opencode CLI 使用前缀模式注入角色
- [ ] 前端可配置 Agent 角色、职责、自定义 system prompt
- [ ] System prompt 内容写入临时文件，避免 Windows shell 问题
- [ ] 临时文件在进程退出后自动清理

## 后续优化

1. **角色模板库** - 预设常见角色（架构师、前端、后端、测试、DevOps）
2. **角色继承** - Agent 可继承基础角色并覆盖部分配置
3. **动态角色** - 根据对话内容自动切换角色侧重点
4. **角色验证** - 验证 system prompt 长度、格式

## 相关文档

- [Phase 3 总体设计](./phase3.md)
- [共识分层 Prompt 设计](./design-共识分层-prompt.md)
