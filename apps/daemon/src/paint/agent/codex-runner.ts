import { spawn, type ChildProcess } from 'node:child_process';
import type { LogLevel } from '@paintcodex/protocol';
import type {
  ObservabilityLogger,
  TraceContext,
} from '../../observability/logger.js';

/**
 * Narrow seam over the Codex CLI. The daemon depends on this interface so tests
 * can stream canned output without spawning a real process.
 */
export interface CodexRunner {
  run(
    prompt: string,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
    trace?: TraceContext,
  ): Promise<string>;
}

export interface CodexRunnerOptions {
  /** Executable name or path. Defaults to `PAINTCODEX_CODEX_BIN` or `codex`/`codex.cmd`. */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Sink for `codex-runner` lifecycle events. Logging is skipped when omitted. */
  logger?: ObservabilityLogger;
}

const DEFAULT_ARGS = [
  'exec',
  '--json',
  '--skip-git-repo-check',
  '-s',
  'read-only',
  '--ephemeral',
  '-',
];

const DEFAULT_TIMEOUT_MS = 120_000;

function defaultCommand(): string {
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function createAbortError(): Error {
  const error = new Error('Codex request aborted');
  error.name = 'AbortError';
  return error;
}

function quoteForCmd(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Kills the Codex process. On Windows the npm shim runs through cmd.exe, so the
 * whole tree has to be terminated to stop the actual CLI.
 */
function terminate(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      child.kill();
    });
    killer.unref();
    return;
  }

  child.kill('SIGTERM');
}

export function createCodexRunner(options: CodexRunnerOptions = {}): CodexRunner {
  const command =
    options.command ?? process.env.PAINTCODEX_CODEX_BIN ?? defaultCommand();
  const args = options.args ?? DEFAULT_ARGS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  // A .cmd shim needs cmd.exe. Build the command line explicitly instead of
  // passing args with `shell: true`, which Node deprecates as unsafe.
  const shellCommand = useShell
    ? [command, ...args].map(quoteForCmd).join(' ')
    : null;

  return {
    run(prompt, onDelta, signal, trace) {
      return new Promise<string>((resolve, reject) => {
        const logger = options.logger;
        const startedAt = logger ? logger.now() : 0;

        const logEvent = (
          level: LogLevel,
          message: string,
          details: {
            payload?: unknown;
            error?: unknown;
            durationMs?: number;
          } = {},
        ) => {
          if (!logger) {
            return;
          }

          logger.log({
            category: 'codex-runner',
            level,
            message,
            payload: details.payload,
            error: details.error,
            durationMs: details.durationMs ?? null,
            traceId: trace?.traceId ?? null,
            parentId: trace?.spanId ?? null,
          });
        };

        const elapsedMs = () => (logger ? logger.now() - startedAt : 0);

        if (signal?.aborted) {
          logEvent('warn', 'codex_abort');
          reject(createAbortError());
          return;
        }

        let child: ChildProcess;
        try {
          const spawnOptions = {
            cwd: options.cwd ?? process.cwd(),
            env: options.env ?? process.env,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
          };
          child =
            shellCommand === null
              ? spawn(command, args, spawnOptions)
              : spawn(
                  process.env.ComSpec ?? 'cmd.exe',
                  ['/d', '/s', '/c', shellCommand],
                  spawnOptions,
                );
        } catch (error) {
          const failure =
            error instanceof Error ? error : new Error(String(error));
          logEvent('error', 'codex_error', {
            error: failure,
            durationMs: elapsedMs(),
          });
          reject(failure);
          return;
        }

        logEvent('info', 'codex_spawn', {
          payload: {
            command,
            argCount: args.length,
            promptLength: prompt.length,
          },
        });

        let settled = false;
        let output = '';
        let stdoutBuffer = '';
        let stderr = '';

        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        };

        const finish = (complete: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          complete();
        };

        const onAbort = () => {
          terminate(child);
          finish(() => {
            logEvent('warn', 'codex_abort');
            reject(createAbortError());
          });
        };

        const timer = setTimeout(() => {
          terminate(child);
          const failure = new Error(
            `Codex CLI timed out after ${timeoutMs}ms`,
          );
          finish(() => {
            logEvent('error', 'codex_timeout', {
              payload: { timeoutMs },
              error: failure,
              durationMs: elapsedMs(),
            });
            reject(failure);
          });
        }, timeoutMs);

        signal?.addEventListener('abort', onAbort, { once: true });

        const emit = (text: string) => {
          if (settled || text.length === 0) {
            return;
          }
          output += text;
          logEvent('debug', 'codex_delta', { payload: { delta: text } });
          try {
            onDelta(text);
          } catch (error) {
            terminate(child);
            const failure =
              error instanceof Error ? error : new Error(String(error));
            finish(() => {
              logEvent('error', 'codex_error', {
                error: failure,
                durationMs: elapsedMs(),
              });
              reject(failure);
            });
          }
        };

        const handleLine = (line: string) => {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (typeof event !== 'object' || event === null) {
            return;
          }
          const record = event as {
            type?: unknown;
            item?: { type?: unknown; text?: unknown };
          };
          if (
            record.type === 'item.completed' &&
            record.item?.type === 'agent_message' &&
            typeof record.item.text === 'string'
          ) {
            emit(record.item.text);
          }
        };

        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
          stdoutBuffer += chunk;
          let newline = stdoutBuffer.indexOf('\n');
          while (newline >= 0) {
            const line = stdoutBuffer.slice(0, newline).trim();
            stdoutBuffer = stdoutBuffer.slice(newline + 1);
            if (line.length > 0) {
              handleLine(line);
            }
            newline = stdoutBuffer.indexOf('\n');
          }
        });

        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-8192);
        });

        child.on('error', (error) => {
          finish(() => {
            logEvent('error', 'codex_error', {
              error,
              durationMs: elapsedMs(),
            });
            reject(error);
          });
        });

        child.on('close', (code) => {
          if (stdoutBuffer.trim().length > 0) {
            handleLine(stdoutBuffer.trim());
            stdoutBuffer = '';
          }
          finish(() => {
            if (code === 0) {
              logEvent('info', 'codex_complete', {
                payload: { exitCode: 0, outputLength: output.length },
                durationMs: elapsedMs(),
              });
              resolve(output);
              return;
            }
            const detail = stderr.trim();
            const failure = new Error(
              `Codex CLI exited with code ${code === null ? 'null' : String(code)}${
                detail.length > 0 ? `: ${detail}` : ''
              }`,
            );
            logEvent('error', 'codex_error', {
              payload: { exitCode: code },
              error: failure,
              durationMs: elapsedMs(),
            });
            reject(failure);
          });
        });

        child.stdin?.on('error', () => {
          // The process may exit before consuming stdin; the close handler
          // reports the real outcome.
        });
        child.stdin?.end(prompt);
      });
    },
  };
}
