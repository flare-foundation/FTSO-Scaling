export interface ILogger {
  info: (message: string) => void;
  debug: (message: string) => void;
  warn: (message: string) => void;
}
