# 待处理 Issue: PayloadTooLargeError

## 状态
⏳ 待处理

## 问题描述

在开发过程中，当请求体过大时，服务器返回 `PayloadTooLargeError`：

```
PayloadTooLargeError: request entity too large
    at readStream (D:\jsproject\co_agent\node_modules\raw-body\index.js:163:17)
    at getRawBody (D:\jsproject\co_agent\node_modules\raw-body\index.js:116:12)
    at read (D:\jsproject\co_agent\node_modules\body-parser\lib\read.js:79:3)
    at jsonParser (D:\jsproject\co_agent\node_modules\body-parser\lib\types\json.js:138:5)
    ...
```

## 原因分析

Express 的 `body-parser` 中间件默认限制请求体大小为 `100kb`。当发送大型消息（如长对话内容、大量代码等）时会触发此限制。

## 复现场景

发送内容较长的消息到 API 端点时触发。

## 解决方案

在 `server/index.js` 中增加 body-parser 的限制：

```javascript
// 当前
app.use(express.json());

// 修改为
app.use(express.json({ limit: '10mb' }));
```

## 相关文件

- `server/index.js`

## 优先级

中等 - 影响用户体验，但有简单解决方案

## 备注

- GitHub MCP token 权限问题待解决后再创建正式 issue
