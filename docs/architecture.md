# Architecture

## Overview

wechat-claude is a dual-mode bridge connecting WeChat messaging (via iLink protocol) to Claude. It supports two modes:

### API Mode — Direct Claude API calls
```
+------------------+       +------------------+       +------------------+
|                  |       |                  |       |                  |
|  WeChat Client   | <---> |  wechat-claude   | <---> |   Claude API     |
|  (User's phone)  |       |    (Bridge)      |       |  (Anthropic)     |
|                  |       |                  |       |                  |
+------------------+       +------------------+       +------------------+
        ^                         |
        |                         v
   iLink Protocol          @anthropic-ai/sdk
   (Long-polling)           (HTTPS REST)
```

### ACP Mode — Full agent subprocess
```
+------------------+       +------------------+       +------------------+
|                  |       |                  |       |                  |
|  WeChat Client   | <---> |  wechat-claude   | <---> |  Agent Process   |
|  (User's phone)  |       |    (Bridge)      |       | (Claude Code,    |
|                  |       |                  |       |  Copilot, etc.)  |
+------------------+       +------------------+       +------------------+
        ^                         |
        |                         v
   iLink Protocol            ACP Protocol
   (Long-polling)          (ndjson over stdio)
```

## Module Structure

```
wechat-claude/
├── bin/
│   └── wechat-claude.ts        # CLI entry point
├── src/
│   ├── index.ts                # Public API exports
│   ├── config.ts               # Configuration (dual mode support)
│   ├── bridge.ts               # Core orchestrator (dual mode routing)
│   ├── adapter/
│   │   ├── inbound.ts          # WeChat → Claude/ACP content conversion
│   │   └── outbound.ts         # Claude/ACP → WeChat text formatting
│   ├── claude/                 # API mode modules
│   │   ├── client.ts           # Anthropic SDK wrapper
│   │   ├── conversation.ts     # Per-user conversation history
│   │   └── types.ts            # Claude-specific type definitions
│   ├── acp/                    # ACP mode modules
│   │   ├── client.ts           # ACP Client (chunk accumulation, permissions)
│   │   ├── agent-manager.ts    # Agent subprocess spawning/killing
│   │   ├── session-manager.ts  # Per-user multi-task agent management
│   │   └── types.ts            # Agent presets and resolution
│   └── session/
│       ├── manager.ts          # Multi-user session management (API mode)
│       └── types.ts            # Session type definitions
└── tests/                      # Mirror of src/ structure
```

## Core Components

### Bridge (`bridge.ts`)

The central orchestrator. It owns all other components and coordinates the message flow:

1. Receives WeChat message via SDK callback
2. Checks for reset commands
3. Converts message to Claude content blocks (inbound adapter)
4. Retrieves/creates user session
5. Appends to conversation history
6. Calls Claude API with full history
7. Formats response (outbound adapter)
8. Sends response back via WeChat SDK

```
WeixinSDK.onMessage()
    │
    ▼
┌─────────────────────┐
│ Check reset command  │──yes──► Reset session, send confirmation
└─────────┬───────────┘
          │ no
          ▼
┌─────────────────────┐
│ Inbound adapter     │  Convert WeChat msg → Claude content blocks
│ (text/image/voice)  │  Images: download → decrypt → base64
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Session manager     │  Get or create session for this user
│ + Conversation      │  Append user message to history
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Claude client       │  Send full conversation to Anthropic API
│ (@anthropic-ai/sdk) │  Receive response
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Outbound adapter    │  Strip markdown, split into chunks
└─────────┬───────────┘
          ▼
    WeixinSDK.sendText()
```

### Inbound Adapter (`adapter/inbound.ts`)

Converts WeChat `WeixinMessage` (with `item_list: MessageItem[]`) into Claude API content blocks:

| WeChat Item Type | Claude Content Block |
|-----------------|---------------------|
| TEXT (1) | `{ type: "text", text: "..." }` |
| IMAGE (2) | `{ type: "image", source: { type: "base64", ... } }` |
| VOICE (3) | `{ type: "text", text: "[Voice transcription]: ..." }` |
| FILE (4) | `{ type: "text", text: "[File received: filename]" }` |
| VIDEO (5) | `{ type: "text", text: "[Video received]" }` |

