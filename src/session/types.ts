import type { Conversation } from "../claude/conversation.js";

export interface UserSession {
  userId: string;
  conversation: Conversation;
  lastActivity: number;
  processing: boolean;
}

export interface SessionManagerConfig {
  maxConcurrentUsers: number;
  maxConversationTurns: number;
  idleTimeoutMs: number;
  resetKeywords: string[];
}
