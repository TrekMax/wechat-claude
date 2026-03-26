# wechat-claude

通过 iLink 协议实现的微信-Claude 桥接服务。向你的微信机器人发送消息，即可获得 Claude 的回复。

## 功能特性

- **双模式运行** — API 模式（轻量聊天）或 ACP 模式（完整 Claude Code 智能体）
- **文本消息** — 发送文本，接收 Claude 的回复
- **图片识别** — 发送图片，Claude 通过 Vision API 进行分析
- **语音转写** — 语音消息自动转文字后转发给 Claude
- **多用户支持** — 最多 10 个并发用户，各自拥有独立对话
- **对话记忆** — 滑动窗口历史记录（50 轮），发送 `/reset` 可重置
- **ACP 智能体支持** — Claude Code、Copilot、Gemini 或任何 ACP 兼容的智能体
- **长文本自动分段** — 超长回复自动拆分为多条微信消息

## 快速开始

### API 模式（轻量聊天）

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP 模式（完整 Claude Code 智能体）

```bash
npm install
npm run dev -- --agent claude
```

使用微信扫描终端中的二维码完成登录。登录成功后，向你的机器人账号发送消息即可开始对话。

## 聊天指令

| 指令 | 说明 |
|------|------|
| `/reset` | 清空对话历史 |
| `/new` | 同 `/reset` |
| `/clear` | 同 `/reset` |

## 配置说明

完整配置参考请查看 [docs/usage.zh-CN.md](docs/usage.zh-CN.md)。

## 系统架构

系统设计与模块详情请查看 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 开发

```bash
# 运行测试
npm test

# 监听模式运行测试
npm run test:watch

# 类型检查
npx tsc --noEmit

# 构建
npm run build
```

## 许可证

MIT
