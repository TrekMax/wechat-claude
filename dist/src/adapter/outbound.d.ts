/**
 * Formats Claude's response for WeChat display.
 * Strips markdown formatting that WeChat doesn't render.
 */
export declare function formatForWeChat(text: string): string;
/**
 * Splits text into chunks respecting WeChat's message size limit.
 * Prefers splitting at newlines when possible.
 */
export declare function splitText(text: string, maxLength: number): string[];
//# sourceMappingURL=outbound.d.ts.map