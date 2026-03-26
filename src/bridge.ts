import {
  WeixinSDK,
  TokenAuthProvider,
  MediaDownloader,
  ApiClient,
  ApiEndpoints,
} from "@xmccln/wechat-ilink-sdk";
import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
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
const TYPING_TICKET_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export class WeChatClaudeBridge {
  private sdk: WeixinSDK;
  private config: WeChatClaudeConfig;
  private mediaDownloader: MediaDownloader;
  private apiEndpoints: ApiEndpoints;
  private debug: boolean;

  // Track sent files per user to avoid duplicates within a turn
  private sentFiles = new Map<string, Set<string>>();

  // Typing indicator cache
  private typingTickets = new Map<
    string,
    { ticket: string; expiresAt: number }
  >();

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

    // Create ApiEndpoints for typing indicators
    const apiClient = new ApiClient({
      baseUrl: config.wechat.baseUrl,
      cdnBaseUrl: config.wechat.cdnBaseUrl,
    });
    apiClient.setAuthToken(token);
    this.apiEndpoints = new ApiEndpoints(apiClient);

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
        onReply: (userId, contextToken, text) => {
          // Clear sent-files tracking for new final reply
          this.sentFiles.delete(userId);
          return this.sendReply(userId, contextToken, text);
        },
        onProgress: (userId, contextToken, text) =>
          this.sendProgressText(userId, contextToken, text),
        onImageReceived: (userId, contextToken, data, mimeType) =>
          this.sendImage(userId, contextToken, data, mimeType),
        sendTyping: (userId, contextToken) =>
          this.sendTypingIndicator(userId, contextToken),
      });
    }

    this.sdk.onMessage((msg: WeixinMessage) => {
      if (this.debug) {
        console.log(
          `\n${new Date().toISOString()} [debug] ===== Incoming WeChat Message =====`
        );
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

  // -- Typing indicators --

  private async getTypingTicket(
    userId: string,
    contextToken: string
  ): Promise<string | null> {
    const cached = this.typingTickets.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ticket;
    }

    try {
      const resp = await this.apiEndpoints.getConfig({
        ilink_user_id: userId,
        context_token: contextToken,
      });
      const ticket = resp.typing_ticket;
      if (ticket) {
        this.typingTickets.set(userId, {
          ticket,
          expiresAt: Date.now() + TYPING_TICKET_TTL_MS,
        });
        return ticket;
      }
    } catch {
      // best effort
    }
    return null;
  }

  private async sendTypingIndicator(
    userId: string,
    contextToken: string
  ): Promise<void> {
    try {
      const ticket = await this.getTypingTicket(userId, contextToken);
      if (!ticket) return;
      await this.apiEndpoints.sendTyping({
        ilink_user_id: userId,
        typing_ticket: ticket,
        status: 1, // TYPING
      });
    } catch {
      // typing is best-effort
    }
  }

  private async cancelTypingIndicator(
    userId: string,
    contextToken: string
  ): Promise<void> {
    try {
      const ticket = await this.getTypingTicket(userId, contextToken);
      if (!ticket) return;
      await this.apiEndpoints.sendTyping({
        ilink_user_id: userId,
        typing_ticket: ticket,
        status: 2, // CANCEL
      });
    } catch {
      // best effort
    }
  }

  // -- Shared command handling --

  /**
   * Handle chat commands. Returns true if message was a command (consumed).
   */
  private async handleCommand(
    userId: string,
    contextToken: string,
    text: string
  ): Promise<boolean> {
    const lower = text.trim().toLowerCase();
    const parts = lower.split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1];

    // /debug [on|off]
    if (cmd === "/debug") {
      if (arg === "on") this.debug = true;
      else if (arg === "off") this.debug = false;
      else this.debug = !this.debug;
      await this.sdk.sendText(
        userId,
        this.debug ? "Debug mode ON." : "Debug mode OFF.",
        contextToken
      );
      return true;
    }

    // /model [name] — view or switch model
    if (cmd === "/model") {
      if (this.config.mode === "acp") {
        if (arg) {
          this.acpSessions!.setModel(userId, arg);
          await this.sdk.sendText(
            userId,
            `Model switched to: ${arg}\nSession restarted. Send a message to begin.`,
            contextToken
          );
        } else {
          const current = this.acpSessions!.getModel();
          await this.sdk.sendText(
            userId,
            `Current model: ${current}\n\nSwitch with:\n/model sonnet\n/model haiku\n/model opus`,
            contextToken
          );
        }
      } else {
        await this.sdk.sendText(
          userId,
          `Current model: ${this.config.claude.model}\n(API mode — restart with --model to change)`,
          contextToken
        );
      }
      return true;
    }

    // ACP-only commands
    if (this.config.mode === "acp") {
      if (cmd === "/show-thoughts" || cmd === "/thoughts") {
        const enabled = this.acpSessions!.toggleShowThoughts(userId);
        await this.sdk.sendText(
          userId,
          enabled ? "Thoughts enabled." : "Thoughts disabled.",
          contextToken
        );
        return true;
      }
    }

    // API-only commands
    if (this.config.mode === "api") {
      if (this.sessions!.isResetCommand(lower)) {
        this.sessions!.resetSession(userId);
        await this.sdk.sendText(
          userId,
          "Conversation has been reset.",
          contextToken
        );
        return true;
      }
    }

    // /help
    if (cmd === "/help") {
      const lines = ["Commands:"];
      if (this.config.mode === "acp") {
        lines.push("/show-thoughts — Toggle thinking visibility");
      }
      if (this.config.mode === "api") {
        lines.push("/reset — Clear conversation history");
      }
      lines.push("/model [name] — View/switch model (sonnet/haiku/opus)");
      lines.push("/debug [on|off] — Toggle debug mode");
      lines.push("/help — Show this message");
      await this.sdk.sendText(userId, lines.join("\n"), contextToken);
      return true;
    }

    return false;
  }

  // -- API mode --

  private async processApiMessage(msg: WeixinMessage): Promise<void> {
    const userId = msg.from_user_id;
    const contextToken = msg.context_token;
    if (!userId || !contextToken) return;

    try {
      const firstTextItem = msg.item_list?.find((item) => item.type === 1);
      if (firstTextItem?.text_item?.text) {
        const handled = await this.handleCommand(
          userId,
          contextToken,
          firstTextItem.text_item.text
        );
        if (handled) return;
      }

      // Send typing indicator
      this.sendTypingIndicator(userId, contextToken).catch(() => {});

      const downloadMedia = this.createMediaDownloader();
      const contentBlocks = await convertToClaudeContent(msg, downloadMedia);
      const session = this.sessions!.getOrCreateSession(userId);
      session.conversation.addUserMessage(contentBlocks);

      const history = session.conversation.getHistory();
      const response = await this.claude!.chat(
        history,
        this.config.claude.systemPrompt
      );

      session.conversation.addAssistantMessage(response.text);

      // Cancel typing before sending reply
      this.cancelTypingIndicator(userId, contextToken).catch(() => {});
      await this.sendReply(userId, contextToken, response.text);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logError("bridge", `Error from ${userId}: ${errorMessage}`);
      try {
        await this.sdk.sendText(
          userId,
          `Error: ${errorMessage}`,
          contextToken
        );
      } catch {
        logError("bridge", `Failed to send error to ${userId}`);
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
      const handled = await this.handleCommand(
        userId,
        contextToken,
        firstTextItem.text_item.text
      );
      if (handled) return;
    }

    try {
      const downloadMedia = this.createMediaDownloader();
      const claudeBlocks = await convertToClaudeContent(msg, downloadMedia);

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
      logError("bridge", `ACP error from ${userId}: ${errorMessage}`);
      try {
        await this.sdk.sendText(
          userId,
          `Error: ${errorMessage}`,
          contextToken
        );
      } catch {
        logError("bridge", `Failed to send error to ${userId}`);
      }
    }
  }

  // -- Media helpers --

  private createMediaDownloader() {
    return async (message: WeixinMessage) => {
      // Try downloadFirstMedia to handle all media types (image, voice, video, file)
      const result = await this.mediaDownloader.downloadFirstMedia(message);
      if (!result) return null;
      const { readFileSync } = await import("node:fs");
      const buffer = readFileSync(result.path);
      await result.cleanup();
      return { buffer, mimeType: result.mimeType };
    };
  }

  // -- Send helpers --

  /** Send progress/tool/thought text — no image scanning */
  private async sendProgressText(
    userId: string,
    contextToken: string,
    text: string
  ): Promise<void> {
    if (this.debug) {
      log("debug", `Progress to ${userId}: ${text.slice(0, 100)}`);
    }
    const formatted = formatForWeChat(text);
    const chunks = splitText(formatted, WECHAT_MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      await this.sdk.sendText(userId, chunk, contextToken);
    }
  }

  /** Send final agent reply — with image path detection and deduplication */
  private async sendReply(
    userId: string,
    contextToken: string,
    text: string
  ): Promise<void> {
    if (this.debug) {
      log("debug", `===== Reply to ${userId} =====`);
      console.log(text);
      log("debug", `===== End reply (${text.length} chars) =====`);
    }

    // Detect and send local image/media files (deduplicated)
    const mediaPaths = this.extractImagePaths(text);
    if (mediaPaths.length > 0) {
      const sent = this.sentFiles.get(userId) ?? new Set<string>();
      for (const filePath of mediaPaths) {
        if (!sent.has(filePath)) {
          sent.add(filePath);
          await this.sendLocalFile(userId, contextToken, filePath);
        }
      }
      this.sentFiles.set(userId, sent);
    }

    const formatted = formatForWeChat(text);
    const chunks = splitText(formatted, WECHAT_MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      await this.sdk.sendText(userId, chunk, contextToken);
    }
  }

  private static readonly IMAGE_EXTENSIONS = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
  ]);

  private static readonly MEDIA_EXTENSIONS: Record<string, number> = {
    // Images
    ".png": 1, ".jpg": 1, ".jpeg": 1, ".gif": 1, ".webp": 1, ".bmp": 1,
    // Videos
    ".mp4": 2, ".mov": 2, ".avi": 2, ".mkv": 2,
    // Files (everything else)
  };

  /**
   * Extract local file paths pointing to images/media from agent reply text.
   * Looks for absolute paths like /Users/xxx/file.png
   */
  private extractImagePaths(text: string): string[] {
    // Match absolute paths with known media extensions
    const pathPattern = /(\/[^\s`"'<>|*?\n]+\.(?:png|jpg|jpeg|gif|webp|bmp|mp4|mov))/gi;
    const matches = text.match(pathPattern) || [];

    // Deduplicate and filter to existing files
    const seen = new Set<string>();
    const result: string[] = [];
    for (const match of matches) {
      // Clean trailing punctuation
      const cleaned = match.replace(/[)}\],:;.]+$/, "");
      if (!seen.has(cleaned) && existsSync(cleaned)) {
        seen.add(cleaned);
        result.push(cleaned);
      }
    }
    return result;
  }

  /**
   * Send a local file (image/video) to WeChat user via iLink protocol.
   */
  private async sendLocalFile(
    userId: string,
    contextToken: string,
    filePath: string
  ): Promise<void> {
    const ext = extname(filePath).toLowerCase();
    const mediaType = WeChatClaudeBridge.MEDIA_EXTENSIONS[ext] ?? 3; // default to FILE

    try {
      log("bridge", `Sending file to ${userId}: ${filePath} (type=${mediaType})`);
      await this.sdk.messaging.sender.sendMedia({
        to: userId,
        filePath,
        mediaType,
        contextToken,
      });
      log("bridge", `File sent to ${userId}: ${filePath}`);
    } catch (error) {
      logError(
        "bridge",
        `Failed to send file ${filePath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  private async sendImage(
    userId: string,
    contextToken: string,
    data: Buffer,
    mimeType: string
  ): Promise<void> {
    const ext = mimeType.includes("png")
      ? ".png"
      : mimeType.includes("gif")
        ? ".gif"
        : ".jpg";
    const tempDir = join(tmpdir(), "wechat-claude-images");
    mkdirSync(tempDir, { recursive: true });
    const tempPath = join(tempDir, `img_${Date.now()}${ext}`);

    try {
      writeFileSync(tempPath, data);
      log(
        "bridge",
        `Sending image to ${userId} (${data.length} bytes, ${mimeType})`
      );

      await this.sdk.messaging.sender.sendMedia({
        to: userId,
        filePath: tempPath,
        mediaType: MEDIA_TYPE_IMAGE,
        contextToken,
      });

      log("bridge", `Image sent to ${userId}`);
    } catch (error) {
      logError(
        "bridge",
        `Failed to send image: ${error instanceof Error ? error.message : error}`
      );
      await this.sdk.sendText(
        userId,
        "[Image generated but failed to send]",
        contextToken
      );
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // best effort
      }
    }
  }
}
