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
        pollingInterval: 100, // Minimize delay between long-poll cycles
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
        onFileReceived: (userId, contextToken, data, fileName, mimeType) =>
          this.sendFileBuffer(userId, contextToken, data, fileName, mimeType),
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

      // Log timing: how long from WeChat send to bridge receive
      if (msg.create_time_ms) {
        const delay = Date.now() - msg.create_time_ms;
        log("bridge", `Message from ${msg.from_user_id ?? "?"} (poll delay: ${delay}ms)`);
      }

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
      await this.reply(
        userId, contextToken,
        this.debug
          ? "Debug 模式已开启 / Debug mode ON"
          : "Debug 模式已关闭 / Debug mode OFF"
      );
      return true;
    }

    // /model [name] — view or switch model
    if (cmd === "/model") {
      const validModels = ["sonnet", "haiku", "opus",
        "claude-sonnet-4-20250514", "claude-opus-4-20250514",
        "claude-haiku-4-5-20251001"];
      const isViewCmd = !arg || arg === "view" || arg === "info" || arg === "status";

      if (this.config.mode === "acp") {
        if (isViewCmd) {
          const current = this.acpSessions!.getModel();
          await this.reply(userId, contextToken,
            `当前模型 / Current model: ${current}\n\n切换方式 / Switch:\n/model sonnet (均衡)\n/model haiku (最快)\n/model opus (最强)`
          );
        } else if (validModels.some(m => m === arg || m.includes(arg!))) {
          this.acpSessions!.setModel(userId, arg!);
          await this.reply(userId, contextToken,
            `模型已切换为 ${arg}\n会话将在下条消息时重启。\n\nModel switched to: ${arg}`
          );
        } else {
          await this.reply(userId, contextToken,
            `未知模型: ${arg}\n可用选项 / Available: sonnet, haiku, opus`
          );
        }
      } else {
        await this.reply(userId, contextToken,
          `当前模型 / Current model: ${this.config.claude.model}\n(API 模式，需重启更换 --model)`
        );
      }
      return true;
    }

    // /new — reset session (both modes)
    if (cmd === "/new" || cmd === "/reset" || cmd === "/clear") {
      if (this.config.mode === "acp") {
        this.acpSessions!.resetSession(userId);
        await this.reply(userId, contextToken,
          "会话已重置，下条消息将启动新的智能体。\nSession reset. Next message starts a new agent."
        );
      } else {
        this.sessions!.resetSession(userId);
        await this.reply(userId, contextToken,
          "对话历史已清空。\nConversation has been reset."
        );
      }
      return true;
    }

    // /status — show session info
    if (cmd === "/status") {
      if (this.config.mode === "acp") {
        const model = this.acpSessions!.getModel();
        const hasSession = this.acpSessions!.hasSession(userId);
        const { tasks, activeTaskId } = this.acpSessions!.listTasks(userId);
        const lines = [
          `模式 / Mode: ACP`,
          `模型 / Model: ${model}`,
          `会话 / Session: ${hasSession ? "活跃中（复用）/ active" : "无（下条消息创建）/ none"}`,
          `任务数 / Tasks: ${tasks.length}`,
          `当前任务 / Active task: ${activeTaskId > 0 ? `#${activeTaskId}` : "无 / none"}`,
          `Debug: ${this.debug ? "开启 ON" : "关闭 OFF"}`,
        ];
        await this.reply(userId, contextToken, lines.join("\n"));
      } else {
        const lines = [
          `模式 / Mode: API`,
          `模型 / Model: ${this.config.claude.model}`,
          `Debug: ${this.debug ? "开启 ON" : "关闭 OFF"}`,
        ];
        await this.reply(userId, contextToken, lines.join("\n"));
      }
      return true;
    }

    // ACP-only commands
    if (this.config.mode === "acp") {
      if (cmd === "/show-thoughts" || cmd === "/thoughts") {
        const enabled = this.acpSessions!.toggleShowThoughts(userId);
        await this.reply(userId, contextToken,
          enabled
            ? "已开启思考过程显示。\nThoughts enabled."
            : "已关闭思考过程显示。\nThoughts disabled."
        );
        return true;
      }

      // /task commands for multi-task parallel support
      if (cmd === "/task") {
        await this.handleTaskCommand(userId, contextToken, parts.slice(1), text);
        return true;
      }
    }

    // /help
    if (cmd === "/help") {
      const lines = ["可用命令 / Commands:"];
      lines.push("/new — 新建会话 / New session");
      lines.push("/model [名称] — 查看/切换模型 / View/switch model");
      lines.push("/status — 查看状态 / Session info");
      if (this.config.mode === "acp") {
        lines.push("/show-thoughts — 切换思考过程 / Toggle thinking");
        lines.push("");
        lines.push("多任务并行 / Multi-task:");
        lines.push("/task new [描述] — 新建并行任务 / Create parallel task");
        lines.push("/task list — 查看所有任务 / List tasks");
        lines.push("/task <id> — 切换当前任务 / Switch task");
        lines.push("/task end [id] — 结束任务 / End task");
      }
      lines.push("/debug [on|off] — 调试模式 / Debug mode");
      lines.push("/help — 帮助 / Help");
      await this.reply(userId, contextToken, lines.join("\n"));
      return true;
    }

    return false;
  }

  // -- Task commands (ACP multi-task) --

  private async handleTaskCommand(
    userId: string,
    contextToken: string,
    args: string[],
    rawText: string
  ): Promise<void> {
    const sub = args[0];

    // /task new [description]
    if (sub === "new" || sub === "create") {
      // Extract description from original text to preserve casing
      const descMatch = rawText.match(/\/task\s+(?:new|create)\s+(.*)/i);
      const description = descMatch?.[1]?.trim() || "";
      try {
        const taskId = await this.acpSessions!.createNewTask(
          userId,
          contextToken,
          description
        );
        await this.reply(
          userId,
          contextToken,
          `新任务 #${taskId} 已创建${description ? `：${description}` : ""}，已切换为当前任务。\nTask #${taskId} created${description ? `: ${description}` : ""}, now active.`
        );
      } catch (err) {
        await this.reply(
          userId,
          contextToken,
          `创建任务失败 / Failed to create task: ${String(err)}`
        );
      }
      return;
    }

    // /task list
    if (sub === "list" || sub === "ls") {
      const { tasks, activeTaskId } = this.acpSessions!.listTasks(userId);
      if (tasks.length === 0) {
        await this.reply(
          userId,
          contextToken,
          "暂无活跃任务，发送消息会自动创建。\nNo active tasks. Send a message to start one."
        );
        return;
      }

      const lines = [`任务列表 / Tasks (共 ${tasks.length} 个):`];
      for (const t of tasks) {
        const active = t.taskId === activeTaskId ? " ← 当前/active" : "";
        const status = t.processing ? "处理中/running" : "空闲/idle";
        const queue = t.queueLength > 0 ? ` (队列: ${t.queueLength})` : "";
        lines.push(`#${t.taskId} [${status}] ${t.description}${queue}${active}`);
      }
      lines.push("");
      lines.push("切换: /task <id>  |  新建: /task new  |  结束: /task end [id]");
      await this.reply(userId, contextToken, lines.join("\n"));
      return;
    }

    // /task end [id]
    if (sub === "end" || sub === "kill" || sub === "stop" || sub === "close") {
      const targetId = args[1] ? parseInt(args[1], 10) : undefined;
      if (args[1] && isNaN(targetId!)) {
        await this.reply(userId, contextToken, "无效的任务 ID / Invalid task ID");
        return;
      }
      const ended = this.acpSessions!.endTask(userId, targetId);
      if (ended > 0) {
        const activeId = this.acpSessions!.getActiveTaskId(userId);
        const switchMsg = activeId > 0
          ? `当前任务切换为 #${activeId} / Switched to #${activeId}`
          : "无剩余任务 / No remaining tasks";
        await this.reply(
          userId,
          contextToken,
          `任务 #${ended} 已结束。${switchMsg}\nTask #${ended} ended. ${switchMsg}`
        );
      } else {
        await this.reply(userId, contextToken, "未找到该任务 / Task not found");
      }
      return;
    }

    // /task <id> — switch task
    if (sub && /^\d+$/.test(sub)) {
      const taskId = parseInt(sub, 10);
      const ok = this.acpSessions!.switchTask(userId, taskId);
      if (ok) {
        await this.reply(
          userId,
          contextToken,
          `已切换到任务 #${taskId}，后续消息将发送到此任务。\nSwitched to task #${taskId}.`
        );
      } else {
        await this.reply(
          userId,
          contextToken,
          `任务 #${taskId} 不存在。使用 /task list 查看所有任务。\nTask #${taskId} not found. Use /task list.`
        );
      }
      return;
    }

    // /task (no args) — show current task info
    if (!sub) {
      const { tasks, activeTaskId } = this.acpSessions!.listTasks(userId);
      if (tasks.length === 0) {
        await this.reply(
          userId,
          contextToken,
          "暂无活跃任务。发送 /task new 创建新任务。\nNo active tasks. Use /task new to create one."
        );
      } else {
        const active = tasks.find((t) => t.taskId === activeTaskId);
        const status = active?.processing ? "处理中/running" : "空闲/idle";
        await this.reply(
          userId,
          contextToken,
          `当前任务 / Current: #${activeTaskId} [${status}] ${active?.description ?? ""}\n共 ${tasks.length} 个任务 / ${tasks.length} total tasks\n\n/task list 查看全部 | /task new 新建`
        );
      }
      return;
    }

    // Unknown subcommand
    await this.reply(
      userId,
      contextToken,
      "用法 / Usage:\n/task new [描述] — 新建任务\n/task list — 查看任务\n/task <id> — 切换任务\n/task end [id] — 结束任务"
    );
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

  /** Short helper for sending command responses */
  private async reply(userId: string, contextToken: string, text: string): Promise<void> {
    await this.sdk.sendText(userId, text, contextToken);
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

    // Detect and send local files (images, videos, documents) (deduplicated)
    const mediaPaths = this.extractFilePaths(text);
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

  private static readonly MEDIA_EXTENSIONS: Record<string, number> = {
    // Images (mediaType=1)
    ".png": 1, ".jpg": 1, ".jpeg": 1, ".gif": 1, ".webp": 1, ".bmp": 1,
    // Videos (mediaType=2)
    ".mp4": 2, ".mov": 2, ".avi": 2, ".mkv": 2, ".webm": 2,
    // Files (mediaType=3)
    ".pdf": 3, ".doc": 3, ".docx": 3, ".xls": 3, ".xlsx": 3,
    ".ppt": 3, ".pptx": 3, ".txt": 3, ".csv": 3, ".json": 3,
    ".xml": 3, ".yaml": 3, ".yml": 3, ".toml": 3, ".md": 3,
    ".zip": 3, ".tar": 3, ".gz": 3, ".rar": 3, ".7z": 3,
    ".js": 3, ".ts": 3, ".py": 3, ".go": 3, ".rs": 3,
    ".c": 3, ".cpp": 3, ".h": 3, ".java": 3, ".sh": 3,
    ".html": 3, ".css": 3, ".svg": 3, ".log": 3,
  };

  /**
   * Extract local file paths pointing to images/media/documents from agent reply text.
   * Looks for absolute paths like /Users/xxx/file.png or /home/xxx/report.pdf
   */
  private extractFilePaths(text: string): string[] {
    // Build extension list from MEDIA_EXTENSIONS keys
    const exts = Object.keys(WeChatClaudeBridge.MEDIA_EXTENSIONS)
      .map((e) => e.slice(1)) // remove leading dot
      .join("|");
    const pathPattern = new RegExp(
      `(\\/[^\\s\`"'<>|*?\\n]+\\.(?:${exts}))`,
      "gi"
    );
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

  private async sendFileBuffer(
    userId: string,
    contextToken: string,
    data: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<void> {
    const tempDir = join(tmpdir(), "wechat-claude-files");
    mkdirSync(tempDir, { recursive: true });
    const safeName = fileName.replace(/[/\\]/g, "_") || `file_${Date.now()}`;
    const tempPath = join(tempDir, safeName);

    try {
      writeFileSync(tempPath, data);
      log("bridge", `Sending file to ${userId}: ${fileName} (${data.length} bytes, ${mimeType})`);

      // Determine media type from extension
      const ext = extname(fileName).toLowerCase();
      const mediaType = WeChatClaudeBridge.MEDIA_EXTENSIONS[ext] ?? 3; // default FILE

      await this.sdk.messaging.sender.sendMedia({
        to: userId,
        filePath: tempPath,
        mediaType,
        fileName: safeName,
        contextToken,
      });

      log("bridge", `File sent to ${userId}: ${fileName}`);
    } catch (error) {
      logError(
        "bridge",
        `Failed to send file ${fileName}: ${error instanceof Error ? error.message : error}`
      );
      await this.sdk.sendText(
        userId,
        `[File generated but failed to send: ${fileName}]`,
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
