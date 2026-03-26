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

export interface TaskInfo {
  taskId: number;
  description: string;
  processing: boolean;
  queueLength: number;
  lastActivity: number;
}

interface AcpTask {
  taskId: number;
  description: string;
  client: AcpClient;
  agentInfo: AgentProcessInfo;
  queue: PendingMessage[];
  processing: boolean;
  lastActivity: number;
  contextToken: string;
}

interface UserTaskGroup {
  userId: string;
  tasks: Map<number, AcpTask>;
  activeTaskId: number;
  nextTaskId: number;
}

interface PendingMessage {
  prompt: acp.ContentBlock[];
  contextToken: string;
}

export class AcpSessionManager {
  private users = new Map<string, UserTaskGroup>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private opts: AcpSessionManagerOpts;
  private aborted = false;

  constructor(opts: AcpSessionManagerOpts) {
    this.opts = opts;
  }

  start(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleTasks();
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
    for (const [userId, group] of this.users) {
      for (const [taskId, task] of group.tasks) {
        this.opts.log(`Stopping task #${taskId} for ${userId}`);
        killAgent(task.agentInfo.process);
      }
    }
    this.users.clear();
  }

  /**
   * Enqueue a message to the user's active task.
   * Creates a default task if none exists.
   */
  async enqueue(
    userId: string,
    message: { prompt: acp.ContentBlock[]; contextToken: string }
  ): Promise<void> {
    let group = this.users.get(userId);

    if (!group) {
      group = {
        userId,
        tasks: new Map(),
        activeTaskId: 0,
        nextTaskId: 1,
      };
      this.users.set(userId, group);
    }

    // If no active task, create default one
    let task = group.tasks.get(group.activeTaskId);
    if (!task) {
      if (this.totalTaskCount() >= this.opts.maxConcurrentUsers * 5) {
        this.evictOldestTask();
      }
      const taskId = group.nextTaskId++;
      task = await this.createTask(userId, taskId, "default", message.contextToken);
      group.tasks.set(taskId, task);
      group.activeTaskId = taskId;
    }

    task.contextToken = message.contextToken;
    task.lastActivity = Date.now();
    task.queue.push(message);

    if (!task.processing) {
      task.processing = true;
      this.processQueue(userId, task).catch((err) => {
        this.opts.log(`[${userId}#${task!.taskId}] queue processing error: ${String(err)}`);
      });
    }
  }

  /**
   * Create a new parallel task for the user. Returns the task ID.
   */
  async createNewTask(
    userId: string,
    contextToken: string,
    description: string
  ): Promise<number> {
    let group = this.users.get(userId);
    if (!group) {
      group = {
        userId,
        tasks: new Map(),
        activeTaskId: 0,
        nextTaskId: 1,
      };
      this.users.set(userId, group);
    }

    if (this.totalTaskCount() >= this.opts.maxConcurrentUsers * 5) {
      this.evictOldestTask();
    }

    const taskId = group.nextTaskId++;
    const task = await this.createTask(userId, taskId, description || `task-${taskId}`, contextToken);
    group.tasks.set(taskId, task);
    group.activeTaskId = taskId;

    return taskId;
  }

  /**
   * Switch the user's active task. Returns true if successful.
   */
  switchTask(userId: string, taskId: number): boolean {
    const group = this.users.get(userId);
    if (!group) return false;
    if (!group.tasks.has(taskId)) return false;
    group.activeTaskId = taskId;
    return true;
  }

  /**
   * End a specific task (or the active one if taskId is 0).
   * Returns the ended task ID, or 0 if not found.
   */
  endTask(userId: string, taskId?: number): number {
    const group = this.users.get(userId);
    if (!group) return 0;

    const targetId = taskId ?? group.activeTaskId;
    const task = group.tasks.get(targetId);
    if (!task) return 0;

    killAgent(task.agentInfo.process);
    group.tasks.delete(targetId);
    this.opts.log(`Task #${targetId} for ${userId} ended`);

    // If we ended the active task, switch to another one
    if (group.activeTaskId === targetId) {
      const remaining = [...group.tasks.keys()];
      group.activeTaskId = remaining.length > 0 ? remaining[remaining.length - 1] : 0;
    }

    // Clean up empty group
    if (group.tasks.size === 0) {
      this.users.delete(userId);
    }

    return targetId;
  }

