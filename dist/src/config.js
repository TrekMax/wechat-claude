import { homedir } from "node:os";
import { join } from "node:path";
const DEFAULTS = {
    wechat: {
        baseUrl: "https://ilinkai.weixin.qq.com",
        cdnBaseUrl: "https://novac2c.cdn.weixin.qq.com/c2c",
        botType: "3",
    },
    claude: {
        model: "claude-sonnet-4-20250514",
        maxTokens: 4096,
        systemPrompt: "You are a helpful assistant communicating through WeChat. Keep responses concise and clear. Respond in the same language the user uses.",
    },
    agent: {
        command: "",
        args: [],
        cwd: process.cwd(),
        showThoughts: false,
    },
    session: {
        idleTimeoutMs: 24 * 60 * 60 * 1000,
        maxConcurrentUsers: 10,
        maxConversationTurns: 50,
        resetKeywords: ["/reset", "/new", "/clear"],
    },
    storage: {
        dir: join(homedir(), ".wechat-claude"),
    },
};
export function loadConfig(overrides) {
    const env = process.env;
    // Determine mode: if agent override is provided, use acp mode
    const mode = overrides?.mode ?? "api";
    // API key is only required in api mode
    const apiKey = env.ANTHROPIC_API_KEY ?? "";
    if (mode === "api" && !apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required in API mode. Set it in your shell or .env file.");
    }
    const config = {
        mode,
        debug: false,
        wechat: {
            baseUrl: env.WEIXIN_BASE_URL || DEFAULTS.wechat.baseUrl,
            cdnBaseUrl: env.WEIXIN_CDN_BASE_URL || DEFAULTS.wechat.cdnBaseUrl,
            botType: env.WEIXIN_BOT_TYPE || DEFAULTS.wechat.botType,
        },
        claude: {
            apiKey,
            model: env.CLAUDE_MODEL || DEFAULTS.claude.model,
            maxTokens: env.CLAUDE_MAX_TOKENS
                ? parseInt(env.CLAUDE_MAX_TOKENS, 10)
                : DEFAULTS.claude.maxTokens,
            systemPrompt: env.CLAUDE_SYSTEM_PROMPT || DEFAULTS.claude.systemPrompt,
            temperature: env.CLAUDE_TEMPERATURE
                ? parseFloat(env.CLAUDE_TEMPERATURE)
                : undefined,
        },
        agent: {
            command: DEFAULTS.agent.command,
            args: [...DEFAULTS.agent.args],
            cwd: DEFAULTS.agent.cwd,
            showThoughts: false,
        },
        session: {
            idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_HOURS
                ? parseInt(env.SESSION_IDLE_TIMEOUT_HOURS, 10) * 60 * 60 * 1000
                : DEFAULTS.session.idleTimeoutMs,
            maxConcurrentUsers: env.MAX_CONCURRENT_USERS
                ? parseInt(env.MAX_CONCURRENT_USERS, 10)
                : DEFAULTS.session.maxConcurrentUsers,
            maxConversationTurns: DEFAULTS.session.maxConversationTurns,
            resetKeywords: DEFAULTS.session.resetKeywords,
        },
        storage: {
            dir: env.WECHAT_CLAUDE_STORAGE_DIR || DEFAULTS.storage.dir,
        },
    };
    // Apply overrides
    if (overrides) {
        if (overrides.mode)
            config.mode = overrides.mode;
        if (overrides.debug !== undefined)
            config.debug = overrides.debug;
        if (overrides.claude)
            Object.assign(config.claude, overrides.claude);
        if (overrides.wechat)
            Object.assign(config.wechat, overrides.wechat);
        if (overrides.agent)
            Object.assign(config.agent, overrides.agent);
        if (overrides.session)
            Object.assign(config.session, overrides.session);
        if (overrides.storage)
            Object.assign(config.storage, overrides.storage);
    }
    return config;
}
//# sourceMappingURL=config.js.map