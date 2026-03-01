# Phase 3.2 Agent Soul 功能测试

## 测试环境
- 服务器: http://localhost:3000
- 前端: http://localhost:5175

## 测试步骤

### 1. 后端 API 测试

#### 1.1 获取 Soul 模板列表
```bash
curl http://localhost:3000/api/agents/soul-templates
```

预期结果: 返回 6 个模板（architect, frontend_expert, devops, tester, backend_engineer, product_manager）

#### 1.2 获取 Agent 的 Soul 配置
```bash
curl http://localhost:3000/api/agents/1/soul
```

预期结果: 返回空对象 `{}` 或已有的 Soul 配置

#### 1.3 应用模板到 Agent
```bash
curl -X POST http://localhost:3000/api/agents/1/soul/apply-template \
  -H "Content-Type: application/json" \
  -d '{"templateName": "architect"}'
```

预期结果: 返回架构师模板的 Soul 配置

#### 1.4 更新 Soul 配置
```bash
curl -X PUT http://localhost:3000/api/agents/1/soul \
  -H "Content-Type: application/json" \
  -d '{
    "personality": {
      "traits": ["专业", "严谨"],
      "tone": "formal",
      "emoji_usage": "minimal"
    }
  }'
```

预期结果: 返回更新后的 Soul 配置

### 2. 前端 UI 测试

#### 2.1 打开 Soul 配置面板
1. 访问 http://localhost:5175
2. 在右侧 Agent 列表中，点击任意 Agent 的 "Soul" 按钮
3. 应该弹出 Soul 配置面板

#### 2.2 应用模板
1. 在 Soul 配置面板中，选择一个模板（如 "🏗️ 架构师"）
2. 配置应该自动填充模板内容

#### 2.3 自定义配置
1. 修改性格特点、专业领域等字段
2. 点击"保存配置"按钮
3. 应该显示保存成功提示

#### 2.4 验证 System Prompt 生成
1. 保存 Soul 配置后
2. 使用该 Agent 发送消息
3. Agent 的回答应该体现出配置的性格和风格

### 3. System Prompt 构建测试

#### 3.1 测试 Soul Prompt Builder
```bash
cd /d/jsproject/co_agent
node -e "
import('./server/services/soulPromptBuilder.js').then(m => {
  const agent = {
    name: 'Test Agent',
    role: '架构师',
    soul: {
      personality: {
        traits: ['专业', '严谨'],
        tone: 'formal',
        emoji_usage: 'minimal'
      },
      expertise: {
        primary: ['系统架构', '设计模式'],
        level: 'senior'
      }
    }
  };
  const prompt = m.buildSoulSystemPrompt(agent);
  console.log(prompt);
});
"
```

预期结果: 输出格式化的 System Prompt，包含性格特征、专业领域等信息

### 4. 集成测试

#### 4.1 完整流程测试
1. 创建一个新 Agent 或选择现有 Agent
2. 点击 "Soul" 按钮打开配置面板
3. 选择 "🎨 前端专家" 模板
4. 修改部分配置（如添加自定义指令）
5. 保存配置
6. 在聊天窗口中 @该 Agent 提问
7. 观察 Agent 的回答风格是否符合配置

#### 4.2 多 Agent 不同 Soul 测试
1. 为 Agent A 配置 "架构师" Soul（正式、严谨）
2. 为 Agent B 配置 "前端专家" Soul（友好、详细）
3. 分别向两个 Agent 提问相同问题
4. 观察回答风格的差异

## 验收标准

- [ ] 后端 API 端点全部正常工作
- [ ] Soul 模板可以正确应用
- [ ] Soul 配置可以保存和读取
- [ ] Soul 配置面板 UI 正常显示和交互
- [ ] Soul 配置能正确转换为 System Prompt
- [ ] Agent 回答体现出配置的性格和风格
- [ ] 数据库 `agents` 表包含 `soul` 字段

## 已知问题

无

## 后续优化

1. 添加 Soul 配置预览功能（显示生成的 System Prompt）
2. 支持导入/导出 Soul 配置
3. 添加更多预设模板
4. Soul 配置版本管理
