# Bugfix: Windows Shell 特殊字符导致 Claude CLI Prompt 丢失

## 问题描述

通过页面调用 `@Claude CLI` 时，无论问什么问题，Claude 都返回 "你好！有什么我可以帮你的吗？"（默认问候语），而不是回答实际问题。

## 症状

- 直接在终端运行 `claude -p "2+2=多少"` → 正确回答
- 通过 `node minimal-claude.js "2+2=多少"` → 正确回答
- 通过页面 `@Claude CLI 2+2=多少` → 返回默认问候语

## 调试过程

### 1. 初步怀疑：Session 污染

最初怀疑是 `--resume` 恢复了被污染的会话（包含 Claude Code/Kiro 系统提示）。

**验证**：删除数据库中的 session 记录，创建新 session，问题依旧。

**结论**：排除 session 污染。

### 2. 添加调试日志

在 `minimal-claude.js` 中添加日志打印实际提取的文本：

```javascript
console.log('[minimal-claude] Extracted text:', JSON.stringify(block.text));
```

**发现**：Claude 确实返回了 "你好！有什么我可以帮你的吗？"，说明它收到的是空 prompt 或无效 prompt。

### 3. 对比 prompt 内容

| 场景 | Prompt | 结果 |
|------|--------|------|
| 直接运行 | `"2+2=多少"` | 正确 |
| 页面调用 | `"请回答: 2+2=多少 (背景: 之前用户问过: \"2+2=多少\")"` | 错误 |

**关键差异**：页面调用的 prompt 包含括号 `()` 和引号 `"`。

### 4. 简化 prompt 测试

临时禁用 memoryContext，直接使用原始 prompt：

```javascript
const enrichedPrompt = prompt;  // 不添加上下文
```

**结果**：`@Claude CLI 2+2=多少` 正确返回 "4"。

**结论**：问题出在 enrichedPrompt 中的特殊字符。

## 根本原因

**Windows `cmd.exe` 对括号 `()` 有特殊处理**。

当使用 `spawn('claude', args, { shell: true })` 时，Node.js 会通过 `cmd.exe` 执行命令。`cmd.exe` 将括号视为命令分组符号，导致 prompt 被截断或解析错误。

原始 enrichedPrompt：
```
请回答: 2+2=多少 (背景: 之前用户问过: "2+2=多少" "2+2=多少" "2+2=多少")
```

`cmd.exe` 可能将 `(背景: ...)` 解析为子命令，导致实际传给 Claude 的 prompt 为空或不完整。

## 解决方案

### 1. 修改 prompt 格式，避免使用括号和引号

**agentRunner.js**:
```javascript
// 修改前
enrichedPrompt = `请回答: ${prompt} (背景: ${memoryContext})`;

// 修改后
enrichedPrompt = `${prompt} - 上下文: ${memoryContext}`;
```

**memoryManager.js**:
```javascript
// 修改前
return `"${title}"`;

// 修改后（移除引号）
return title;
```

### 2. 最终 prompt 格式

```
2+2=多少 - 上下文: 之前用户问过 2+2=多少 2+2=多少 2+2=多少
```

## 受影响的文件

- `server/services/agentRunner.js` - enrichedPrompt 格式
- `server/services/memoryManager.js` - buildAgentContext 返回格式

## 经验教训

1. **Windows shell 特殊字符**：在 Windows 上使用 `shell: true` 时，要避免以下字符：
   - 括号 `()` - 命令分组
   - 引号 `"` - 字符串界定
   - `&` `|` `<` `>` - 管道和重定向
   - `^` - 转义字符

2. **调试方法**：
   - 添加日志打印实际收到的响应内容
   - 逐步简化 prompt，定位问题字符
   - 对比不同调用方式的差异

3. **跨平台兼容**：
   - 尽量避免在动态构建的命令参数中使用特殊字符
   - 如必须使用，考虑平台特定的转义方式

## 相关 Issue

- Node.js DEP0190 警告：`Passing args to a child process with shell option true can lead to security vulnerabilities`
- 这个警告提示了 `shell: true` 模式下参数不会被转义，只是简单拼接

## 测试用例

见 `test/claude-cli-prompt.test.js`
