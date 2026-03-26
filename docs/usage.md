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
  --agent <name|cmd>   Enable ACP mode with an agent preset or command
  --cwd <path>         Working directory for ACP agent (default: current dir)
  --show-thoughts      Show agent thinking process in chat (ACP mode)
  --login              Force re-login (show QR code)
  --model <model>      Override Claude model (API mode)
  --system-prompt <p>  Override system prompt (API mode)
  --max-tokens <n>     Override max response tokens (API mode)
  -h, --help           Show help
```

CLI options take precedence over environment variables.

## Modes

### API Mode (default)

Direct Claude API calls for text and image chat. Requires `ANTHROPIC_API_KEY`.

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx
npm run dev
```

### ACP Mode

Launches a full agent subprocess (e.g. Claude Code) that can read/write files, execute commands, and use tools. Activated with `--agent`.

```bash
# Built-in preset
npm run dev -- --agent claude

# With project directory
npm run dev -- --agent claude --cwd ~/projects/myapp

# Show agent thinking
npm run dev -- --agent claude --show-thoughts

# Custom agent command
npm run dev -- --agent "npx my-custom-agent --acp"
```

Built-in agent presets:

| Preset | Agent | Command |
|--------|-------|---------|
| `claude` | Claude Code | `npx @anthropic-ai/claude-code --acp` |
| `copilot` | GitHub Copilot | `npx @github/copilot --acp --yolo` |
| `gemini` | Gemini CLI | `npx @google/gemini-cli --experimental-acp` |

## Running

### First Time

```bash
npm run dev                    # API mode
npm run dev -- --agent claude  # ACP mode
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

### Multi-Task Parallel (ACP mode)

In ACP mode, you can run multiple agent tasks concurrently. Each task gets its own independent agent subprocess and Claude context, so they don't block each other.

| Command | Effect |
|---------|--------|
| `/task new [description]` | Create a new parallel task and switch to it |
| `/task list` | List all active tasks with status |
| `/task <id>` | Switch to a specific task (future messages go there) |
| `/task end [id]` | End a task (current if no id specified) |
| `/task` | Show current task info |

**Example workflow:**

```
You: /task new Design an API            → Creates task #1, starts agent
You: (task #1 is working...)
You: /task new Fix the login bug         → Creates task #2, starts another agent in parallel
You: /task list                          → Shows both tasks and their status
You: /task 1                             → Switch back to task #1
You: How's the progress?                 → Sent to task #1
You: /task 2                             → Switch to task #2
You: Add error handling                  → Sent to task #2
```

When you have multiple tasks running, replies are prefixed with `[Task #N]` so you can tell which task responded.

Without using `/task` commands, the system works exactly as before — a single default task is created automatically.

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
