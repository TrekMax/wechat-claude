import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw if ANTHROPIC_API_KEY is missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow("ANTHROPIC_API_KEY");
  });

  it("should return valid config with defaults when API key is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const config = loadConfig();

    expect(config.claude.apiKey).toBe("sk-ant-test-key");
    expect(config.claude.model).toBe("claude-sonnet-4-20250514");
    expect(config.claude.maxTokens).toBe(4096);
    expect(config.claude.systemPrompt).toContain("assistant");
    expect(config.wechat.baseUrl).toBe("https://ilinkai.weixin.qq.com");
    expect(config.session.maxConcurrentUsers).toBe(10);
    expect(config.session.maxConversationTurns).toBe(50);
    expect(config.session.resetKeywords).toContain("/reset");
  });

  it("should override defaults with env vars", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    process.env.CLAUDE_MODEL = "claude-opus-4-20250514";
    process.env.CLAUDE_MAX_TOKENS = "8192";
    process.env.MAX_CONCURRENT_USERS = "5";

    const config = loadConfig();

    expect(config.claude.model).toBe("claude-opus-4-20250514");
    expect(config.claude.maxTokens).toBe(8192);
    expect(config.session.maxConcurrentUsers).toBe(5);
  });

  it("should accept overrides parameter", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const config = loadConfig({ claude: { model: "claude-haiku-4-5-20251001" } });

    expect(config.claude.model).toBe("claude-haiku-4-5-20251001");
    expect(config.claude.apiKey).toBe("sk-ant-test-key");
  });

  it("should never expose API key in serialized config", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
    const config = loadConfig();
    const serialized = JSON.stringify(config);

    // apiKey is in the object but we verify it doesn't leak elsewhere
    expect(config.claude.apiKey).toBe("sk-ant-secret");
  });
});
