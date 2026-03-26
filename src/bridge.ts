import {
  WeixinSDK,
  TokenAuthProvider,
  MediaDownloader,
} from "@xmccln/wechat-ilink-sdk";
import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeClient } from "./claude/client.js";
import { SessionManager } from "./session/manager.js";
import { AcpSessionManager } from "./acp/session-manager.js";
import {
  convertToClaudeContent,
  type ClaudeContentBlock,
} from "./adapter/inbound.js";
import { formatForWeChat, splitText } from "./adapter/outbound.js";
import type { WeChatClaudeConfig } from "./config.js";
import { log, logError } from "./logger.js";

const WECHAT_MAX_MESSAGE_LENGTH = 4000;
const MEDIA_TYPE_IMAGE = 1;

export class WeChatClaudeBridge {
  private sdk: WeixinSDK;
  private config: WeChatClaudeConfig;
  private mediaDownloader: MediaDownloader;
  private debug: boolean;

  // API mode
  private claude?: ClaudeClient;
  private sessions?: SessionManager;

  // ACP mode
  private acpSessions?: AcpSessionManager;

  constructor(config: WeChatClaudeConfig, token: string) {
    this.config = config;
    this.debug = config.debug;

    const authProvider = new TokenAuthProvider(token);
    this.sdk = new WeixinSDK({
      config: {
        baseUrl: config.wechat.baseUrl,
        cdnBaseUrl: config.wechat.cdnBaseUrl,
      },
      auth: authProvider,
    });

    this.mediaDownloader = new MediaDownloader(config.wechat.cdnBaseUrl);

    if (config.mode === "api") {
      this.claude = new ClaudeClient({
        apiKey: config.claude.apiKey,
        model: config.claude.model,
        maxTokens: config.claude.maxTokens,
        temperature: config.claude.temperature,
      });

      this.sessions = new SessionManager({
        maxConcurrentUsers: config.session.maxConcurrentUsers,
        maxConversationTurns: config.session.maxConversationTurns,
        idleTimeoutMs: config.session.idleTimeoutMs,
        resetKeywords: config.session.resetKeywords,
      });
    } else {
      this.acpSessions = new AcpSessionManager({
        agentCommand: config.agent.command,
        agentArgs: config.agent.args,
        agentCwd: config.agent.cwd,
        agentEnv: config.agent.env,
        idleTimeoutMs: config.session.idleTimeoutMs,
        maxConcurrentUsers: config.session.maxConcurrentUsers,
        showThoughts: config.agent.showThoughts,
        log: (msg) => log("acp", msg),
        onReply: (userId, contextToken, text) =>
          this.sendReply(userId, contextToken, text),
        onImageReceived: (userId, contextToken, data, mimeType) =>
          this.sendImage(userId, contextToken, data, mimeType),
        sendTyping: async () => {
          // typing is best-effort
        },
      });
    }

    this.sdk.onMessage((msg: WeixinMessage) => {
      if (this.debug) {
        console.log(`\n${new Date().toISOString()} [debug] ===== Incoming WeChat Message =====`);
        console.log(JSON.stringify(msg, null, 2));
        console.log(`[debug] =====================================\n`);
      }

      // Skip bot's own messages (type 2 = BOT)
      if (msg.message_type === 2) return;
      // Skip incomplete messages (state 1 = GENERATING)
      if (msg.message_state === 1) return;

      this.processMessage(msg).catch((err) => {
        logError("bridge", `Error in processMessage: ${err}`);
      });
    });
  }

  async start(): Promise<void> {
    if (this.acpSessions) {
      this.acpSessions.start();
    }
    await this.sdk.start();
    log(
      "bridge",
      `Started in ${this.config.mode.toUpperCase()} mode, listening for WeChat messages`
    );
  }

  destroy(): void {
    this.sessions?.destroy();
    if (this.acpSessions) {
      this.acpSessions.stop().catch(() => {});
    }
    this.sdk.stop();
  }

  /** Process a single WeChat message. Public for testability. */
  async processMessage(msg: WeixinMessage): Promise<void> {
    if (this.config.mode === "api") {
      await this.processApiMessage(msg);
    } else {
      await this.processAcpMessage(msg);
    }
  }

  // -- API mode --

