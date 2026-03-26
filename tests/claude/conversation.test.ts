import { describe, it, expect } from "vitest";
import { Conversation } from "../../src/claude/conversation.js";

describe("Conversation", () => {
  it("should start with empty history", () => {
    const conv = new Conversation(50);
    expect(conv.getHistory()).toEqual([]);
  });

  it("should add user and assistant turns", () => {
    const conv = new Conversation(50);
    conv.addUserMessage([{ type: "text", text: "hello" }]);
    conv.addAssistantMessage("hi there");

    const history = conv.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
  });

  it("should trim oldest turns when exceeding max", () => {
    const conv = new Conversation(4); // 4 turns max = 2 pairs

    conv.addUserMessage([{ type: "text", text: "msg1" }]);
    conv.addAssistantMessage("reply1");
    conv.addUserMessage([{ type: "text", text: "msg2" }]);
    conv.addAssistantMessage("reply2");
    conv.addUserMessage([{ type: "text", text: "msg3" }]);
    conv.addAssistantMessage("reply3");

    const history = conv.getHistory();
    expect(history).toHaveLength(4);
    // Oldest pair (msg1/reply1) should be removed
    expect(
      (history[0].content[0] as { type: "text"; text: string }).text
    ).toBe("msg2");
  });

  it("should preserve image content blocks in history", () => {
    const conv = new Conversation(50);
    conv.addUserMessage([
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "abc123" },
      },
    ]);

    const history = conv.getHistory();
    expect(history[0].content[0]).toMatchObject({
      type: "image",
      source: { type: "base64" },
    });
  });

  it("should reset conversation", () => {
    const conv = new Conversation(50);
    conv.addUserMessage([{ type: "text", text: "hello" }]);
    conv.addAssistantMessage("hi");
    conv.reset();

    expect(conv.getHistory()).toEqual([]);
  });

  it("should trim in pairs to keep conversation coherent", () => {
    const conv = new Conversation(3); // odd max
    conv.addUserMessage([{ type: "text", text: "msg1" }]);
    conv.addAssistantMessage("reply1");
    conv.addUserMessage([{ type: "text", text: "msg2" }]);
    conv.addAssistantMessage("reply2");

    const history = conv.getHistory();
    // Should trim to keep pairs intact: remove pair, keep 2 turns
    expect(history.length).toBeLessThanOrEqual(3);
    // First entry should be a user message (pairs stay aligned)
    if (history.length > 0) {
      expect(history[0].role).toBe("user");
    }
  });
});
