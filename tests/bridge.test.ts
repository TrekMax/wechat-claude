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
const mockSendTyping = vi.fn();
const mockOnMessage = vi.fn();
const mockStart = vi.fn();
const mockStop = vi.fn();

vi.mock("@xmccln/wechat-ilink-sdk", () => ({
  WeixinSDK: vi.fn().mockImplementation(() => ({
    sendText: mockSendText,
    start: mockStart,
    stop: mockStop,
    onMessage: mockOnMessage,
    messaging: {
      sender: { sendTyping: mockSendTyping },
    },
  })),
  TokenAuthProvider: vi.fn(),
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
    const handler = mockOnMessage.mock.calls[0][0];
    mockSendText.mockResolvedValue(undefined);

    await handler({
      msg_type: 1,
      content: { text: "Hello" },
      from_user_id: "user1",
      context_token: "ctx1",
    });

    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      "Hello! How can I help?",
      "ctx1"
    );
  });

  it("should handle reset command without calling Claude", async () => {
    const handler = mockOnMessage.mock.calls[0][0];
    mockSendText.mockResolvedValue(undefined);

    await handler({
      msg_type: 1,
      content: { text: "/reset" },
      from_user_id: "user1",
      context_token: "ctx1",
    });

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      expect.stringContaining("reset"),
      "ctx1"
    );
  });

  it("should handle Claude API errors gracefully", async () => {
    const handler = mockOnMessage.mock.calls[0][0];
    mockChat.mockRejectedValueOnce(new Error("API rate limited"));
    mockSendText.mockResolvedValue(undefined);

    await handler({
      msg_type: 1,
      content: { text: "hello" },
      from_user_id: "user1",
      context_token: "ctx1",
    });

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
    mockSendText.mockResolvedValue(undefined);

    const handler = mockOnMessage.mock.calls[0][0];
    await handler({
      msg_type: 1,
      content: { text: "tell me a lot" },
      from_user_id: "user1",
      context_token: "ctx1",
    });

    expect(mockSendText).toHaveBeenCalledTimes(2);
  });

  it("should maintain conversation history across messages", async () => {
    const handler = mockOnMessage.mock.calls[0][0];
    mockSendText.mockResolvedValue(undefined);

    await handler({
      msg_type: 1,
      content: { text: "first message" },
      from_user_id: "user1",
      context_token: "ctx1",
    });

    await handler({
      msg_type: 1,
      content: { text: "second message" },
      from_user_id: "user1",
      context_token: "ctx2",
    });

    // Second call should include full conversation history
    const secondCall = mockChat.mock.calls[1];
    const messages = secondCall[0];
    // user, assistant, user = 3 turns
    expect(messages).toHaveLength(3);
  });
});
