import { Conversation } from "../claude/conversation.js";
export class SessionManager {
    sessions = new Map();
    config;
    cleanupTimer = null;
    constructor(config) {
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
    getOrCreateSession(userId) {
        const existing = this.sessions.get(userId);
        if (existing) {
            existing.lastActivity = Date.now();
            return existing;
        }
        // Evict oldest if at capacity
        if (this.sessions.size >= this.config.maxConcurrentUsers) {
            this.evictOldest();
        }
        const session = {
            userId,
            conversation: new Conversation(this.config.maxConversationTurns),
            lastActivity: Date.now(),
            processing: false,
        };
        this.sessions.set(userId, session);
        return session;
    }
    hasSession(userId) {
        return this.sessions.has(userId);
    }
    resetSession(userId) {
        const session = this.sessions.get(userId);
        if (session) {
            session.conversation.reset();
            session.lastActivity = Date.now();
        }
    }
    isResetCommand(text) {
        return this.config.resetKeywords.includes(text.trim().toLowerCase());
    }
    get sessionCount() {
        return this.sessions.size;
    }
    cleanupIdleSessions() {
        const now = Date.now();
        for (const [userId, session] of this.sessions) {
            if (now - session.lastActivity > this.config.idleTimeoutMs) {
                this.sessions.delete(userId);
            }
        }
    }
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.sessions.clear();
    }
    evictOldest() {
        let oldestUserId = null;
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
//# sourceMappingURL=manager.js.map