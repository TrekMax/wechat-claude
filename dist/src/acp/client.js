/**
 * ACP Client implementation.
 * Handles agent communication: chunk accumulation, permission auto-approval,
 * typing indicators, and file system access.
 */
import * as fs from "node:fs";
import { log as tslog } from "../logger.js";
const TYPING_INTERVAL_MS = 5_000;
export class AcpClient {
    chunks = [];
    imageChunks = [];
    thoughtChunks = [];
    lastTypingAt = 0;
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    updateCallbacks(callbacks) {
        this.opts = { ...this.opts, ...callbacks };
    }
    setShowThoughts(enabled) {
        this.opts.showThoughts = enabled;
    }
    get showThoughts() {
        return this.opts.showThoughts;
    }
    // -- ACP Client interface methods --
    async requestPermission(params) {
        const allowOpt = params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
        const optionId = allowOpt?.optionId ?? params.options[0]?.optionId ?? "allow";
        return {
            outcome: {
                outcome: "selected",
                optionId,
            },
        };
    }
    async sessionUpdate(params) {
        const update = params.update;
        const sessionUpdate = update.sessionUpdate;
        switch (sessionUpdate) {
            case "agent_message_chunk": {
                await this.maybeFlushThoughts();
                const content = update.content;
                if (content.type === "text" && content.text) {
                    this.chunks.push(content.text);
                }
                else if (content.type === "image" && content.data) {
                    tslog("acp", `Received image chunk (${content.mimeType ?? "unknown"})`);
                    const buffer = Buffer.from(content.data, "base64");
                    this.imageChunks.push({
                        data: buffer,
                        mimeType: content.mimeType ?? "image/png",
                    });
                    // Send image immediately
                    try {
                        await this.opts.onImageReceived(buffer, content.mimeType ?? "image/png");
                    }
                    catch {
                        // best effort
                    }
                }
                else if (content.type === "file" && content.data) {
                    const fileName = content.fileName;
                    const mimeType = content.mimeType ?? "application/octet-stream";
                    tslog("acp", `Received file chunk: ${fileName ?? "unknown"} (${mimeType})`);
                    const buffer = Buffer.from(content.data, "base64");
                    try {
                        await this.opts.onFileReceived(buffer, fileName ?? "file", mimeType);
                    }
                    catch {
                        // best effort
                    }
                }
                await this.maybeSendTyping();
                break;
            }
            case "agent_thought_chunk": {
                const content = update.content;
                if (content.type === "text" && content.text && this.opts.showThoughts) {
                    this.thoughtChunks.push(content.text);
                }
                await this.maybeSendTyping();
                break;
            }
            case "tool_call": {
                await this.maybeFlushThoughts();
                const title = update.title;
                const status = update.status;
                if (title) {
                    tslog("acp", `Tool: ${title} (${status ?? "started"})`);
                    try {
                        await this.opts.onToolProgress(`[${title}]`);
                    }
                    catch {
                        // best effort
                    }
                }
                await this.maybeSendTyping();
                break;
            }
            case "tool_call_update": {
                const status = update.status;
                const updateContent = update.content;
                if (status === "completed" && updateContent) {
                    for (const c of updateContent) {
                        if (c.type === "diff" &&
                            c.oldText !== undefined &&
                            c.newText !== undefined) {
                            this.chunks.push(`\n\`\`\`diff\n-${c.oldText}\n+${c.newText}\n\`\`\`\n`);
                        }
                    }
                }
                break;
            }
            default:
                break;
        }
    }
    async readTextFile(params) {
        const content = await fs.promises.readFile(params.path, "utf-8");
        return { content };
    }
    async writeTextFile(params) {
        await fs.promises.writeFile(params.path, params.content, "utf-8");
        return {};
    }
    async createTerminal() {
        throw new Error("Terminal creation not supported in WeChat bridge");
    }
    // -- Chunk management --
    async flush() {
        await this.maybeFlushThoughts();
        const text = this.chunks.join("");
        this.chunks = [];
        this.imageChunks = [];
        this.lastTypingAt = 0;
        return text;
    }
    async maybeFlushThoughts() {
        if (this.thoughtChunks.length === 0)
            return;
        const thoughtText = this.thoughtChunks.join("");
        this.thoughtChunks = [];
        if (thoughtText.trim()) {
            try {
                await this.opts.onThoughtFlush(`[Thinking]\n${thoughtText}`);
            }
            catch {
                // best effort
            }
        }
    }
    async maybeSendTyping() {
        const now = Date.now();
        if (now - this.lastTypingAt < TYPING_INTERVAL_MS)
            return;
        this.lastTypingAt = now;
        try {
            await this.opts.sendTyping();
        }
        catch {
            // typing is best-effort
        }
    }
}
//# sourceMappingURL=client.js.map