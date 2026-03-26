/**
 * Per-user ACP session manager.
 * Each WeChat user gets their own agent subprocess + ACP session.
 * Messages are queued per-user to ensure serialized processing.
 *
 * Based on wechat-acp/src/acp/session.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { AcpClient } from "./client.js";
import {
  spawnAgent,
  killAgent,
  type AgentProcessInfo,
} from "./agent-manager.js";

export interface AcpSessionManagerOpts {
  agentCommand: string;
  agentArgs: string[];
  agentCwd: string;
  agentEnv?: Record<string, string>;
  idleTimeoutMs: number;
  maxConcurrentUsers: number;
  showThoughts: boolean;
  log: (msg: string) => void;
  onReply: (userId: string, contextToken: string, text: string) => Promise<void>;
  /** Send text without image scanning (for progress/thoughts) */
  onProgress: (userId: string, contextToken: string, text: string) => Promise<void>;
  onImageReceived: (userId: string, contextToken: string, data: Buffer, mimeType: string) => Promise<void>;
  sendTyping: (userId: string, contextToken: string) => Promise<void>;
}

interface AcpUserSession {
  userId: string;
  contextToken: string;
  client: AcpClient;
  agentInfo: AgentProcessInfo;
  queue: PendingMessage[];
  processing: boolean;
  lastActivity: number;
}

interface PendingMessage {
  prompt: acp.ContentBlock[];
  contextToken: string;
}

export class AcpSessionManager {
  private sessions = new Map<string, AcpUserSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private opts: AcpSessionManagerOpts;
  private aborted = false;

  constructor(opts: AcpSessionManagerOpts) {
    this.opts = opts;
  }

  start(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, 2 * 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  async stop(): Promise<void> {
    this.aborted = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [userId, session] of this.sessions) {
      this.opts.log(`Stopping session for ${userId}`);
      killAgent(session.agentInfo.process);
    }
    this.sessions.clear();
  }

  async enqueue(
    userId: string,
    message: { prompt: acp.ContentBlock[]; contextToken: string }
  ): Promise<void> {
    let session = this.sessions.get(userId);

    if (!session) {
      if (this.sessions.size >= this.opts.maxConcurrentUsers) {
        this.evictOldest();
      }

      session = await this.createSession(userId, message.contextToken);
      this.sessions.set(userId, session);
    }

    session.contextToken = message.contextToken;
    session.lastActivity = Date.now();
    session.queue.push(message);

    if (!session.processing) {
      session.processing = true;
      this.processQueue(session).catch((err) => {
        this.opts.log(`[${userId}] queue processing error: ${String(err)}`);
      });
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  hasSession(userId: string): boolean {
    return this.sessions.has(userId);
  }

  /** Kill and remove user's session — next message will create a fresh one */
  resetSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      killAgent(session.agentInfo.process);
      this.sessions.delete(userId);
      this.opts.log(`Session for ${userId} reset`);
    }
  }

