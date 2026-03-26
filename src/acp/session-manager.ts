/**
 * ACP Session Manager — manages per-user agent subprocess sessions.
 * Each user gets their own agent process with independent conversation.
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
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [, session] of this.sessions) {
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
      // Evict oldest if at capacity
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
      this.processQueue(session);
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  private async createSession(
    userId: string,
    contextToken: string
  ): Promise<AcpUserSession> {
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
    });

    const session: AcpUserSession = {
      userId,
      contextToken,
      client,
      agentInfo,
      queue: [],
      processing: false,
      lastActivity: Date.now(),
    };

    // Clean up session if agent process exits
    agentInfo.process.on("exit", () => {
      this.sessions.delete(userId);
    });

    return session;
  }

  private async processQueue(session: AcpUserSession): Promise<void> {
    session.processing = true;

    while (session.queue.length > 0) {
      const msg = session.queue.shift()!;

      // Update callbacks with latest contextToken
      session.client.updateCallbacks({
        sendTyping: () =>
          this.opts.sendTyping(session.userId, msg.contextToken),
        onThoughtFlush: (text) =>
          this.opts.onReply(session.userId, msg.contextToken, text),
        onToolProgress: (text) =>
          this.opts.onReply(session.userId, msg.contextToken, text),
      });

      try {
        await session.client.flush(); // Reset chunks
        await this.opts.sendTyping(session.userId, msg.contextToken);

        await session.agentInfo.connection.prompt({
          sessionId: session.agentInfo.sessionId,
          prompt: msg.prompt,
        });

        const text = await session.client.flush();
        if (text.trim()) {
          await this.opts.onReply(session.userId, msg.contextToken, text);
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[acp] Error processing message for ${session.userId}:`,
          errorMsg
        );
        try {
          await this.opts.onReply(
            session.userId,
            msg.contextToken,
            `[Agent error: ${errorMsg}]`
          );
        } catch {
          // best effort
        }
      }

      session.lastActivity = Date.now();
    }

    session.processing = false;
  }

  private cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (
        !session.processing &&
        now - session.lastActivity > this.opts.idleTimeoutMs
      ) {
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
      const session = this.sessions.get(oldestUserId);
      if (session) {
        killAgent(session.agentInfo.process);
      }
      this.sessions.delete(oldestUserId);
    }
  }
}