  /**
   * List all tasks for a user.
   */
  listTasks(userId: string): { tasks: TaskInfo[]; activeTaskId: number } {
    const group = this.users.get(userId);
    if (!group || group.tasks.size === 0) {
      return { tasks: [], activeTaskId: 0 };
    }

    const tasks: TaskInfo[] = [];
    for (const [, task] of group.tasks) {
      tasks.push({
        taskId: task.taskId,
        description: task.description,
        processing: task.processing,
        queueLength: task.queue.length,
        lastActivity: task.lastActivity,
      });
    }

    return { tasks, activeTaskId: group.activeTaskId };
  }

  /**
   * Get the active task ID for a user (0 if none).
   */
  getActiveTaskId(userId: string): number {
    const group = this.users.get(userId);
    return group?.activeTaskId ?? 0;
  }

  get sessionCount(): number {
    return this.users.size;
  }

  hasSession(userId: string): boolean {
    const group = this.users.get(userId);
    return !!group && group.tasks.size > 0;
  }

  /** Kill and remove ALL tasks for a user — next message will create a fresh one */
  resetSession(userId: string): void {
    const group = this.users.get(userId);
    if (group) {
      for (const [, task] of group.tasks) {
        killAgent(task.agentInfo.process);
      }
      this.users.delete(userId);
      this.opts.log(`All tasks for ${userId} reset`);
    }
  }

  /** Toggle showThoughts for all tasks of a specific user */
  toggleShowThoughts(userId: string): boolean {
    const group = this.users.get(userId);
    if (!group || group.tasks.size === 0) return false;

    // Toggle based on the active task's current value
    const activeTask = group.tasks.get(group.activeTaskId);
    const newValue = activeTask ? !activeTask.client.showThoughts : true;

    for (const [, task] of group.tasks) {
      task.client.setShowThoughts(newValue);
    }
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

  /** Switch model — writes to .claude/settings.json and restarts all sessions */
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

    // Kill all tasks for this user so they restart with new model
    this.resetSession(userId);
  }

  // -- Private --

  private totalTaskCount(): number {
    let count = 0;
    for (const [, group] of this.users) {
      count += group.tasks.size;
    }
    return count;
  }

