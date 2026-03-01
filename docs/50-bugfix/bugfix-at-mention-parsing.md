# Bugfix: @Agent 解析失败问题

## 问题描述

用户输入 `@Claude CLI 你好` 时，系统弹窗提示"请使用 @AgentName 指定要对话的 Agent"，无法正确识别 Agent。

## 根本原因

原有的解析正则表达式 `^@(\S+)\s*` 只能匹配不含空格的名称：

```javascript
// 原代码
const match = text.match(/^@(\S+)\s*/);
// 输入 "@Claude CLI 你好"
// match[1] = "Claude"  ← 只匹配到空格前的部分
// 找不到名为 "Claude" 的 Agent，返回 null
```

由于 Agent 名称 "Claude CLI" 包含空格，正则只匹配到 "Claude"，导致查找失败。

## 解决方案

重写解析函数，改用遍历匹配方式：

```javascript
const parseTargetAgent = (text) => {
  if (!text.startsWith('@')) return null;

  const textWithoutAt = text.slice(1);
  // 按名称长度降序排序，优先匹配最长的名称
  const sortedAgents = [...agents].sort((a, b) => b.name.length - a.name.length);

  for (const agent of sortedAgents) {
    const nameLower = agent.name.toLowerCase();
    const textLower = textWithoutAt.toLowerCase();

    if (textLower.startsWith(nameLower)) {
      const afterName = textWithoutAt.slice(agent.name.length);
      // 名称后必须是空格或字符串结尾
      if (afterName === '' || afterName.startsWith(' ')) {
        return { agent, textWithoutMention: afterName.trimStart() };
      }
    }
  }
  return null;
};
```

### 算法说明

1. **长度优先**: 按 Agent 名称长度降序排序，避免短名称误匹配
   - 例如有 "Claude" 和 "Claude CLI" 两个 Agent
   - 输入 "@Claude CLI hello" 应匹配 "Claude CLI" 而非 "Claude"

2. **边界检查**: 名称后必须是空格或字符串结尾
   - "@Claude123" 不会匹配 "Claude"
   - "@Claude " 会匹配 "Claude"

3. **大小写不敏感**: 使用 `toLowerCase()` 进行比较

## 附加改进

移除强制要求 `@` Agent 的限制，允许发送普通消息：

```javascript
// 原代码
if (!parsed) {
  alert('请使用 @AgentName 指定要对话的 Agent');
  return;
}

// 新代码
if (parsed) {
  // 发送给指定 Agent
} else {
  // 保存为普通消息，不触发 Agent
}
```

## 测试用例

| 输入 | 期望结果 |
|------|----------|
| `@Claude CLI 你好` | 匹配 "Claude CLI"，消息 "你好" |
| `@claude cli 你好` | 匹配 "Claude CLI"（大小写不敏感） |
| `@Opencode CLI test` | 匹配 "Opencode CLI"，消息 "test" |
| `@NotExist hello` | 无匹配，保存为普通消息 |
| `普通消息` | 无 @，保存为普通消息 |
| `@Claude CLI` | 匹配但消息为空，提示输入内容 |

## 影响范围

- `client/components/ChatPanel.jsx` - 解析逻辑和发送逻辑
- 无后端变更
- 无数据库变更
