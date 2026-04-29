/**
 * Logger con timestamps ISO 8601 para el servidor.
 * Formato: [2024-01-01T12:00:00] Level: message
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function getTimestamp(): string {
  return new Date().toISOString().replace('Z', '');
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const extra = args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : '';
  return `[${getTimestamp()}] ${level}: ${message}${extra}`;
}

export const logger = {
  info: (message: string, ...args: unknown[]) =>
    console.log(formatMessage('INFO', message, ...args)),
  warn: (message: string, ...args: unknown[]) =>
    console.warn(formatMessage('WARN', message, ...args)),
  error: (message: string, ...args: unknown[]) =>
    console.error(formatMessage('ERROR', message, ...args)),
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatMessage('DEBUG', message, ...args));
    }
  },
};
