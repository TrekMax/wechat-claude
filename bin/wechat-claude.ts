#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WeChatClaudeBridge } from "../src/bridge.js";
import { loadConfig, type WeChatClaudeConfig } from "../src/config.js";

// -- Parse CLI args ----------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  login: args.includes("--login"),
  model: getArgValue("--model"),
  systemPrompt: getArgValue("--system-prompt"),
  maxTokens: getArgValue("--max-tokens"),
  help: args.includes("--help") || args.includes("-h"),
};

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (flags.help) {
  console.log(`
wechat-claude - WeChat-to-Claude bridge via iLink protocol

Usage:
  wechat-claude [options]

Options:
  --login            Force re-login (show QR code)
  --model <model>    Claude model to use (default: claude-sonnet-4-20250514)
  --system-prompt <prompt>  System prompt for Claude
  --max-tokens <n>   Max tokens for Claude response (default: 4096)
  -h, --help         Show this help message

Environment Variables:
  ANTHROPIC_API_KEY   (required) Your Anthropic API key
  CLAUDE_MODEL        Claude model override
  CLAUDE_MAX_TOKENS   Max tokens override
  WEIXIN_BASE_URL     WeChat iLink API base URL

Commands (in chat):
  /reset, /new, /clear   Reset conversation history
`);
  process.exit(0);
}

// -- Load config -------------------------------------------------------------

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const overrides: DeepPartial<WeChatClaudeConfig> = {};
if (flags.model || flags.maxTokens || flags.systemPrompt) {
  const claudeOverrides: DeepPartial<WeChatClaudeConfig["claude"]> = {};
  if (flags.model) claudeOverrides.model = flags.model;
  if (flags.maxTokens) claudeOverrides.maxTokens = parseInt(flags.maxTokens, 10);
  if (flags.systemPrompt) claudeOverrides.systemPrompt = flags.systemPrompt;
  overrides.claude = claudeOverrides;
}

let config: WeChatClaudeConfig;
try {
  config = loadConfig(overrides);
} catch (error) {
  console.error(
    `Configuration error: ${error instanceof Error ? error.message : error}`
  );
  process.exit(1);
}

// -- Token management --------------------------------------------------------

const storageDir = config.storage.dir;
const tokenFile = join(storageDir, "token.json");

if (!existsSync(storageDir)) {
  mkdirSync(storageDir, { recursive: true });
}

async function getToken(): Promise<string> {
  // Try loading saved token
  if (!flags.login && existsSync(tokenFile)) {
    try {
      const saved = JSON.parse(readFileSync(tokenFile, "utf-8"));
      if (saved.token) {
        console.log("[auth] Using saved token");
        return saved.token;
      }
    } catch {
      // Invalid token file, proceed to QR login
    }
  }

  // QR code login
  console.log("[auth] Starting QR code login...");

  const { QrAuthProvider, ApiClient } = await import("@xmccln/wechat-ilink-sdk");
  const apiClient = new ApiClient({
    baseUrl: config.wechat.baseUrl,
    cdnBaseUrl: config.wechat.cdnBaseUrl,
  });
  const qrAuth = new QrAuthProvider(apiClient, config.wechat.botType);

  // Listen for QR code event
  qrAuth.on("qrcode", (...args: unknown[]) => {
    const data = args[0] as { qrUrl?: string } | undefined;
    const qrUrl = data?.qrUrl;
    if (!qrUrl) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const qrTerminal = require("qrcode-terminal");
      qrTerminal.generate(qrUrl, { small: true });
    } catch {
      console.log(`\nScan this URL with WeChat:\n${qrUrl}\n`);
    }
    console.log("Waiting for QR code scan...");
  });

  const authResult = await qrAuth.authenticate();
  const token = authResult.token;

  // Save token
  writeFileSync(
    tokenFile,
    JSON.stringify({ token, savedAt: new Date().toISOString() })
  );
  console.log("[auth] Token saved");

  return token;
}

// -- Main --------------------------------------------------------------------

async function main() {
  console.log("wechat-claude v0.1.0");
  console.log(`Model: ${config.claude.model}`);
  console.log(`Max tokens: ${config.claude.maxTokens}`);
  console.log("");

  const token = await getToken();
  const bridge = new WeChatClaudeBridge(config, token);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[bridge] Shutting down...");
    bridge.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bridge.start();
  console.log(
    "[bridge] Ready! Send a message on WeChat to start chatting with Claude."
  );
}

main().catch((error) => {
  console.error(
    "Fatal error:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
