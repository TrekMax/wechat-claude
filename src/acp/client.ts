/**
 * ACP Client implementation.
 * Handles agent communication: chunk accumulation, permission auto-approval,
 * typing indicators, and file system access.
 */

import * as fs from "node:fs";
import type * as acp from "@agentclientprotocol/sdk";

export interface AcpClientOpts {
  sendTyping: () => Promise<void>;
  onThoughtFlush: (text: string) => Promise<void>;
  showThoughts: boolean;
}

const TYPING_INTERVAL_MS = 5_000;

export class AcpClient implements acp.Client {
  private chunks: string[] = [];
  private thoughtChunks: string[] = [];
  private lastTypingAt = 0;
  private opts: AcpClientOpts;

  constructor(opts: AcpClientOpts) {
    this.opts = opts;
  }

  updateCallbacks(callbacks: {
    sendTyping: () => Promise<void>;
    onThoughtFlush: (text: string) => Promise<void>;
  }): void {
    this.opts = { ...this.opts, ...callbacks };
  }

  // -- ACP Client interface methods --

  async requestPermission(
    params: acp.RequestPermissionRequest
  ): Promise<acp.RequestPermissionResponse> {
    const allowOpt = params.options.find(
      (o: { kind: string }) =>
        o.kind === "allow_once" || o.kind === "allow_always"
    );
    const optionId =
      allowOpt?.optionId ?? params.options[0]?.optionId ?? "allow";

    return {
      outcome: {
        outcome: "selected",
        optionId,
      },
    };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update as Record<string, unknown>;
    const sessionUpdate = update.sessionUpdate as string;

    switch (sessionUpdate) {
      case "agent_message_chunk": {
        await this.maybeFlushThoughts();
        const content = update.content as { type: string; text?: string };
        if (content.type === "text" && content.text) {
          this.chunks.push(content.text);
        }
        await this.maybeSendTyping();
        break;
      }

      case "agent_thought_chunk": {
        const content = update.content as { type: string; text?: string };
        if (content.type === "text" && content.text && this.opts.showThoughts) {
          this.thoughtChunks.push(content.text);
        }
        await this.maybeSendTyping();
        break;
      }

      case "tool_call":
        await this.maybeFlushThoughts();
        break;

      case "tool_call_update": {
        const status = update.status as string | undefined;
        const updateContent = update.content as
          | Array<{ type: string; oldText?: string; newText?: string }>
          | undefined;
        if (status === "completed" && updateContent) {
          for (const c of updateContent) {
            if (c.type === "diff" && c.oldText !== undefined && c.newText !== undefined) {
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

  async readTextFile(
    params: acp.ReadTextFileRequest
  ): Promise<acp.ReadTextFileResponse> {
    const content = await fs.promises.readFile(params.path, "utf-8");
    return { content };
  }

  async writeTextFile(
    params: acp.WriteTextFileRequest
  ): Promise<acp.WriteTextFileResponse> {
    await fs.promises.writeFile(params.path, params.content, "utf-8");
    return {};
  }

  async createTerminal(): Promise<never> {
    throw new Error("Terminal creation not supported in WeChat bridge");
  }

  // -- Chunk management --

  async flush(): Promise<string> {
    await this.maybeFlushThoughts();
    const text = this.chunks.join("");
    this.chunks = [];
    this.lastTypingAt = 0;
    return text;
  }

  private async maybeFlushThoughts(): Promise<void> {
    if (this.thoughtChunks.length === 0) return;
    const thoughtText = this.thoughtChunks.join("");
    this.thoughtChunks = [];
    if (thoughtText.trim()) {
      try {
        await this.opts.onThoughtFlush(`[Thinking]\n${thoughtText}`);
      } catch {
        // best effort
      }
    }
  }

  private async maybeSendTyping(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTypingAt < TYPING_INTERVAL_MS) return;
    this.lastTypingAt = now;
    try {
      await this.opts.sendTyping();
    } catch {
      // typing is best-effort
    }
  }
}
