#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { WeChatClaudeBridge } from "../src/bridge.js";
import { loadConfig, type WeChatClaudeConfig, type BridgeMode } from "../src/config.js";
import { resolveAgent, BUILT_IN_AGENTS } from "../src/acp/types.js";

// -- Parse CLI args ----------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  login: args.includes("--login"),
  agent: getArgValue("--agent"),
  model: getArgValue("--model"),
  systemPrompt: getArgValue("--system-prompt"),
  maxTokens: getArgValue("--max-tokens"),
  cwd: getArgValue("--cwd"),
  showThoughts: args.includes("--show-thoughts"),
  help: args.includes("--help") || args.includes("-h"),
};

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

if (flags.help) {
  const agentNames = Object.entries(BUILT_IN_AGENTS)
    .map(([k, v]) => `    ${k.padEnd(12)} ${v.label}`)
    .join("\n");

  console.log(`
wechat-claude - WeChat-to-Claude bridge via iLink protocol

Usage:
  wechat-claude [options]

Modes:
  API mode (default):  Direct Claude API calls for text/image chat
  ACP mode:            Full agent capabilities (code, files, tools)

Options:
  --agent <name|cmd>   Enable ACP mode with an agent preset or command
  --cwd <path>         Working directory for ACP agent (default: current dir)
  --show-thoughts      Show agent thinking process in chat (ACP mode)
  --login              Force re-login (show QR code)
  --model <model>      Claude model to use (API mode, default: claude-sonnet-4-20250514)
  --system-prompt <p>  System prompt for Claude (API mode)
  --max-tokens <n>     Max tokens for Claude response (API mode, default: 4096)
  -h, --help           Show this help message

Built-in Agent Presets:
${agentNames}

Examples:
  # API mode — lightweight chat
  wechat-claude

  # ACP mode — full Claude Code agent
  wechat-claude --agent claude

  # ACP mode — custom agent command
  wechat-claude --agent "npx my-custom-agent --acp"

  # ACP mode with thinking visible
  wechat-claude --agent claude --show-thoughts --cwd ~/projects/myapp

Environment Variables:
  ANTHROPIC_API_KEY   (required for API mode) Your Anthropic API key
  CLAUDE_MODEL        Claude model override (API mode)
  CLAUDE_MAX_TOKENS   Max tokens override (API mode)
  WEIXIN_BASE_URL     WeChat iLink API base URL

Commands (in chat):
  /reset, /new, /clear   Reset conversation history (API mode only)
`);
  process.exit(0);
}

// -- Determine mode and build config -----------------------------------------

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const mode: BridgeMode = flags.agent ? "acp" : "api";
const overrides: DeepPartial<WeChatClaudeConfig> = { mode };

if (mode === "api") {
  const claudeOverrides: DeepPartial<WeChatClaudeConfig["claude"]> = {};
  if (flags.model) claudeOverrides.model = flags.model;
  if (flags.maxTokens) claudeOverrides.maxTokens = parseInt(flags.maxTokens, 10);
  if (flags.systemPrompt) claudeOverrides.systemPrompt = flags.systemPrompt;
  if (Object.keys(claudeOverrides).length > 0) overrides.claude = claudeOverrides;
} else {
  // ACP mode — resolve agent preset
  const resolved = resolveAgent(flags.agent!);
  overrides.agent = {
    command: resolved.command,
    args: resolved.args as unknown as string,
    cwd: flags.cwd ?? process.cwd(),
    showThoughts: flags.showThoughts,
  } as unknown as DeepPartial<WeChatClaudeConfig["agent"]>;
}

let config: WeChatClaudeConfig;
try {
  config = loadConfig(overrides);

  // For ACP mode, directly set args array (DeepPartial loses array typing)
  if (mode === "acp" && flags.agent) {
    const resolved = resolveAgent(flags.agent);
    config.agent.command = resolved.command;
    config.agent.args = resolved.args;
    config.agent.cwd = flags.cwd ?? process.cwd();
    config.agent.showThoughts = flags.showThoughts;
    if (resolved.env) config.agent.env = resolved.env;
  }
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
  if (!flags.login && existsSync(tokenFile)) {
    try {
      const saved = JSON.parse(readFileSync(tokenFile, "utf-8"));
      if (saved.token) {
        console.log("[auth] Using saved token");
        return saved.token;
      }
    } catch {
      // proceed to QR login
    }
  }

  console.log("[auth] Starting QR code login...");

  const { QrAuthProvider, ApiClient } = await import("@xmccln/wechat-ilink-sdk");
  const apiClient = new ApiClient({
    baseUrl: config.wechat.baseUrl,
    cdnBaseUrl: config.wechat.cdnBaseUrl,
  });
  const qrAuth = new QrAuthProvider(apiClient, config.wechat.botType);

  // Import qrcode-terminal ahead of time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let renderQr: any = null;
  try {
    const mod = await import("qrcode-terminal");
    renderQr = (mod as any).default?.generate ?? (mod as any).generate;
  } catch {
    // fallback to printing URL
  }

  qrAuth.on("qr_generated", (...args: unknown[]) => {
    const data = args[0] as { url?: string; sessionKey?: string } | undefined;
    const qrUrl = data?.url;
    if (!qrUrl) return;
    if (renderQr) {
      renderQr(qrUrl, { small: true });
    } else {
      console.log(`\nScan this URL with WeChat:\n${qrUrl}\n`);
    }
    console.log("Waiting for QR code scan...");
  });

  const authResult = await qrAuth.authenticate();
  const token = authResult.token;

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

  if (mode === "api") {
    console.log(`Mode: API (direct Claude calls)`);
    console.log(`Model: ${config.claude.model}`);
    console.log(`Max tokens: ${config.claude.maxTokens}`);
  } else {
    console.log(`Mode: ACP (agent subprocess)`);
    console.log(`Agent: ${config.agent.command} ${config.agent.args.join(" ")}`);
    console.log(`CWD: ${config.agent.cwd}`);
    if (config.agent.showThoughts) console.log(`Thoughts: visible`);
  }
  console.log("");

  const token = await getToken();
  const bridge = new WeChatClaudeBridge(config, token);

  const shutdown = () => {
    console.log("\n[bridge] Shutting down...");
    bridge.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await bridge.start();
  console.log(
    "[bridge] Ready! Send a message on WeChat to start chatting."
  );
}

main().catch((error) => {
  console.error(
    "Fatal error:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
