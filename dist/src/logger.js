/**
 * Simple timestamped logger.
 */
function timestamp() {
    return new Date().toISOString();
}
export function log(tag, msg) {
    console.log(`${timestamp()} [${tag}] ${msg}`);
}
export function logError(tag, msg) {
    console.error(`${timestamp()} [${tag}] ${msg}`);
}
export function logDebug(tag, msg) {
    console.log(`${timestamp()} [${tag}] ${msg}`);
}
//# sourceMappingURL=logger.js.map