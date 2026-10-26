import { ConsoleLogger, LogLevel } from '@nestjs/common';

export class JsonLogger extends ConsoleLogger {
  protected formatPid(): string {
    return '';
  }

  protected colorize(message: string): string {
    return message;
  }

  protected formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    void pidMessage;
    void formattedLogLevel;
    void timestampDiff;
    return `${JSON.stringify({
      level: logLevel,
      context: contextMessage?.replace(/[\[\]\s]/g, '') || undefined,
      message: typeof message === 'string' ? message : String(message),
      timestamp: new Date().toISOString(),
    })}\n`;
  }
}
