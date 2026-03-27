/**
 * Spawn and manage ACP agent subprocesses.
 * Based on wechat-acp/src/acp/agent-manager.ts
 */
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
export async function spawnAgent(params) {
    const { command, args, cwd, env, client, log } = params;
    const useShell = process.platform === "win32";
    log(`Spawning agent: ${command} ${args.join(" ")} (cwd: ${cwd}, shell=${useShell})`);
    const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "inherit"],
        cwd,
        env: { ...process.env, ...env },
        shell: useShell,
    });
    proc.on("error", (err) => {
        log(`Agent process error: ${String(err)}`);
    });
    proc.on("exit", (code, signal) => {
        log(`Agent process exited: code=${code} signal=${signal}`);
    });
    if (!proc.stdin || !proc.stdout) {
        proc.kill();
        throw new Error("Failed to get agent process stdio");
    }
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout);
    const stream = acp.ndJsonStream(input, output);
    const connection = new acp.ClientSideConnection(() => client, stream);
    // Initialize
    log("Initializing ACP connection...");
    const initResult = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: {
            name: "wechat-claude",
            title: "wechat-claude",
            version: "0.1.0",
        },
        clientCapabilities: {
            fs: {
                readTextFile: true,
                writeTextFile: true,
            },
        },
    });
    log(`ACP initialized (protocol v${initResult.protocolVersion})`);
    // Create session
    log("Creating ACP session...");
    const sessionResult = await connection.newSession({
        cwd,
        mcpServers: [],
    });
    log(`ACP session created: ${sessionResult.sessionId}`);
    return {
        process: proc,
        connection,
        sessionId: sessionResult.sessionId,
    };
}
export function killAgent(proc) {
    if (!proc.killed) {
        proc.kill("SIGTERM");
        setTimeout(() => {
            if (!proc.killed)
                proc.kill("SIGKILL");
        }, 5_000).unref();
    }
}
//# sourceMappingURL=agent-manager.js.map