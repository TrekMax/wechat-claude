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

  it("should throw if ANTHROPIC_API_KEY is missing in api mode", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => loadConfig()).toThrow("ANTHROPIC_API_KEY");
  });

  it("should not throw for missing API key in acp mode", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() =>
      loadConfig({ mode: "acp", agent: { command: "npx", args: ["agent"] } })
    ).not.toThrow();
  });

  it("should default to api mode", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
    const config = loadConfig();
    expect(config.mode).toBe("api");
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

  it("should accept agent config in acp mode", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const config = loadConfig({
      mode: "acp",
      agent: {
        command: "npx",
        args: ["@anthropic-ai/claude-code", "--acp"],
        cwd: "/tmp",
        showThoughts: true,
      },
    });

    expect(config.mode).toBe("acp");
    expect(config.agent.command).toBe("npx");
    expect(config.agent.args).toEqual(["@anthropic-ai/claude-code", "--acp"]);
    expect(config.agent.cwd).toBe("/tmp");
    expect(config.agent.showThoughts).toBe(true);
  });
});
