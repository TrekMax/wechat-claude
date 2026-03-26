import { Conversation } from "../claude/conversation.js";
import type { UserSession, SessionManagerConfig } from "./types.js";

export class SessionManager {
  private sessions = new Map<string, UserSession>();
  private config: SessionManagerConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionManagerConfig) {
    this.config = config;

    // Periodic cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, 5 * 60 * 1000);

    // Prevent timer from keeping process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  getOrCreateSession(userId: string): UserSession {
    const existing = this.sessions.get(userId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Evict oldest if at capacity
    if (this.sessions.size >= this.config.maxConcurrentUsers) {
      this.evictOldest();
    }

    const session: UserSession = {
      userId,
      conversation: new Conversation(this.config.maxConversationTurns),
      lastActivity: Date.now(),
      processing: false,
    };

    this.sessions.set(userId, session);
    return session;
  }

  hasSession(userId: string): boolean {
    return this.sessions.has(userId);
  }

  resetSession(userId: string): void {
    const session = this.sessions.get(userId);
    if (session) {
      session.conversation.reset();
      session.lastActivity = Date.now();
    }
  }

  isResetCommand(text: string): boolean {
    return this.config.resetKeywords.includes(text.trim().toLowerCase());
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  cleanupIdleSessions(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.lastActivity > this.config.idleTimeoutMs) {
        this.sessions.delete(userId);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  private evictOldest(): void {
    let oldestUserId: string | null = null;
    let oldestTime = Infinity;

    for (const [userId, session] of this.sessions) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldestUserId = userId;
      }
    }

    if (oldestUserId) {
      this.sessions.delete(oldestUserId);
    }
  }
}

export type { UserSession, SessionManagerConfig };
