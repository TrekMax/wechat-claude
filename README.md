# wechat-claude

[中文文档](README.zh-CN.md)

WeChat-to-Claude bridge via iLink protocol. Send messages to your WeChat bot, get responses from Claude.

## Features

- **Dual mode** — API mode (lightweight chat) or ACP mode (full Claude Code agent)
- **Text messaging** — Send text, receive Claude's response
- **Image vision** — Send images, Claude analyzes them via Vision API
- **Voice transcription** — Voice messages auto-transcribed and forwarded
- **Multi-user** — Up to 10 concurrent users, each with independent conversation
- **Conversation memory** — Sliding window history (50 turns), reset with `/reset`
- **ACP agent support** — Claude Code, Copilot, Gemini, or any ACP-compatible agent
- **Auto text splitting** — Long responses split into multiple WeChat messages

## Quick Start

### API Mode (lightweight chat)

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP Mode (full Claude Code agent)

```bash
npm install
npm run dev -- --agent claude
```

Scan the QR code with WeChat. Once logged in, send a message to your bot account to start chatting.

## Chat Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history |
| `/new` | Same as `/reset` |
| `/clear` | Same as `/reset` |

### Multi-Task Parallel (ACP mode)

| Command | Description |
|---------|-------------|
| `/task new [desc]` | Create a new parallel task |
| `/task list` | List all active tasks |
| `/task <id>` | Switch active task |
| `/task end [id]` | End a task |

Run multiple agent tasks concurrently — each gets its own independent Claude context.

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
