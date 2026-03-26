import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeClient } from "../../src/claude/client.js";
import type { ConversationTurn } from "../../src/claude/types.js";

// Shared mock for messages.create — all Anthropic instances share this
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  return { default: MockAnthropic };
});

describe("ClaudeClient", () => {
  let client: ClaudeClient;

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello from Claude!" }],
      usage: { input_tokens: 10, output_tokens: 5 },
      stop_reason: "end_turn",
    });

    client = new ClaudeClient({
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
    });
  });

  it("should send messages and return structured response", async () => {
    const turns: ConversationTurn[] = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];

    const response = await client.chat(turns, "You are helpful.");

    expect(response).toMatchObject({
      text: "Hello from Claude!",
      inputTokens: 10,
      outputTokens: 5,
      stopReason: "end_turn",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: "You are helpful.",
      })
    );
  });

  it("should handle image content blocks in request", async () => {
    const turns: ConversationTurn[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "abc123",
            },
          },
          { type: "text", text: "What is in this image?" },
        ],
      },
    ];

    const response = await client.chat(turns, "You are helpful.");
    expect(response.text).toBe("Hello from Claude!");
  });

  it("should handle empty response content", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
      stop_reason: "end_turn",
    });

    const response = await client.chat(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      "test"
    );
    expect(response.text).toBe("");
  });
});