  private async processApiMessage(msg: WeixinMessage): Promise<void> {
    const userId = msg.from_user_id;
    const contextToken = msg.context_token;
    if (!userId || !contextToken) return;

    try {
      // Check for commands
      const firstTextItem = msg.item_list?.find((item) => item.type === 1);
      if (firstTextItem?.text_item?.text) {
        const text = firstTextItem.text_item.text.trim();
        const textLower = text.toLowerCase();

        if (this.sessions!.isResetCommand(textLower)) {
          this.sessions!.resetSession(userId);
          await this.sdk.sendText(
            userId,
            "Conversation has been reset. Send me a new message to start fresh.",
            contextToken
          );
          return;
        }

        if (textLower === "/debug") {
          this.debug = !this.debug;
          await this.sdk.sendText(
            userId,
            this.debug
              ? "Debug mode ON. Messages will be printed to terminal."
              : "Debug mode OFF.",
            contextToken
          );
          return;
        }

        if (textLower === "/help") {
          await this.sdk.sendText(
            userId,
            "Available commands:\n" +
              "/reset — Clear conversation history\n" +
              "/debug — Toggle debug mode\n" +
              "/help — Show this help message",
            contextToken
          );
          return;
        }
      }

      const downloadImage = async (message: WeixinMessage) => {
        const result = await this.mediaDownloader.downloadImage(message);
        if (!result) return null;
        const { readFileSync } = await import("node:fs");
        const buffer = readFileSync(result.path);
        await result.cleanup();
        return { buffer, mimeType: result.mimeType };
      };

      const contentBlocks = await convertToClaudeContent(msg, downloadImage);
      const session = this.sessions!.getOrCreateSession(userId);
      session.conversation.addUserMessage(contentBlocks);

      const history = session.conversation.getHistory();
      const response = await this.claude!.chat(
        history,
        this.config.claude.systemPrompt
      );

      session.conversation.addAssistantMessage(response.text);
      await this.sendReply(userId, contextToken, response.text);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logError("bridge", `Error processing message from ${userId}: ${errorMessage}`);
      try {
        await this.sdk.sendText(
          userId,
          `Sorry, an error occurred. Please try again later.\n\n[error: ${errorMessage}]`,
          contextToken
        );
      } catch {
        logError("bridge", `Failed to send error message to ${userId}`);
      }
    }
  }

  // -- ACP mode --

  private async processAcpMessage(msg: WeixinMessage): Promise<void> {
    const userId = msg.from_user_id;
    const contextToken = msg.context_token;
    if (!userId || !contextToken) {
      log("bridge", "Skipping message: no userId or contextToken");
      return;
    }

    log("bridge", `Processing ACP message from ${userId}`);

    // Handle chat commands
    const firstTextItem = msg.item_list?.find((item) => item.type === 1);
    if (firstTextItem?.text_item?.text) {
      const text = firstTextItem.text_item.text.trim().toLowerCase();

      if (text === "/show-thoughts" || text === "/thoughts") {
        const enabled = this.acpSessions!.toggleShowThoughts(userId);
        await this.sdk.sendText(
          userId,
          enabled
            ? "Thoughts enabled. You will now see the agent's thinking process."
            : "Thoughts disabled.",
          contextToken
        );
        return;
      }

      if (text === "/debug") {
        this.debug = !this.debug;
        await this.sdk.sendText(
          userId,
          this.debug
            ? "Debug mode ON. Messages will be printed to terminal."
            : "Debug mode OFF.",
          contextToken
        );
        return;
      }

      if (text === "/help") {
        await this.sdk.sendText(
          userId,
          "Available commands:\n" +
            "/show-thoughts — Toggle agent thinking visibility\n" +
            "/debug — Toggle debug mode\n" +
            "/help — Show this help message",
          contextToken
        );
        return;
      }
    }

    try {
      // Convert to ACP content blocks
      const downloadImage = async (message: WeixinMessage) => {
        const result = await this.mediaDownloader.downloadImage(message);
        if (!result) return null;
        const { readFileSync } = await import("node:fs");
        const buffer = readFileSync(result.path);
        await result.cleanup();
        return { buffer, mimeType: result.mimeType };
      };

      const claudeBlocks = await convertToClaudeContent(msg, downloadImage);

      // Convert ClaudeContentBlock[] to ACP ContentBlock[]
      const acpBlocks = claudeBlocks.map((block: ClaudeContentBlock) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        return {
          type: "image" as const,
          data: block.source.data,
          mimeType: block.source.media_type,
        };
      });

      await this.acpSessions!.enqueue(userId, {
        prompt: acpBlocks,
        contextToken,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logError("bridge", `Error processing ACP message from ${userId}: ${errorMessage}`);
      try {
        await this.sdk.sendText(
          userId,
          `Sorry, an error occurred. Please try again later.\n\n[error: ${errorMessage}]`,
          contextToken
        );
      } catch {
        logError("bridge", `Failed to send error message to ${userId}`);
      }
    }
  }

  // -- Shared --

  private async sendReply(
    userId: string,
    contextToken: string,
    text: string
  ): Promise<void> {
    const formatted = formatForWeChat(text);
    const chunks = splitText(formatted, WECHAT_MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      await this.sdk.sendText(userId, chunk, contextToken);
    }
  }

  private async sendImage(
    userId: string,
    contextToken: string,
    data: Buffer,
    mimeType: string
  ): Promise<void> {
    // Write buffer to a temp file, then send via SDK
    const ext = mimeType.includes("png") ? ".png" : mimeType.includes("gif") ? ".gif" : ".jpg";
    const tempDir = join(tmpdir(), "wechat-claude-images");
    mkdirSync(tempDir, { recursive: true });
    const tempPath = join(tempDir, `img_${Date.now()}${ext}`);

    try {
      writeFileSync(tempPath, data);
      log("bridge", `Sending image to ${userId} (${data.length} bytes, ${mimeType})`);

      await this.sdk.messaging.sender.sendMedia({
        to: userId,
        filePath: tempPath,
        mediaType: MEDIA_TYPE_IMAGE,
        contextToken,
      });

      log("bridge", `Image sent successfully to ${userId}`);
    } catch (error) {
      logError("bridge", `Failed to send image: ${error instanceof Error ? error.message : error}`);
      await this.sdk.sendText(
        userId,
        "[Image generated but failed to send]",
        contextToken
      );
    } finally {
      // Cleanup temp file
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tempPath);
      } catch {
        // best effort
      }
    }
  }
}
