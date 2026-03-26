# wechat-claude

[中文文档](README.zh-CN.md)

WeChat-to-Claude bridge via iLink protocol. Send messages to your WeChat bot, get responses from Claude.

## Features

- **Text messaging** — Send text, receive Claude's response
- **Image vision** — Send images, Claude analyzes them via Vision API
- **Voice transcription** — Voice messages auto-transcribed and forwarded
- **Multi-user** — Up to 10 concurrent users, each with independent conversation
- **Conversation memory** — Sliding window history (50 turns), reset with `/reset`
- **Auto text splitting** — Long responses split into multiple WeChat messages

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set API key
export ANTHROPIC_API_KEY=sk-ant-xxxxx

# 3. Run (first time will show QR code for WeChat login)
npm run dev
```

Scan the QR code with WeChat. Once logged in, send a message to your bot account to start chatting with Claude.

## Chat Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history |
| `/new` | Same as `/reset` |
| `/clear` | Same as `/reset` |

## Configuration

See [docs/usage.md](docs/usage.md) for full configuration reference.

## Architecture

See [docs/architecture.md](docs/architecture.md) for system design and module details.

## Development

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npx tsc --noEmit

# Build
npm run build
```

## License

MIT
