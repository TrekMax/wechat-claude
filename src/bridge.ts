import {
  WeixinSDK,
  TokenAuthProvider,
  MediaDownloader,
} from "@xmccln/wechat-ilink-sdk";
import type { WeixinMessage } from "@xmccln/wechat-ilink-sdk";
import { ClaudeClient } from "./claude/client.js";
import { SessionManager } from "./session/manager.js";
import { convertToClaudeContent } from "./adapter/inbound.js";
import { formatForWeChat, splitText } from "./adapter/outbound.js";
import type { WeChatClaudeConfig } from "./config.js";

const WECHAT_MAX_MESSAGE_LENGTH = 4000;

export class WeChatClaudeBridge {
  private sdk: WeixinSDK;
  private claude: ClaudeClient;
  private sessions: SessionManager;
  private config: WeChatClaudeConfig;
  private mediaDownloader: MediaDownloader;

  constructor(config: WeChatClaudeConfig, token: string) {
    this.config = config;

    const authProvider = new TokenAuthProvider(token);
    this.sdk = new WeixinSDK({
      config: {
        baseUrl: config.wechat.baseUrl,
        cdnBaseUrl: config.wechat.cdnBaseUrl,
      },
      auth: authProvider,
    });

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

    this.mediaDownloader = new MediaDownloader(config.wechat.cdnBaseUrl);

    this.sdk.onMessage((msg: WeixinMessage) => {
      this.processMessage(msg);
    });
  }

  async start(): Promise<void> {
    await this.sdk.start();
    console.log("[bridge] Started listening for WeChat messages");
  }

  destroy(): void {
    this.sessions.destroy();
    this.sdk.stop();
  }

  /** Process a single WeChat message. Public for testability. */
  async processMessage(msg: WeixinMessage): Promise<void> {
    const userId = msg.from_user_id;
    const contextToken = msg.context_token;

    if (!userId || !contextToken) return;

    try {
      // Check for reset command — look at first text item
      const firstTextItem = msg.item_list?.find((item) => item.type === 1);
      if (firstTextItem?.text_item?.text) {
        const text = firstTextItem.text_item.text.trim();
        if (this.sessions.isResetCommand(text)) {
          this.sessions.resetSession(userId);
          await this.sdk.sendText(
            userId,
            "Conversation has been reset. Send me a new message to start fresh.",
            contextToken
          );
          return;
        }
      }

      // Convert WeChat message to Claude content blocks
      const downloadImage = async (message: WeixinMessage) => {
        const result = await this.mediaDownloader.downloadImage(message);
        if (!result) return null;
        const { readFileSync } = await import("node:fs");
        const buffer = readFileSync(result.path);
        await result.cleanup();
        return { buffer, mimeType: result.mimeType };
      };

      const contentBlocks = await convertToClaudeContent(msg, downloadImage);

      // Get or create session
      const session = this.sessions.getOrCreateSession(userId);

      // Add user message to conversation
      session.conversation.addUserMessage(contentBlocks);

      // Call Claude API
      const history = session.conversation.getHistory();
      const response = await this.claude.chat(
        history,
        this.config.claude.systemPrompt
      );

      // Add assistant response to conversation
      session.conversation.addAssistantMessage(response.text);

      // Format and send response
      const formatted = formatForWeChat(response.text);
      const chunks = splitText(formatted, WECHAT_MAX_MESSAGE_LENGTH);

      for (const chunk of chunks) {
        await this.sdk.sendText(userId, chunk, contextToken);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[bridge] Error processing message from ${userId}:`,
        errorMessage
      );

      try {
        await this.sdk.sendText(
          userId,
          `Sorry, an error occurred while processing your message. Please try again later.\n\n[error: ${errorMessage}]`,
          contextToken
        );
      } catch {
        console.error(`[bridge] Failed to send error message to ${userId}`);
      }
    }
  }
}
