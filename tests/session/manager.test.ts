import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/session/manager.js";
import type { UserSession } from "../../src/session/types.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      maxConcurrentUsers: 3,
      maxConversationTurns: 50,
      idleTimeoutMs: 60_000,
      resetKeywords: ["/reset", "/new", "/clear"],
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  it("should create a new session for unknown user", () => {
    const session = manager.getOrCreateSession("user1");
    expect(session).toBeDefined();
    expect(session.userId).toBe("user1");
  });

  it("should return existing session for known user", () => {
    const s1 = manager.getOrCreateSession("user1");
    const s2 = manager.getOrCreateSession("user1");
    expect(s1).toBe(s2);
  });

  it("should track multiple users independently", () => {
    const s1 = manager.getOrCreateSession("user1");
    const s2 = manager.getOrCreateSession("user2");
    expect(s1).not.toBe(s2);
    expect(s1.userId).toBe("user1");
    expect(s2.userId).toBe("user2");
  });

  it("should evict oldest session when at capacity", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      manager.getOrCreateSession("user1");
      vi.setSystemTime(2000);
      manager.getOrCreateSession("user2");
      vi.setSystemTime(3000);
      manager.getOrCreateSession("user3");

      // Touch user1 to make user2 the oldest
      vi.setSystemTime(4000);
      manager.getOrCreateSession("user1");

      vi.setSystemTime(5000);
      const s4 = manager.getOrCreateSession("user4");
      expect(s4.userId).toBe("user4");
      expect(manager.hasSession("user2")).toBe(false);
      expect(manager.hasSession("user1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should detect reset keywords", () => {
    expect(manager.isResetCommand("/reset")).toBe(true);
    expect(manager.isResetCommand("/new")).toBe(true);
    expect(manager.isResetCommand("/clear")).toBe(true);
    expect(manager.isResetCommand("hello")).toBe(false);
    expect(manager.isResetCommand("/RESET")).toBe(true);
  });

  it("should reset a user session", () => {
    const session = manager.getOrCreateSession("user1");
    session.conversation.addUserMessage([{ type: "text", text: "hello" }]);
    session.conversation.addAssistantMessage("hi");

    manager.resetSession("user1");

    const reset = manager.getOrCreateSession("user1");
    expect(reset.conversation.getHistory()).toHaveLength(0);
  });

  it("should report session count", () => {
    expect(manager.sessionCount).toBe(0);
    manager.getOrCreateSession("user1");
    expect(manager.sessionCount).toBe(1);
    manager.getOrCreateSession("user2");
    expect(manager.sessionCount).toBe(2);
  });

  it("should clean up idle sessions", () => {
    vi.useFakeTimers();
    try {
      manager.getOrCreateSession("user1");
      // Advance time past idle timeout
      vi.advanceTimersByTime(61_000);
      manager.cleanupIdleSessions();
      expect(manager.hasSession("user1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should not clean up active sessions", () => {
    vi.useFakeTimers();
    try {
      manager.getOrCreateSession("user1");
      vi.advanceTimersByTime(30_000); // Half of idle timeout
      manager.cleanupIdleSessions();
      expect(manager.hasSession("user1")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
