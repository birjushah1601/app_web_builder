export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

export interface Logger {
  debug: (msg: string, extras?: Record<string, unknown>) => void;
  info: (msg: string, extras?: Record<string, unknown>) => void;
  warn: (msg: string, extras?: Record<string, unknown>) => void;
  error: (msg: string, extras?: Record<string, unknown>) => void;
  fatal: (msg: string, extras?: Record<string, unknown>) => void;
}

function resolveLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const envLevel = (process.env.ATLAS_LOG_LEVEL ?? "").toLowerCase();
  if (envLevel in ORDER) return envLevel as LogLevel;
  return "info";
}

export function createLogger(opts: { level?: LogLevel } = {}): Logger {
  const threshold = ORDER[resolveLevel(opts.level)];

  const emit = (level: LogLevel, msg: string, extras?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const entry = { ts: new Date().toISOString(), level, msg, ...extras };
    process.stderr.write(JSON.stringify(entry) + "\n");
  };

  return {
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
    fatal: (m, e) => emit("fatal", m, e),
  };
}
