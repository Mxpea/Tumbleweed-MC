export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerMsg = '';

export function startSpinner(msg: string): void {
  stopSpinner();
  spinnerMsg = msg;
  let i = 0;
  process.stdout.write('\x1b[?25l');
  spinnerTimer = setInterval(() => {
    process.stdout.write(`\r${spinnerFrames[i] ?? ''} ${spinnerMsg}`);
    i = (i + 1) % spinnerFrames.length;
  }, 80);
}

export function updateSpinner(msg: string): void {
  spinnerMsg = msg;
}

export function stopSpinner(final?: string, level: LogLevel = 'info'): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stdout.write('\r\x1b[?25h\x1b[K');
  }
  if (final) log(final, level);
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  success: '\x1b[32m',
};
const RESET = '\x1b[0m';

const ICONS: Record<LogLevel, string> = {
  debug: '·',
  info: 'i',
  warn: '!',
  error: '✗',
  success: '✓',
};

export function log(msg: string, level: LogLevel = 'info'): void {
  const c = COLORS[level];
  const icon = ICONS[level];
  process.stdout.write(`${c}${icon} ${msg}${RESET}\n`);
}
