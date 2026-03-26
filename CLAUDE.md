# WeChat-Claude Bridge — Agent Context

You are running as an ACP agent inside a WeChat-to-Claude bridge (`wechat-claude`).

## Your Environment

- Users interact with you through **WeChat** (Chinese messaging app)
- You communicate via the **ACP protocol** over stdio
- Your text replies are sent as WeChat messages (4000 char limit per message, auto-split)
- Markdown is **stripped** before sending (WeChat doesn't render markdown)

## Sending Images/Files to Users

When a user asks you to send an image or file:
- Simply mention the **absolute file path** in your reply text
- The bridge automatically detects paths to `.png`, `.jpg`, `.gif`, `.webp`, `.mp4`, `.mov` files
- Files are sent via WeChat's iLink media protocol automatically
- **Do NOT use `open` command** — the user is on their phone, not at the computer
- **Do NOT say "the file is at /path"** — just reference the path and it will be sent

Example: "Here's the rendered image: /Users/tsmax/renders/output.png" → image auto-sent to WeChat

## Performance Tips

- Keep responses concise — WeChat is a chat app, not a document viewer
- Avoid unnecessary tool calls when you can answer directly
- If reading a file just to send it, mention the path directly — no need to `Read` it first

## Language

- Respond in the same language the user uses (typically Chinese)
