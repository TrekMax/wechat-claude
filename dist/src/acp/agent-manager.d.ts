/**
 * Spawn and manage ACP agent subprocesses.
 * Based on wechat-acp/src/acp/agent-manager.ts
 */
import { type ChildProcess } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";
import type { AcpClient } from "./client.js";
export interface AgentProcessInfo {
    process: ChildProcess;
    connection: acp.ClientSideConnection;
    sessionId: string;
}
export declare function spawnAgent(params: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    client: AcpClient;
    log: (msg: string) => void;
}): Promise<AgentProcessInfo>;
export declare function killAgent(proc: ChildProcess): void;
//# sourceMappingURL=agent-manager.d.ts.map