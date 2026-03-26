#!/usr/bin/env node

import { WeChatClaudeBridge } from "../src/bridge.js";
import { loadConfig, type WeChatClaudeConfig, type BridgeMode } from "../src/config.js";
import { resolveAgent, BUILT_IN_AGENTS } from "../src/acp/types.js";
import { login, loadToken } from "../src/auth.js";

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
  debug: args.includes("--debug"),
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
  --debug              Print all incoming WeChat messages to terminal
  --login              Force re-login (show QR code)
  --model <model>      Claude model (API mode: full name; ACP mode: sonnet/opus/haiku)
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

  # ACP mode with faster model
  wechat-claude --agent claude --model haiku --cwd ~/projects/myapp

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
const overrides: DeepPartial<WeChatClaudeConfig> = { mode, debug: flags.debug };

if (mode === "api") {
  const claudeOverrides: DeepPartial<WeChatClaudeConfig["claude"]> = {};
  if (flags.model) claudeOverrides.model = flags.model;
  if (flags.maxTokens) claudeOverrides.maxTokens = parseInt(flags.maxTokens, 10);
  if (flags.systemPrompt) claudeOverrides.systemPrompt = flags.systemPrompt;
  if (Object.keys(claudeOverrides).length > 0) overrides.claude = claudeOverrides;
}

let config: WeChatClaudeConfig;
try {
  config = loadConfig(overrides);

  if (mode === "acp" && flags.agent) {
    const resolved = resolveAgent(flags.agent);
    config.agent.command = resolved.command;
    config.agent.args = resolved.args;
    config.agent.cwd = flags.cwd ?? process.cwd();
    config.agent.showThoughts = flags.showThoughts;
    config.agent.env = { ...resolved.env };

    // Write --model to .claude/settings.json if specified
    if (flags.model) {
      const { mkdirSync: mkDir, existsSync: exists, readFileSync: readF, writeFileSync: writeF } = await import("node:fs");
      const { join: joinPath } = await import("node:path");
      const claudeDir = joinPath(config.agent.cwd, ".claude");
      const settingsPath = joinPath(claudeDir, "settings.json");
      let settings: Record<string, unknown> = {};
      try {
        if (exists(settingsPath)) {
          settings = JSON.parse(readF(settingsPath, "utf-8"));
        }
      } catch { /* start fresh */ }
      settings.model = flags.model;
      mkDir(claudeDir, { recursive: true });
      writeF(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    }
  }
} catch (error) {
  console.error(
    `Configuration error: ${error instanceof Error ? error.message : error}`
  );
  process.exit(1);
}

// -- QR rendering helper -----------------------------------------------------

let renderQr: ((url: string) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("qrcode-terminal") as any;
  const qr = mod.default ?? mod;
  if (typeof qr.setErrorLevel === "function") {
    qr.setErrorLevel("L");
  }
  if (typeof qr.generate === "function") {
    renderQr = (url: string) => {
      qr.generate(url, { small: true }, (output: string) => {
        console.log(output);
      });
    };
  }
} catch {
  // fallback: will print URL as text
}

// -- Token management --------------------------------------------------------

const storageDir = config.storage.dir;

async function getToken(): Promise<string> {
  // Try loading saved token
  if (!flags.login) {
    const saved = loadToken(storageDir);
    if (saved) {
      console.log("[auth] Using saved token");
      return saved.token;
    }
  }

  // QR login
  const tokenData = await login({
    baseUrl: config.wechat.baseUrl,
    botType: config.wechat.botType,
    storageDir,
    renderQr: renderQr ?? undefined,
  });

  return tokenData.token;
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
  if (config.debug) console.log(`Debug: ON`);
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
