import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WeChatClaudeBridge } from "../src/bridge.js";
import type { WeChatClaudeConfig } from "../src/config.js";

// Mock ClaudeClient
const mockChat = vi.fn();
vi.mock("../src/claude/client.js", () => ({
  ClaudeClient: vi.fn().mockImplementation(() => ({
    chat: mockChat,
  })),
}));

// Mock WeChat SDK
const mockSendText = vi.fn();
const mockOnMessage = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock("@xmccln/wechat-ilink-sdk", () => ({
  WeixinSDK: vi.fn().mockImplementation(() => ({
    sendText: mockSendText,
    start: mockStart,
    stop: mockStop,
    onMessage: mockOnMessage,
  })),
  TokenAuthProvider: vi.fn(),
  MediaDownloader: vi.fn().mockImplementation(() => ({
    downloadImage: vi.fn().mockResolvedValue(null),
  })),
}));

function makeConfig(): WeChatClaudeConfig {
  return {
    wechat: {
      baseUrl: "https://ilinkai.weixin.qq.com",
      cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
      botType: "3",
    },
    claude: {
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      systemPrompt: "You are helpful.",
    },
    session: {
      idleTimeoutMs: 86400000,
      maxConcurrentUsers: 10,
      maxConversationTurns: 50,
      resetKeywords: ["/reset", "/new", "/clear"],
    },
    storage: { dir: "/tmp/wechat-claude-test" },
  };
}

// Helper: create SDK-shaped message
function makeTextMsg(text: string, userId = "user1", contextToken = "ctx1") {
  return {
    from_user_id: userId,
    context_token: contextToken,
    message_type: 1,
    item_list: [{ type: 1, text_item: { text } }],
  };
}

describe("WeChatClaudeBridge", () => {
  let bridge: WeChatClaudeBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue({
      text: "Hello! How can I help?",
      inputTokens: 10,
      outputTokens: 8,
      stopReason: "end_turn",
    });
    mockSendText.mockResolvedValue(undefined);
    bridge = new WeChatClaudeBridge(makeConfig(), "test-token");
  });

  afterEach(() => {
    bridge.destroy();
  });

  it("should register message handler on construction", () => {
    expect(mockOnMessage).toHaveBeenCalledTimes(1);
    expect(typeof mockOnMessage.mock.calls[0][0]).toBe("function");
  });

  it("should process text message and reply via Claude", async () => {
    await bridge.processMessage(makeTextMsg("Hello"));

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      "Hello! How can I help?",
      "ctx1"
    );
  });

  it("should handle reset command without calling Claude", async () => {
    await bridge.processMessage(makeTextMsg("/reset"));

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      expect.stringContaining("reset"),
      "ctx1"
    );
  });

  it("should handle Claude API errors gracefully", async () => {
    mockChat.mockRejectedValueOnce(new Error("API rate limited"));

    await bridge.processMessage(makeTextMsg("hello"));

    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      expect.stringContaining("error"),
      "ctx1"
    );
  });

  it("should split long responses into multiple messages", async () => {
    mockChat.mockResolvedValueOnce({
      text: "a".repeat(5000),
      inputTokens: 10,
      outputTokens: 500,
      stopReason: "end_turn",
    });

    await bridge.processMessage(makeTextMsg("tell me a lot"));

    expect(mockSendText).toHaveBeenCalledTimes(2);
  });

  it("should maintain conversation history across messages", async () => {
    await bridge.processMessage(makeTextMsg("first message"));
    await bridge.processMessage(makeTextMsg("second message", "user1", "ctx2"));

    // Second call should include full conversation history
    const secondCall = mockChat.mock.calls[1];
    const messages = secondCall[0];
    // user, assistant, user = 3 turns
    expect(messages).toHaveLength(3);
  });

  it("should ignore messages without userId or contextToken", async () => {
    await bridge.processMessage({
      item_list: [{ type: 1, text_item: { text: "hi" } }],
    });

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });
});
