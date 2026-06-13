import { eq, type InferSelectModel, type SQL, type Table as AnyTable } from "drizzle-orm";

import { allow, type PolicyDecision, type PolicyRule, type PolicyRuleArgs } from "../policy/policy.js";
import type { MaybePromise } from "../core/types.js";
import type { ShieldPluginHookArgs } from "../plugins/plugin.js";

export type Guard<TContext = unknown, TTable extends AnyTable = AnyTable, TInput = unknown> = PolicyRule<
  TContext,
  TTable,
  TInput
>;

type DecisionState = {
  allowed: boolean;
  unauthorized: boolean | undefined;
  reason: string | undefined;
  scopes: SQL[];
};

function readDecision(decision: PolicyDecision): DecisionState {
  if (decision === true || decision === "allow") {
    return { allowed: true, unauthorized: undefined, reason: undefined, scopes: [] };
  }
  if (decision === false || decision === "deny") {
    return { allowed: false, unauthorized: undefined, reason: undefined, scopes: [] };
  }
  return {
    allowed: decision.allow,
    unauthorized: decision.unauthorized,
    reason: decision.reason,
    scopes: decision.scope ? (Array.isArray(decision.scope) ? [...decision.scope] : [decision.scope]) : [],
  };
}

function writeDecision(state: DecisionState): PolicyDecision {
  if (!state.allowed) {
    const decision: { allow: boolean; reason?: string; unauthorized?: boolean; scope?: SQL | readonly SQL[] } = {
      allow: false,
    };
    if (state.unauthorized !== undefined) {
      decision.unauthorized = state.unauthorized;
    }
    if (state.reason !== undefined) {
      decision.reason = state.reason;
    }
    return decision;
  }
  return state.scopes.length > 0 ? { allow: true, scope: state.scopes } : true;
}

function defineGuard<TContext, TTable extends AnyTable, TInput = unknown>(
  guard: Guard<TContext, TTable, TInput>,
  description: string,
): Guard<TContext, TTable, TInput> {
  guard.description = description;
  return guard;
}

export function contextGuard<TContext, TTable extends AnyTable = AnyTable, TInput = unknown>(
  predicate: (ctx: TContext, args: PolicyRuleArgs<TContext, TTable, TInput>) => MaybePromise<boolean>,
): Guard<TContext, TTable, TInput> {
  return defineGuard(async (args) => predicate(args.ctx, args), "contextGuard");
}

export function hasRole<TContext, TTable extends AnyTable = AnyTable>(
  selector: (ctx: TContext) => unknown,
  roles: string | readonly string[],
): Guard<TContext, TTable> {
  return allow.role<TContext, TTable>(roles, selector);
}

export function hasPermission<TContext, TTable extends AnyTable = AnyTable>(
  selector: (ctx: TContext) => unknown,
  permissions: string | readonly string[],
): Guard<TContext, TTable> {
  return allow.permission<TContext, TTable>(permissions, selector);
}

export function and<TContext, TTable extends AnyTable = AnyTable, TInput = unknown>(
  ...guards: readonly Guard<TContext, TTable, TInput>[]
): Guard<TContext, TTable, TInput> {
  return defineGuard(async (args) => {
    const scopes: SQL[] = [];
    for (const guard of guards) {
      const state = readDecision(await guard(args));
      if (!state.allowed) {
        return writeDecision(state);
      }
      scopes.push(...state.scopes);
    }
    return scopes.length > 0 ? { allow: true, scope: scopes } : true;
  }, "and");
}

export function or<TContext, TTable extends AnyTable = AnyTable, TInput = unknown>(
  ...guards: readonly Guard<TContext, TTable, TInput>[]
): Guard<TContext, TTable, TInput> {
  return defineGuard(async (args) => {
    let firstFailure: DecisionState | undefined;
    for (const guard of guards) {
      const state = readDecision(await guard(args));
      if (state.allowed) {
        return writeDecision(state);
      }
      firstFailure ??= state;
    }
    return writeDecision(firstFailure ?? { allowed: false, unauthorized: undefined, reason: undefined, scopes: [] });
  }, "or");
}

export function not<TContext, TTable extends AnyTable = AnyTable, TInput = unknown>(
  guard: Guard<TContext, TTable, TInput>,
): Guard<TContext, TTable, TInput> {
  return defineGuard(async (args) => {
    const state = readDecision(await guard(args));
    return state.allowed ? { allow: false, reason: "Guard was negated." } : true;
  }, "not");
}

export function readOnly<TContext, TTable extends AnyTable = AnyTable>(): Guard<TContext, TTable> {
  return defineGuard(({ operation }) => operation === "list" || operation === "get", "readOnly");
}

export function scopeToTenant<TContext, TTable extends AnyTable>(
  column: keyof InferSelectModel<TTable> & string,
  selector: (ctx: TContext) => unknown,
): Guard<TContext, TTable> {
  return allow.scope<TContext, TTable>(({ ctx, table }) => {
    const tableColumn = (table as unknown as Record<string, unknown>)[column];
    return eq(tableColumn as never, selector(ctx));
  });
}

export function injectField<TContext>(
  field: string,
  selector: (ctx: TContext, args: ShieldPluginHookArgs<TContext>) => unknown,
) {
  return (args: ShieldPluginHookArgs<TContext>) => {
    if (!args.input || typeof args.input !== "object" || Array.isArray(args.input)) {
      return args.input;
    }
    const next = { ...(args.input as Record<string, unknown>) };
    const value = selector(args.ctx, args);

    if (Array.isArray(next["data"])) {
      next["data"] = next["data"].map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? { ...(item as Record<string, unknown>), [field]: value } : item,
      );
      return next;
    }

    if (next["data"] && typeof next["data"] === "object" && !Array.isArray(next["data"])) {
      next["data"] = {
        ...(next["data"] as Record<string, unknown>),
        [field]: value,
      };
      return next;
    }

    return {
      ...next,
      [field]: value,
    };
  };
}