Image handling flow:
1. `MediaDownloader` downloads encrypted image from WeChat CDN
2. AES-128-ECB decryption (handled by SDK)
3. Read file into Buffer
4. Encode as base64
5. Wrap in Claude `ImageBlockParam` with correct `media_type`

### Outbound Adapter (`adapter/outbound.ts`)

Two pure functions:

- **`formatForWeChat(text)`** — Strips markdown (bold, italic, code blocks, headers, links) since WeChat doesn't render it
- **`splitText(text, maxLength)`** — Splits into chunks of 4000 chars (WeChat limit), preferring newline boundaries

### Claude Client (`claude/client.ts`)

Thin wrapper around `@anthropic-ai/sdk`:

- Accepts `ConversationTurn[]` (role + content blocks)
- Maps to Anthropic `MessageParam[]` with proper typing
- Returns `ClaudeResponse` with text, token usage, and stop reason
- Supports `temperature` override

### Conversation (`claude/conversation.ts`)

Manages per-user conversation history:

- Stores `ConversationTurn[]` (user/assistant pairs)
- Sliding window: when exceeding `maxTurns`, removes oldest **pair** to maintain coherence
- `reset()` clears all history

### ACP Session Manager (`acp/session-manager.ts`)

Manages multi-task parallel execution for ACP mode:

- `Map<userId, UserTaskGroup>` — each user can have multiple concurrent tasks
- Each task is an independent agent subprocess with its own ACP session and message queue
- **Task commands**: `/task new`, `/task list`, `/task <id>`, `/task end`
- Messages are routed to the user's active task
- When multiple tasks exist, replies are prefixed with `[Task #N]`
- **Idle cleanup**: tasks inactive > `idleTimeoutMs` are automatically cleaned up
- **Eviction**: oldest idle task is evicted when hitting capacity limits
- Without `/task` commands, behaves identically to single-session mode (default task auto-created)

### Session Manager (`session/manager.ts`)

Manages multiple concurrent user sessions (API mode):

- `Map<userId, UserSession>` with conversation + metadata
- **LRU eviction**: when at capacity, evicts least recently active user
- **Idle cleanup**: periodic timer removes sessions inactive > `idleTimeoutMs`
- **Reset detection**: matches user text against configurable keywords

## Dependencies

| Package | Purpose | Mode |
|---------|---------|------|
| `@xmccln/wechat-ilink-sdk` | WeChat iLink protocol (auth, messaging, media encryption) | Both |
| `@anthropic-ai/sdk` | Claude API client | API |
| `@agentclientprotocol/sdk` | ACP protocol for agent subprocess communication | ACP |
| `qrcode-terminal` | QR code rendering for terminal login | Both |

## Security Considerations

- **API key**: Loaded exclusively from `ANTHROPIC_API_KEY` env var, never stored in config files
- **Token storage**: WeChat auth token saved to `~/.wechat-claude/token.json` with restrictive scope
- **Media encryption**: Image downloads use AES-128-ECB decryption (handled by SDK), temp files cleaned up after use
- **No secrets in code**: `.env` file is in `.gitignore`

## Data Flow

```
                     ┌──────────────────┐
                     │  WeChat Server   │
                     │ ilinkai.weixin.  │
                     │    qq.com        │
                     └────────┬─────────┘
                              │
                    Long-poll (35s timeout)
                    POST /ilink/bot/getupdates
                              │
                              ▼
                     ┌──────────────────┐
                     │   WeixinSDK      │
                     │  (iLink SDK)     │
                     └────────┬─────────┘
                              │
                         onMessage()
                              │
                              ▼
                     ┌──────────────────┐
                     │     Bridge       │
                     └───┬──────────┬───┘
                         │          │
              ┌──────────▼──┐  ┌────▼──────────┐
              │   Session   │  │  Claude Client │
              │   Manager   │  │  (Anthropic)   │
              └─────────────┘  └───────────────┘
```

No streaming is used — Claude API calls are non-streaming because WeChat iLink only supports sending complete messages (state = `FINISH`).
