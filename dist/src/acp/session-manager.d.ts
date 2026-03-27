/**
 * Per-user ACP session manager with multi-task support.
 * Each WeChat user can run multiple concurrent agent tasks.
 * Each task gets its own agent subprocess + ACP session.
 *
 * Commands:
 *   /task new [description]  — Create a new parallel task
 *   /task list               — List all active tasks
 *   /task <id>               — Switch active task
 *   /task end [id]           — End a specific task (or current)
 *
 * Regular messages are routed to the user's active task.
 */
import type * as acp from "@agentclientprotocol/sdk";
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
    onFileReceived: (userId: string, contextToken: string, data: Buffer, fileName: string, mimeType: string) => Promise<void>;
    sendTyping: (userId: string, contextToken: string) => Promise<void>;
}
export interface TaskInfo {
    taskId: number;
    description: string;
    processing: boolean;
    queueLength: number;
    lastActivity: number;
}
export declare class AcpSessionManager {
    private users;
    private cleanupTimer;
    private opts;
    private aborted;
    constructor(opts: AcpSessionManagerOpts);
    start(): void;
    stop(): Promise<void>;
    /**
     * Enqueue a message to the user's active task.
     * Creates a default task if none exists.
     */
    enqueue(userId: string, message: {
        prompt: acp.ContentBlock[];
        contextToken: string;
    }): Promise<void>;
    /**
     * Create a new parallel task for the user. Returns the task ID.
     */
    createNewTask(userId: string, contextToken: string, description: string): Promise<number>;
    /**
     * Switch the user's active task. Returns true if successful.
     */
    switchTask(userId: string, taskId: number): boolean;
    /**
     * End a specific task (or the active one if taskId is 0).
     * Returns the ended task ID, or 0 if not found.
     */
    endTask(userId: string, taskId?: number): number;
    /**
     * List all tasks for a user.
     */
    listTasks(userId: string): {
        tasks: TaskInfo[];
        activeTaskId: number;
    };
    /**
     * Get the active task ID for a user (0 if none).
     */
    getActiveTaskId(userId: string): number;
    get sessionCount(): number;
    hasSession(userId: string): boolean;
    /** Kill and remove ALL tasks for a user — next message will create a fresh one */
    resetSession(userId: string): void;
    /** Toggle showThoughts for all tasks of a specific user */
    toggleShowThoughts(userId: string): boolean;
    /** Get current model from project settings */
    getModel(): string;
    /** Switch model — writes to .claude/settings.json and restarts all sessions */
    setModel(userId: string, model: string): void;
    private totalTaskCount;
    private createTask;
    private processQueue;
    private cleanupIdleTasks;
    private evictOldestTask;
}
//# sourceMappingURL=session-manager.d.ts.map