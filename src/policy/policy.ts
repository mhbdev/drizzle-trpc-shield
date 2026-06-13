import type { InferSelectModel, SQL, Table as AnyTable } from "drizzle-orm";

import { AuthorizationError, ForbiddenError } from "../core/errors.js";
import type { MaybePromise, OperationName } from "../core/types.js";

export type AuthorizationTiming = "before" | "after" | "both";

export type PolicyDecision =
  | boolean
  | "allow"
  | "deny"
  | {
      allow: boolean;
      reason?: string;
      unauthorized?: boolean;
      scope?: SQL | readonly SQL[];
    };

export type PolicyRuleArgs<TContext, TTable extends AnyTable, TInput = unknown> = {
  ctx: TContext;
  input: TInput;
  operation: OperationName;
  resourceName: string;
  table: TTable;
  row?: InferSelectModel<TTable>;
};

export type PolicyRule<TContext, TTable extends AnyTable, TInput = unknown> = ((
  args: PolicyRuleArgs<TContext, TTable, TInput>,
) => MaybePromise<PolicyDecision>) & {
  timing?: AuthorizationTiming;
  description?: string;
};

export type PolicyRuleSet<TContext, TTable extends AnyTable> =
  | PolicyRule<TContext, TTable, any>
  | readonly PolicyRule<TContext, TTable, any>[];

export type ResourcePolicyContainer<TContext, TTable extends AnyTable> = Partial<
  Record<OperationName | "all", PolicyRuleSet<TContext, TTable>>
> & {
  before?: Partial<Record<OperationName | "all", PolicyRuleSet<TContext, TTable>>>;
  after?: Partial<Record<OperationName | "all", PolicyRuleSet<TContext, TTable>>>;
};

export type ResourcePolicy<TContext, TTable extends AnyTable> =
  | PolicyRuleSet<TContext, TTable>
  | ResourcePolicyContainer<TContext, TTable>;

export type CollectedPolicyRule<TContext, TTable extends AnyTable> = {
  rule: PolicyRule<TContext, TTable, any>;
  timing: AuthorizationTiming;
};

export function policy<TContext = unknown>() {
  return <TTable extends AnyTable, const TPolicy extends ResourcePolicy<TContext, TTable>>(rules: TPolicy) => rules;
}

function defineRule<TContext, TTable extends AnyTable, TInput = unknown>(
  rule: PolicyRule<TContext, TTable, TInput>,
  metadata?: { timing?: AuthorizationTiming; description?: string },
): PolicyRule<TContext, TTable, TInput> {
  if (metadata?.timing !== undefined) {
    rule.timing = metadata.timing;
  }
  if (metadata?.description !== undefined) {
    rule.description = metadata.description;
  }
  return rule;
}

function getPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function defaultUserSelector(ctx: unknown): unknown {
  return (
    getPath(ctx, ["user"]) ??
    getPath(ctx, ["session", "user"]) ??
    getPath(ctx, ["auth", "user"]) ??
    getPath(ctx, ["session"])
  );
}

function readArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value instanceof Set) {
    return [...value];
  }
  return value === undefined || value === null ? [] : [value];
}

