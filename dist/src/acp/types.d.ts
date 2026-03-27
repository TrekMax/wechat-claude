export interface AgentPreset {
    label: string;
    command: string;
    args: string[];
    description?: string;
    env?: Record<string, string>;
}
export declare const BUILT_IN_AGENTS: Record<string, AgentPreset>;
export declare function resolveAgent(agentName: string, registry?: Record<string, AgentPreset>): {
    command: string;
    args: string[];
    env?: Record<string, string>;
};
//# sourceMappingURL=types.d.ts.map