  /** Toggle showThoughts for a specific user's session */
  toggleShowThoughts(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) return false;
    const newValue = !session.client.showThoughts;
    session.client.setShowThoughts(newValue);
    return newValue;
  }

  /** Get current model from project settings */
  getModel(): string {
    const settingsPath = join(this.opts.agentCwd, ".claude", "settings.json");
    try {
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        if (settings.model) return settings.model;
      }
    } catch {
      // ignore
    }
    return "sonnet (默认 / default)";
  }

  /** Switch model — writes to .claude/settings.json and restarts session */
  setModel(userId: string, model: string): void {
    const claudeDir = join(this.opts.agentCwd, ".claude");
    const settingsPath = join(claudeDir, "settings.json");

    // Read existing settings
    let settings: Record<string, unknown> = {};
    try {
      if (existsSync(settingsPath)) {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      }
    } catch {
      // start fresh
    }

    // Update model
    settings.model = model;
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    this.opts.log(`Model set to "${model}" in ${settingsPath}`);

    // Kill existing session so it restarts with new model
    const session = this.sessions.get(userId);
    if (session) {
      killAgent(session.agentInfo.process);
      this.sessions.delete(userId);
      this.opts.log(`Session for ${userId} killed for model switch`);
    }
  }

  private async createSession(
    userId: string,
    contextToken: string
  ): Promise<AcpUserSession> {
    this.opts.log(`Creating new session for ${userId}`);

    const client = new AcpClient({
      sendTyping: () => this.opts.sendTyping(userId, contextToken),
      onThoughtFlush: (text) => this.opts.onProgress(userId, contextToken, text),
      onToolProgress: (text) => this.opts.onProgress(userId, contextToken, text),
      onImageReceived: (data, mimeType) => this.opts.onImageReceived(userId, contextToken, data, mimeType),
      showThoughts: this.opts.showThoughts,
    });

    const agentInfo = await spawnAgent({
      command: this.opts.agentCommand,
      args: this.opts.agentArgs,
      cwd: this.opts.agentCwd,
      env: this.opts.agentEnv,
      client,
      log: (msg) => this.opts.log(`[${userId}] ${msg}`),
    });

    // If agent process exits, clean up the session
    agentInfo.process.on("exit", () => {
      const s = this.sessions.get(userId);
      if (s && s.agentInfo.process === agentInfo.process) {
        this.opts.log(`Agent process for ${userId} exited, removing session`);
        this.sessions.delete(userId);
      }
    });

    return {
      userId,
      contextToken,
      client,
      agentInfo,
      queue: [],
      processing: false,
      lastActivity: Date.now(),
    };
  }

  private async processQueue(session: AcpUserSession): Promise<void> {
    try {
      while (session.queue.length > 0 && !this.aborted) {
        const pending = session.queue.shift()!;

        // Update callbacks with latest contextToken
        session.client.updateCallbacks({
          sendTyping: () =>
            this.opts.sendTyping(session.userId, pending.contextToken),
          onThoughtFlush: (text) =>
            this.opts.onProgress(session.userId, pending.contextToken, text),
          onToolProgress: (text) =>
            this.opts.onProgress(session.userId, pending.contextToken, text),
          onImageReceived: (data, mimeType) =>
            this.opts.onImageReceived(session.userId, pending.contextToken, data, mimeType),
        });

        // Reset chunks for the new turn
        await session.client.flush();

        try {
          // Send typing immediately so user knows the prompt was received
          this.opts.sendTyping(session.userId, pending.contextToken).catch(() => {});

          // Send ACP prompt
          this.opts.log(`[${session.userId}] Sending prompt to agent...`);
          const promptStart = Date.now();
          const result = await session.agentInfo.connection.prompt({
            sessionId: session.agentInfo.sessionId,
            prompt: pending.prompt,
          });

          // Collect accumulated text
          let replyText = await session.client.flush();

          if (result.stopReason === "cancelled") {
            replyText += "\n[cancelled]";
          } else if (result.stopReason === "refusal") {
            replyText += "\n[agent refused to continue]";
          }

          const promptMs = Date.now() - promptStart;
          this.opts.log(
            `[${session.userId}] Agent done (${result.stopReason}) in ${promptMs}ms, reply ${replyText.length} chars`
          );

          if (replyText.trim()) {
            await this.opts.onReply(
              session.userId,
              pending.contextToken,
              replyText
            );
          }
        } catch (err) {
          this.opts.log(
            `[${session.userId}] Agent prompt error: ${String(err)}`
          );

          // Check if agent died
          if (
            session.agentInfo.process.killed ||
            session.agentInfo.process.exitCode !== null
          ) {
            this.opts.log(
              `[${session.userId}] Agent process died, removing session`
            );
            this.sessions.delete(session.userId);
            return;
          }

          try {
            await this.opts.onReply(
              session.userId,
              pending.contextToken,
              `Agent error: ${String(err)}`
            );
          } catch {
            // best effort
          }
        }

        session.lastActivity = Date.now();
      }
    } finally {
      session.processing = false;
    }
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (
        !session.processing &&
        now - session.lastActivity > this.opts.idleTimeoutMs
      ) {
        this.opts.log(
          `Session for ${userId} idle, removing`
        );
        killAgent(session.agentInfo.process);
        this.sessions.delete(userId);
      }
    }
  }

  private evictOldest(): void {
    let oldestUserId: string | null = null;
    let oldestTime = Infinity;

    for (const [userId, session] of this.sessions) {
      if (!session.processing && session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      this.opts.log(`Evicting oldest idle session: ${oldestUserId}`);
      const session = this.sessions.get(oldestUserId);
      if (session) killAgent(session.agentInfo.process);
      this.sessions.delete(oldestUserId);
    }
  }
}
