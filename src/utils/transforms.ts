import type { MaybePromise, OperationName } from "../core/types.js";
import type { ShieldPluginHookArgs } from "../plugins/plugin.js";

export function redact(_value: unknown = "[REDACTED]"): string {
  void _value;
  return "[REDACTED]";
}

export function toISOString(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

export function parseJSON(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function trimString(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export type LoggingEntry<TContext = unknown> = {
  ctx: TContext;
  operation: OperationName;
  resource: string;
  durationMs?: number;
  input?: unknown;
  result?: unknown;
  error?: unknown;
};

export function createLoggingHooks<TContext>(
  log: (entry: LoggingEntry<TContext>) => MaybePromise<void>,
) {
  const startTimes = new WeakMap<object, number>();

  return {
    beforeQuery() {
      return async (args: ShieldPluginHookArgs<TContext>) => {
        if (args.input && typeof args.input === "object") {
          startTimes.set(args.input, Date.now());
        }
        await log({
          ctx: args.ctx,
          operation: args.operation,
          resource: args.resourceName,
          input: args.input,
        });
        return args.input;
      };
    },
    afterQuery() {
      return async (args: ShieldPluginHookArgs<TContext>) => {
        const durationMs =
          args.input && typeof args.input === "object" && startTimes.has(args.input)
            ? Date.now() - (startTimes.get(args.input) ?? Date.now())
            : undefined;
        const entry: LoggingEntry<TContext> = {
          ctx: args.ctx,
          operation: args.operation,
          resource: args.resourceName,
          input: args.input,
          result: args.result,
        };
        if (durationMs !== undefined) {
          entry.durationMs = durationMs;
        }
        await log(entry);
        return args.result;
      };
    },
  };
}
