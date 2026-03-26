/**
 * Simple timestamped logger.
 */

function timestamp(): string {
  return new Date().toISOString();
}

export function log(tag: string, msg: string): void {
  console.log(`${timestamp()} [${tag}] ${msg}`);
}

export function logError(tag: string, msg: string): void {
  console.error(`${timestamp()} [${tag}] ${msg}`);
}

export function logDebug(tag: string, msg: string): void {
  console.log(`${timestamp()} [${tag}] ${msg}`);
}
