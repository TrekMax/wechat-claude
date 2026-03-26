# Usage Guide

## Prerequisites

- **Node.js** >= 18.0.0
- **Anthropic API key** — Get one at [console.anthropic.com](https://console.anthropic.com)
- **WeChat iLink Bot account** — Access to WeChat iLink Bot API

## Installation

```bash
git clone <repo-url>
cd wechat-claude
npm install
```

## Configuration

### Environment Variables

Create a `.env` file in the project root (see `.env.example`):

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional
CLAUDE_MODEL=claude-sonnet-4-20250514     # Claude model to use
CLAUDE_MAX_TOKENS=4096                     # Max response tokens
CLAUDE_SYSTEM_PROMPT="You are helpful."    # System prompt
CLAUDE_TEMPERATURE=0.7                     # Temperature (0.0-1.0)
WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com  # iLink API endpoint
MAX_CONCURRENT_USERS=10                    # Max simultaneous users
SESSION_IDLE_TIMEOUT_HOURS=24              # Session expiry time
```

### CLI Options

```bash
wechat-claude [options]

Options:
  --login                   Force re-login (show QR code)
  --model <model>           Override Claude model
  --system-prompt <prompt>  Override system prompt
  --max-tokens <n>          Override max response tokens
  -h, --help                Show help
```

CLI options take precedence over environment variables.

## Running

### First Time

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-xxxxx

# Start the bridge
npm run dev
```

A QR code will be displayed in the terminal. Scan it with WeChat to log in. The auth token is saved to `~/.wechat-claude/token.json` for future sessions.

### Subsequent Runs

```bash
npm run dev
```

The saved token is reused automatically. If the token has expired, a new QR code will appear.

### Force Re-login

```bash
npm run dev -- --login
```

### Production Build

```bash
npm run build
npm start
```

## Chatting

Once the bridge is running, send messages to your WeChat bot account:

### Text Messages

Send any text message. Claude will respond in the same language you use.

### Images

Send an image. Claude will analyze it using Vision and describe what it sees. You can also send an image with a text caption asking a specific question about it.

### Voice Messages

If WeChat provides a transcription, it will be forwarded to Claude as text. Otherwise, Claude is notified that a voice message was received without transcription.

### Conversation Commands

| Command | Effect |
|---------|--------|
| `/reset` | Clear conversation history, start fresh |
| `/new` | Same as `/reset` |
| `/clear` | Same as `/reset` |

### Conversation History

- Each user has an independent conversation with Claude
- History is maintained across messages (Claude remembers context)
- Up to 50 turns (25 exchanges) are kept in the sliding window
- Oldest messages are automatically removed when the window is full
- History is stored in memory only — restarting the bridge clears all conversations

## Model Selection

You can use any Claude model. Examples:

```bash
# Fast, cost-effective
npm run dev -- --model claude-haiku-4-5-20251001

# Balanced (default)
npm run dev -- --model claude-sonnet-4-20250514

# Most capable
npm run dev -- --model claude-opus-4-20250514
```

## Custom System Prompt

Customize Claude's behavior:

```bash
npm run dev -- --system-prompt "You are a Chinese-English translator. Translate any Chinese input to English and vice versa."
```

Or via environment variable:

```bash
export CLAUDE_SYSTEM_PROMPT="You are a coding assistant. Always provide code examples."
npm run dev
```

## Troubleshooting

### QR code not displaying

If the terminal doesn't render the QR code properly, the login URL will be printed as text. Copy and open it in a browser to get a scannable QR.

### Token expired

Run with `--login` to force a new QR login:

```bash
npm run dev -- --login
```

Or delete the token file:

```bash
rm ~/.wechat-claude/token.json
npm run dev
```

### API rate limits

If Claude's API returns a rate limit error, the bridge will forward the error message to the WeChat user. Wait a moment and try again.

### Long responses get truncated

WeChat has a 4000-character message limit. The bridge automatically splits long responses into multiple messages. If responses are still too long, reduce `CLAUDE_MAX_TOKENS`:

```bash
export CLAUDE_MAX_TOKENS=2048
```

## Programmatic Usage

The bridge can also be used as a library:

```typescript
import { WeChatClaudeBridge, loadConfig } from "wechat-claude";

const config = loadConfig({
  claude: { model: "claude-sonnet-4-20250514" },
});

const bridge = new WeChatClaudeBridge(config, "your-wechat-token");
await bridge.start();

// Graceful shutdown
process.on("SIGINT", () => bridge.destroy());
```

## File Locations

| Path | Purpose |
|------|---------|
| `~/.wechat-claude/` | Default storage directory |
| `~/.wechat-claude/token.json` | Saved WeChat auth token |
| `.env` | Local environment configuration |
