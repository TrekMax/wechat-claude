export interface AgentPreset {
  label: string;
  command: string;
  args: string[];
  description?: string;
  env?: Record<string, string>;
}

export const BUILT_IN_AGENTS: Record<string, AgentPreset> = {
  claude: {
    label: "Claude Code",
    command: "npx",
    args: ["@anthropic-ai/claude-code", "--acp"],
    description: "Claude Code via ACP",
  },
  copilot: {
    label: "GitHub Copilot",
    command: "npx",
    args: ["@github/copilot", "--acp", "--yolo"],
  },
  gemini: {
    label: "Gemini CLI",
    command: "npx",
    args: ["@google/gemini-cli", "--experimental-acp"],
  },
};

export function resolveAgent(
  agentName: string,
  registry: Record<string, AgentPreset> = BUILT_IN_AGENTS
): { command: string; args: string[]; env?: Record<string, string> } {
  const preset = registry[agentName];
  if (preset) {
    return {
      command: preset.command,
      args: [...preset.args],
      env: preset.env ? { ...preset.env } : undefined,
    };
  }

  // Parse as raw command: "npx my-agent --flag" → command="npx", args=["my-agent", "--flag"]
  const parts = agentName.split(/\s+/);
  return {
    command: parts[0],
    args: parts.slice(1),
  };
}
