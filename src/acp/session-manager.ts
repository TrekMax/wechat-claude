/**
 * Per-user ACP session manager.
 * Each WeChat user gets their own agent subprocess + ACP session.
 * Messages are queued per-user to ensure serialized processing.
 *
 * Based on wechat-acp/src/acp/session.ts
 */

import type * as acp from "@agentclientprotocol/sdk";
import { AcpClient } from "./client.js";
import { spawnAgent, killAgent, type AgentProcessInfo } from "./agent-manager.js";

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

  /** Toggle showThoughts for a specific user's session */
  toggleShowThoughts(userId: string): boolean {
    const session = this.sessions.get(userId);
    if (!session) return false;
    const newValue = !session.client.showThoughts;
    session.client.setShowThoughts(newValue);
    return newValue;
  }

  private async createSession(
    userId: string,
    contextToken: string
  ): Promise<AcpUserSession> {
    this.opts.log(`Creating new session for ${userId}`);

    const client = new AcpClient({
      sendTyping: () => this.opts.sendTyping(userId, contextToken),
      onThoughtFlush: (text) => this.opts.onReply(userId, contextToken, text),
      onToolProgress: (text) => this.opts.onReply(userId, contextToken, text),
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
            this.opts.onReply(session.userId, pending.contextToken, text),
          onToolProgress: (text) =>
            this.opts.onReply(session.userId, pending.contextToken, text),
        });

        // Reset chunks for the new turn
        await session.client.flush();

        try {
          // Send typing immediately so user knows the prompt was received
          this.opts.sendTyping(session.userId, pending.contextToken).catch(() => {});

          // Send ACP prompt
          this.opts.log(`[${session.userId}] Sending prompt to agent...`);
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

          this.opts.log(
            `[${session.userId}] Agent done (${result.stopReason}), reply ${replyText.length} chars`
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
