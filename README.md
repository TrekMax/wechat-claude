# wechat-claude

[中文文档](README.zh-CN.md)

WeChat-to-Claude bridge via iLink protocol. Send messages to your WeChat bot, get responses from Claude.

## Features

- **Dual mode** — API mode (lightweight chat) or ACP mode (full agent)
- **Text messaging** — Send text, receive Claude's response
- **Image vision** — Send images, Claude analyzes them via Vision API
- **Voice transcription** — Voice messages auto-transcribed and forwarded
- **Multi-user** — Up to 10 concurrent users, each with independent conversation
- **Conversation memory** — Sliding window history (50 turns), reset with `/reset`
- **ACP agent support** — Claude Code, Copilot, Gemini, Codex, or any ACP-compatible agent
- **Auto text splitting** — Long responses split into multiple WeChat messages

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **pnpm**
- A **WeChat** account (for QR code login)
- **API key** depending on mode:
  - API mode: `ANTHROPIC_API_KEY`
  - ACP mode (Claude): `ANTHROPIC_API_KEY`
  - ACP mode (Codex): `OPENAI_API_KEY`
  - ACP mode (Gemini): `GEMINI_API_KEY`
  - ACP mode (Copilot): GitHub Copilot subscription

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/anthropics/wechat-claude.git
cd wechat-claude

# 2. Install dependencies
npm install

# 3. Copy environment template and fill in your keys
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY (for API mode)

# 4. Build (optional, for production use)
npm run build
```

## Quick Start

### API Mode (lightweight chat)

Direct Claude API calls. Best for simple text/image conversations.

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP Mode (full agent)

Spawns an agent subprocess with full capabilities (code editing, file ops, tools).

```bash
# Claude Code agent
npm run dev -- --agent claude

# OpenAI Codex agent
export OPENAI_API_KEY=sk-xxxxx
npm run dev -- --agent codex

# GitHub Copilot agent
npm run dev -- --agent copilot

# Gemini CLI agent
npm run dev -- --agent gemini

# Custom agent command
npm run dev -- --agent "npx my-custom-agent --acp"
```

### ACP Mode Options

```bash
# Specify working directory for the agent
npm run dev -- --agent claude --cwd ~/projects/myapp

# Set model (writes to .claude/settings.json for Claude Code)
npm run dev -- --agent claude --model haiku

# Show agent thinking process in chat
npm run dev -- --agent claude --show-thoughts

# Combine options
npm run dev -- --agent codex --cwd ~/projects/myapp --show-thoughts --debug
```

Scan the QR code with WeChat when prompted. Once logged in, send a message to your bot account to start chatting.

### Production

```bash
npm run build
npm start
# or with ACP:
npm start -- --agent claude --cwd ~/projects/myapp
```

## Built-in Agent Presets

| Preset | Agent | Package | Required Env |
|--------|-------|---------|-------------|
| `claude` | Claude Code | `@zed-industries/claude-code-acp` | `ANTHROPIC_API_KEY` |
| `codex` | OpenAI Codex | `@zed-industries/codex-acp` | `OPENAI_API_KEY` |
| `copilot` | GitHub Copilot | `@github/copilot` | GitHub Copilot subscription |
| `gemini` | Gemini CLI | `@google/gemini-cli` | `GEMINI_API_KEY` |

Agent packages are fetched automatically via `npx` on first run.

## Chat Commands

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history |
| `/new` | Same as `/reset` |
| `/clear` | Same as `/reset` |
| `/model` | Show current model |
| `/model <name>` | Switch model |
| `/status` | Show session info |
| `/debug on\|off` | Toggle debug logging |
| `/help` | Show available commands |

### Multi-Task Parallel (ACP mode)

| Command | Description |
|---------|-------------|
| `/task new [desc]` | Create a new parallel task |
| `/task list` | List all active tasks |
| `/task <id>` | Switch active task |
| `/task end [id]` | End a task |
| `/show-thoughts` | Toggle thinking display |

Run multiple agent tasks concurrently — each gets its own independent agent context.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | API mode | — | Anthropic API key |
| `OPENAI_API_KEY` | Codex ACP | — | OpenAI API key |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model (API mode) |
| `CLAUDE_MAX_TOKENS` | No | `4096` | Max response tokens (API mode) |
| `CLAUDE_SYSTEM_PROMPT` | No | Default prompt | System prompt (API mode) |
| `WEIXIN_BASE_URL` | No | `https://ilinkai.weixin.qq.com` | WeChat iLink API URL |
| `MAX_CONCURRENT_USERS` | No | `10` | Max simultaneous users |
| `SESSION_IDLE_TIMEOUT_HOURS` | No | `24` | Session expiry (hours) |

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

# Test coverage
npm run test:coverage

# Type check
npx tsc --noEmit

# Build
npm run build
```

## License

MIT
