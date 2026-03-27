import type { UserSession, SessionManagerConfig } from "./types.js";
export declare class SessionManager {
    private sessions;
    private config;
    private cleanupTimer;
    constructor(config: SessionManagerConfig);
    getOrCreateSession(userId: string): UserSession;
    hasSession(userId: string): boolean;
    resetSession(userId: string): void;
    isResetCommand(text: string): boolean;
    get sessionCount(): number;
    cleanupIdleSessions(): void;
    destroy(): void;
    private evictOldest;
}
export type { UserSession, SessionManagerConfig };
//# sourceMappingURL=manager.d.ts.map