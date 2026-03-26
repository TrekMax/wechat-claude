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

// Mock AcpSessionManager
const mockAcpEnqueue = vi.fn();
const mockAcpStart = vi.fn();
const mockAcpStop = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/acp/session-manager.js", () => ({
  AcpSessionManager: vi.fn().mockImplementation(() => ({
    enqueue: mockAcpEnqueue,
    start: mockAcpStart,
    stop: mockAcpStop,
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
    messaging: { sender: { sendMedia: vi.fn().mockResolvedValue(undefined) } },
  })),
  TokenAuthProvider: vi.fn(),
  MediaDownloader: vi.fn().mockImplementation(() => ({
    downloadImage: vi.fn().mockResolvedValue(null),
    downloadFirstMedia: vi.fn().mockResolvedValue(null),
  })),
  ApiClient: vi.fn().mockImplementation(() => ({
    setAuthToken: vi.fn(),
  })),
  ApiEndpoints: vi.fn().mockImplementation(() => ({
    getConfig: vi.fn().mockResolvedValue({ typing_ticket: "test-ticket" }),
    sendTyping: vi.fn().mockResolvedValue({}),
  })),
}));

function makeApiConfig(): WeChatClaudeConfig {
  return {
    mode: "api",
    debug: false,
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
    agent: {
      command: "",
      args: [],
      cwd: "/tmp",
      showThoughts: false,
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

function makeAcpConfig(): WeChatClaudeConfig {
  return {
    ...makeApiConfig(),
    mode: "acp",
    agent: {
      command: "npx",
      args: ["@anthropic-ai/claude-code", "--acp"],
      cwd: "/tmp",
      showThoughts: false,
    },
  };
}

function makeTextMsg(text: string, userId = "user1", contextToken = "ctx1") {
  return {
    from_user_id: userId,
    context_token: contextToken,
    message_type: 1,
    item_list: [{ type: 1, text_item: { text } }],
  };
}

describe("WeChatClaudeBridge — API mode", () => {
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
    bridge = new WeChatClaudeBridge(makeApiConfig(), "test-token");
  });

  afterEach(() => {
    bridge.destroy();
  });

  it("should process text message and reply via Claude API", async () => {
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
      expect.stringContaining("Error"),
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

    const secondCall = mockChat.mock.calls[1];
    const messages = secondCall[0];
    expect(messages).toHaveLength(3); // user, assistant, user
  });

  it("should ignore messages without userId or contextToken", async () => {
    await bridge.processMessage({
      item_list: [{ type: 1, text_item: { text: "hi" } }],
    });

    expect(mockChat).not.toHaveBeenCalled();
    expect(mockSendText).not.toHaveBeenCalled();
  });
});

describe("WeChatClaudeBridge — ACP mode", () => {
  let bridge: WeChatClaudeBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendText.mockResolvedValue(undefined);
    mockAcpEnqueue.mockResolvedValue(undefined);
    bridge = new WeChatClaudeBridge(makeAcpConfig(), "test-token");
  });

  afterEach(() => {
    bridge.destroy();
  });

  it("should enqueue message to ACP session manager", async () => {
    await bridge.processMessage(makeTextMsg("Hello"));

    expect(mockAcpEnqueue).toHaveBeenCalledTimes(1);
    expect(mockAcpEnqueue).toHaveBeenCalledWith("user1", {
      prompt: [{ type: "text", text: "Hello" }],
      contextToken: "ctx1",
    });
  });

  it("should not use Claude API in ACP mode", async () => {
    await bridge.processMessage(makeTextMsg("Hello"));

    expect(mockChat).not.toHaveBeenCalled();
  });

  it("should ignore messages without userId", async () => {
    await bridge.processMessage({
      item_list: [{ type: 1, text_item: { text: "hi" } }],
    });

    expect(mockAcpEnqueue).not.toHaveBeenCalled();
  });

  it("should handle ACP enqueue errors gracefully", async () => {
    mockAcpEnqueue.mockRejectedValueOnce(new Error("Agent crashed"));

    await bridge.processMessage(makeTextMsg("hello"));

    expect(mockSendText).toHaveBeenCalledWith(
      "user1",
      expect.stringContaining("Error"),
      "ctx1"
    );
  });
});