  private async createTask(
    userId: string,
    taskId: number,
    description: string,
    contextToken: string
  ): Promise<AcpTask> {
    this.opts.log(`Creating task #${taskId} for ${userId}: "${description}"`);

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
      log: (msg) => this.opts.log(`[${userId}#${taskId}] ${msg}`),
    });

    // If agent process exits, clean up the task
    agentInfo.process.on("exit", () => {
      const group = this.users.get(userId);
      if (group) {
        const task = group.tasks.get(taskId);
        if (task && task.agentInfo.process === agentInfo.process) {
          this.opts.log(`Agent process for ${userId}#${taskId} exited, removing task`);
          group.tasks.delete(taskId);
          if (group.activeTaskId === taskId) {
            const remaining = [...group.tasks.keys()];
            group.activeTaskId = remaining.length > 0 ? remaining[remaining.length - 1] : 0;
          }
          if (group.tasks.size === 0) {
            this.users.delete(userId);
          }
        }
      }
    });

    return {
      taskId,
      description,
      client,
      agentInfo,
      queue: [],
      processing: false,
      lastActivity: Date.now(),
      contextToken,
    };
  }

  private async processQueue(userId: string, task: AcpTask): Promise<void> {
    try {
      while (task.queue.length > 0 && !this.aborted) {
        const pending = task.queue.shift()!;

        // Update callbacks with latest contextToken
        task.client.updateCallbacks({
          sendTyping: () =>
            this.opts.sendTyping(userId, pending.contextToken),
          onThoughtFlush: (text) =>
            this.opts.onProgress(userId, pending.contextToken, text),
          onToolProgress: (text) =>
            this.opts.onProgress(userId, pending.contextToken, text),
          onImageReceived: (data, mimeType) =>
            this.opts.onImageReceived(userId, pending.contextToken, data, mimeType),
        });

        // Reset chunks for the new turn
        await task.client.flush();

        try {
          // Send typing immediately so user knows the prompt was received
          this.opts.sendTyping(userId, pending.contextToken).catch(() => {});

          // Send ACP prompt
          this.opts.log(`[${userId}#${task.taskId}] Sending prompt to agent...`);
          const promptStart = Date.now();
          const result = await task.agentInfo.connection.prompt({
            sessionId: task.agentInfo.sessionId,
            prompt: pending.prompt,
          });

          // Collect accumulated text
          let replyText = await task.client.flush();

          if (result.stopReason === "cancelled") {
            replyText += "\n[cancelled]";
          } else if (result.stopReason === "refusal") {
            replyText += "\n[agent refused to continue]";
          }

          const promptMs = Date.now() - promptStart;
          this.opts.log(
            `[${userId}#${task.taskId}] Agent done (${result.stopReason}) in ${promptMs}ms, reply ${replyText.length} chars`
          );

          // Prefix reply with task ID if user has multiple tasks
          const group = this.users.get(userId);
          const hasMultipleTasks = group && group.tasks.size > 1;

          if (replyText.trim()) {
            const prefix = hasMultipleTasks ? `[Task #${task.taskId}] ` : "";
            await this.opts.onReply(
              userId,
              pending.contextToken,
              prefix + replyText
            );
          }
        } catch (err) {
          this.opts.log(
            `[${userId}#${task.taskId}] Agent prompt error: ${String(err)}`
          );

          // Check if agent died
          if (
            task.agentInfo.process.killed ||
            task.agentInfo.process.exitCode !== null
          ) {
            this.opts.log(
              `[${userId}#${task.taskId}] Agent process died, removing task`
            );
            const group = this.users.get(userId);
            if (group) {
              group.tasks.delete(task.taskId);
              if (group.activeTaskId === task.taskId) {
                const remaining = [...group.tasks.keys()];
                group.activeTaskId = remaining.length > 0 ? remaining[remaining.length - 1] : 0;
              }
              if (group.tasks.size === 0) {
                this.users.delete(userId);
              }
            }
            return;
          }

          try {
            await this.opts.onReply(
              userId,
              pending.contextToken,
              `[Task #${task.taskId}] Agent error: ${String(err)}`
            );
          } catch {
            // best effort
          }
        }

        task.lastActivity = Date.now();
      }
    } finally {
      task.processing = false;
    }
  }

  private cleanupIdleTasks(): void {
    const now = Date.now();
    for (const [userId, group] of this.users) {
      for (const [taskId, task] of group.tasks) {
        if (
          !task.processing &&
          now - task.lastActivity > this.opts.idleTimeoutMs
        ) {
          this.opts.log(`Task #${taskId} for ${userId} idle, removing`);
          killAgent(task.agentInfo.process);
          group.tasks.delete(taskId);
        }
      }

      // Update activeTaskId if it was cleaned up
      if (!group.tasks.has(group.activeTaskId)) {
        const remaining = [...group.tasks.keys()];
        group.activeTaskId = remaining.length > 0 ? remaining[remaining.length - 1] : 0;
      }

      // Remove empty group
      if (group.tasks.size === 0) {
        this.users.delete(userId);
      }
    }
  }

  private evictOldestTask(): void {
    let oldestUserId: string | null = null;
    let oldestTaskId: number | null = null;
    let oldestTime = Infinity;

    for (const [userId, group] of this.users) {
      for (const [taskId, task] of group.tasks) {
        if (!task.processing && task.lastActivity < oldestTime) {
          oldestTime = task.lastActivity;
          oldestUserId = userId;
          oldestTaskId = taskId;
        }
      }
    }

    if (oldestUserId && oldestTaskId !== null) {
      this.opts.log(`Evicting oldest idle task: ${oldestUserId}#${oldestTaskId}`);
      const group = this.users.get(oldestUserId);
      if (group) {
        const task = group.tasks.get(oldestTaskId);
        if (task) killAgent(task.agentInfo.process);
        group.tasks.delete(oldestTaskId);
        if (group.activeTaskId === oldestTaskId) {
          const remaining = [...group.tasks.keys()];
          group.activeTaskId = remaining.length > 0 ? remaining[remaining.length - 1] : 0;
        }
        if (group.tasks.size === 0) {
          this.users.delete(oldestUserId);
        }
      }
    }
  }
}