export const allow = {
  all<TContext = unknown, TTable extends AnyTable = AnyTable>(): PolicyRule<TContext, TTable> {
    return defineRule(() => true, { description: "allow.all" });
  },

  when<TContext, TTable extends AnyTable, TInput = unknown>(
    predicate: (args: PolicyRuleArgs<TContext, TTable, TInput>) => MaybePromise<boolean>,
    metadata?: { timing?: AuthorizationTiming; description?: string },
  ): PolicyRule<TContext, TTable, TInput> {
    return defineRule(async (args) => predicate(args), metadata);
  },

  authenticated<TContext = unknown, TTable extends AnyTable = AnyTable>(
    selector?: (ctx: TContext) => unknown,
  ): PolicyRule<TContext, TTable> {
    const resolvedSelector: (ctx: TContext) => unknown = selector ?? defaultUserSelector;
    return defineRule(
      ({ ctx }) => {
        if (!resolvedSelector(ctx)) {
          return { allow: false, unauthorized: true, reason: "Authentication is required." };
        }
        return true;
      },
      { description: "allow.authenticated" },
    );
  },

  role<TContext = unknown, TTable extends AnyTable = AnyTable>(
    roles: string | readonly string[],
    selector: (ctx: TContext) => unknown = (ctx) =>
      getPath(ctx, ["user", "roles"]) ??
      getPath(ctx, ["user", "role"]) ??
      getPath(ctx, ["session", "user", "roles"]) ??
      getPath(ctx, ["session", "user", "role"]),
  ): PolicyRule<TContext, TTable> {
    const expected = new Set(readArray(roles).map(String));
    return defineRule(
      ({ ctx }) => readArray(selector(ctx)).some((role) => expected.has(String(role))),
      { description: "allow.role" },
    );
  },

  permission<TContext = unknown, TTable extends AnyTable = AnyTable>(
    permissions: string | readonly string[],
    selector: (ctx: TContext) => unknown = (ctx) =>
      getPath(ctx, ["user", "permissions"]) ?? getPath(ctx, ["session", "user", "permissions"]),
  ): PolicyRule<TContext, TTable> {
    const expected = new Set(readArray(permissions).map(String));
    return defineRule(
      ({ ctx }) => readArray(selector(ctx)).some((permission) => expected.has(String(permission))),
      { description: "allow.permission" },
    );
  },

  owner<TContext, TTable extends AnyTable>(selectors: {
    userId: (ctx: TContext) => unknown;
    rowUserId: (row: InferSelectModel<TTable>) => unknown;
  }): PolicyRule<TContext, TTable> {
    return defineRule(
      ({ ctx, row }) => {
        if (!row) {
          return false;
        }
        return selectors.userId(ctx) === selectors.rowUserId(row);
      },
      { timing: "after", description: "allow.owner" },
    );
  },

  scope<TContext, TTable extends AnyTable, TInput = unknown>(
    createScope: (args: PolicyRuleArgs<TContext, TTable, TInput>) => MaybePromise<SQL | readonly SQL[] | undefined>,
  ): PolicyRule<TContext, TTable, TInput> {
    return defineRule(
      async (args) => {
        const scope = await createScope(args);
        return scope === undefined ? { allow: true } : { allow: true, scope };
      },
      { timing: "before", description: "allow.scope" },
    );
  },
};

export const deny = {
  all<TContext = unknown, TTable extends AnyTable = AnyTable>(reason = "Access denied."): PolicyRule<TContext, TTable> {
    return defineRule(() => ({ allow: false, reason }), { description: "deny.all" });
  },
};

function asRuleArray<TContext, TTable extends AnyTable>(
  value: PolicyRuleSet<TContext, TTable> | undefined,
): PolicyRule<TContext, TTable, any>[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value as PolicyRule<TContext, TTable, any>];
}

function isPolicyRule(value: unknown): value is PolicyRule<any, AnyTable, any> {
  return typeof value === "function";
}

export function collectPolicyRules<TContext, TTable extends AnyTable>(
  source: ResourcePolicy<TContext, TTable> | undefined,
  operation: OperationName,
): CollectedPolicyRule<TContext, TTable>[] {
  if (!source) {
    return [];
  }

  if (isPolicyRule(source) || Array.isArray(source)) {
    return asRuleArray(source).map((rule) => ({ rule, timing: rule.timing ?? "before" }));
  }

  const container = source as ResourcePolicyContainer<TContext, TTable>;
  const collected: CollectedPolicyRule<TContext, TTable>[] = [];
  const directRules = [...asRuleArray(container.all), ...asRuleArray(container[operation])];
  for (const rule of directRules) {
    collected.push({ rule, timing: rule.timing ?? "before" });
  }

  const beforeRules = [...asRuleArray(container.before?.all), ...asRuleArray(container.before?.[operation])];
  for (const rule of beforeRules) {
    collected.push({ rule, timing: "before" });
  }

  const afterRules = [...asRuleArray(container.after?.all), ...asRuleArray(container.after?.[operation])];
  for (const rule of afterRules) {
    collected.push({ rule, timing: "after" });
  }

  return collected;
}

export function assertPolicyDecision(decision: PolicyDecision): { scopes: SQL[] } {
  if (decision === true || decision === "allow") {
    return { scopes: [] };
  }

  if (decision === false || decision === "deny") {
    throw new ForbiddenError();
  }

  if (!decision.allow) {
    if (decision.unauthorized) {
      throw new AuthorizationError(decision.reason);
    }
    throw new ForbiddenError(decision.reason);
  }

  const scopes = decision.scope ? (Array.isArray(decision.scope) ? [...decision.scope] : [decision.scope]) : [];
  return { scopes };
}
