// 앱 전역 console.log/warn/error 호출을 가로채 링버퍼에 저장 — 프로덕션에서 원격
// 디버깅 도구 없이(특히 iOS Safari) 화면에서 바로 로그를 확인할 수 있게 함.
// 기존 console.* 호출은 그대로 콘솔에도 찍힌다 — 여기 붙이지 않고 대체하는 게 아니라 보강만 함.
export interface LogEntry {
  time: number;
  level: 'log' | 'warn' | 'error';
  message: string;
}

const MAX_LOG_ENTRIES = 500;
const buffer: LogEntry[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack ?? arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function push(level: LogEntry['level'], args: unknown[]): void {
  buffer.push({
    time: Date.now(),
    level,
    message: args.map(stringifyArg).join(' '),
  });
  if (buffer.length > MAX_LOG_ENTRIES) buffer.shift();
  listeners.forEach((listener) => listener());
}

let installed = false;

export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;
  (['log', 'warn', 'error'] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  });
}

export function getLogEntries(): LogEntry[] {
  return buffer;
}

export function subscribeLogEntries(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearLogEntries(): void {
  buffer.length = 0;
  listeners.forEach((listener) => listener());
}

export function formatLogEntries(entries: LogEntry[]): string {
  return entries
    .map((e) => `[${new Date(e.time).toLocaleTimeString()}] ${e.level.toUpperCase()} ${e.message}`)
    .join('\n');
}
