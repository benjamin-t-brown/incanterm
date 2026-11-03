import { writeSync } from 'node:fs';

// End synchronized output before restoring the cursor and leaving the alternate screen.
export const TERMINAL_RESTORE = '\x1b[?2026l\x1b[?1000l\x1b[?1006l\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l';

export function formatTerminalError(message: string): string {
  return `\x1b[91m${message}\x1b[0m`;
}

export function installTerminalCleanup(): () => void {
  let restored = false;
  function restoreTerminal(): void {
    if (restored) return;
    restored = true;
    if (process.stdin.isTTY && process.stdin.isRaw) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Still restore terminal modes even if stdin has already closed.
      }
    }
    if (process.stdout.isTTY) {
      // An exit handler cannot rely on buffered stream writes being flushed.
      try {
        writeSync(process.stdout.fd, TERMINAL_RESTORE);
      } catch {
        process.stdout.write(TERMINAL_RESTORE);
      }
    }
  }
  function handleFatalError(error: unknown): void {
    restoreTerminal();
    console.error(error);
    process.exit(1);
  }
  process.once('exit', restoreTerminal);
  process.once('uncaughtException', handleFatalError);
  process.once('unhandledRejection', handleFatalError);
  return restoreTerminal;
}
