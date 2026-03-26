/**
 * Formats Claude's response for WeChat display.
 * Strips markdown formatting that WeChat doesn't render.
 */
export function formatForWeChat(text: string): string {
  if (!text) return "";

  let result = text;

  // Strip code blocks (keep content)
  result = result.replace(/```[\s\S]*?\n([\s\S]*?)```/g, "$1");

  // Strip inline code backticks
  result = result.replace(/`([^`]+)`/g, "$1");

  // Convert headers to plain text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // Convert links: [text](url) -> text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Strip bold
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");

  // Strip italic
  result = result.replace(/\*(.+?)\*/g, "$1");

  // Strip strikethrough
  result = result.replace(/~~(.+?)~~/g, "$1");

  return result;
}

/**
 * Splits text into chunks respecting WeChat's message size limit.
 * Prefers splitting at newlines when possible.
 */
export function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a newline to break at
    const searchRange = remaining.slice(0, maxLength);
    const lastNewline = searchRange.lastIndexOf("\n");

    if (lastNewline > 0) {
      chunks.push(remaining.slice(0, lastNewline));
      remaining = remaining.slice(lastNewline + 1);
    } else {
      // Force split at maxLength
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
    }
  }

  return chunks;
}
