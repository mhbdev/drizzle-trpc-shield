import type { SQL, Table as AnyTable } from "drizzle-orm";

import type { ShieldConfig } from "./create-shield.js";
import { getOperationConfig, type AnyResource } from "./resource.js";
import type { MaybePromise, OperationName } from "./types.js";
import { assertPolicyDecision, collectPolicyRules, type CollectedPolicyRule } from "../policy/policy.js";
import type { OperationLifecycle, OperationHookArgs, ShieldPlugin, ShieldPluginHookArgs } from "../plugins/plugin.js";

export type PipelineArgs<TContext extends object> = {
  config: ShieldConfig<TContext, any>;
  ctx: TContext;
  resource: AnyResource;
  resourceName: string;
  operation: OperationName;
  input: unknown;
};

function operationPolicyRules<TContext>(
  resource: AnyResource,
  operation: OperationName,
): CollectedPolicyRule<TContext, AnyTable>[] {
  const config = getOperationConfig(resource, operation);
  const policy = config.policy;

  if (!policy) {
    return [];
  }

  const rules = Array.isArray(policy) ? policy : [policy];
  return rules.map((rule) => ({ rule, timing: rule.timing ?? "before" }));
}

export function collectAllRules<TContext extends object>(
  config: ShieldConfig<TContext, any>,
  resource: AnyResource,
  operation: OperationName,
): CollectedPolicyRule<TContext, AnyTable>[] {
  return [
    ...collectPolicyRules(config.policy, operation),
    ...collectPolicyRules(resource.options.policy, operation),
    ...operationPolicyRules<TContext>(resource, operation),
  ];
}

function shouldRun(timing: "before" | "after", ruleTiming: "before" | "after" | "both"): boolean {
  return ruleTiming === "both" || ruleTiming === timing;
}

export async function authorizeBefore<TContext extends object>(args: PipelineArgs<TContext>): Promise<SQL[]> {
  const scopes: SQL[] = [];
  const rules = collectAllRules(args.config, args.resource, args.operation).filter((entry) =>
    shouldRun("before", entry.timing),
  );

  for (const { rule } of rules) {
    const decision = await rule({
      ctx: args.ctx,
      input: args.input,
      operation: args.operation,
      resourceName: args.resourceName,
      table: args.resource.table,
    });
    scopes.push(...assertPolicyDecision(decision).scopes);
  }

  return scopes;
}

export async function authorizeAfter<TContext extends object>(
  args: PipelineArgs<TContext> & { row?: Record<string, unknown> },
): Promise<void> {
  const rules = collectAllRules(args.config, args.resource, args.operation).filter((entry) =>
    shouldRun("after", entry.timing),
  );

  for (const { rule } of rules) {
    const decision = await rule({
      ctx: args.ctx,
      input: args.input,
      operation: args.operation,
      resourceName: args.resourceName,
      table: args.resource.table,
      row: args.row as never,
    });
    assertPolicyDecision(decision);
  }
}

export function pluginsFor<TContext extends object>(
  config: ShieldConfig<TContext, any>,
  resource: AnyResource,
): ShieldPlugin<TContext>[] {
  return [...(config.plugins ?? []), ...(resource.options.plugins ?? [])] as ShieldPlugin<TContext>[];
}

export async function runPluginHook<TContext extends object>(
  plugins: readonly ShieldPlugin<TContext>[],
  hook: keyof NonNullable<ShieldPlugin<TContext>["hooks"]>,
  args: ShieldPluginHookArgs<TContext>,
): Promise<void> {
  for (const plugin of plugins) {
    const fn = plugin.hooks?.[hook] as ((args: ShieldPluginHookArgs<TContext>) => Promise<void> | void) | undefined;
    await fn?.(args);
  }
}

export async function runTransformHook<TContext extends object>(
  plugins: readonly ShieldPlugin<TContext>[],
  hook: "beforeValidate" | "afterValidate" | "beforeQuery" | "afterQuery" | "beforeReturn",
  args: ShieldPluginHookArgs<TContext>,
  valueKey: "input" | "result",
  value: unknown,
): Promise<unknown> {
  let current = value;
  for (const plugin of plugins) {
    const fn = plugin.hooks?.[hook] as ((args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>) | undefined;
    const next = await fn?.({ ...args, [valueKey]: current });
    if (next !== undefined) {
      current = next;
    }
  }
  return current;
}

const OPERATION_HOOK_NAMES = {
  list: { before: "beforeList", after: "afterList" },
  get: { before: "beforeGet", after: "afterGet" },
  create: { before: "beforeCreate", after: "afterCreate" },
  createMany: { before: "beforeCreateMany", after: "afterCreateMany" },
  update: { before: "beforeUpdate", after: "afterUpdate" },
  delete: { before: "beforeDelete", after: "afterDelete" },
  deleteMany: { before: "beforeDeleteMany", after: "afterDeleteMany" },
} as const;

export function getOperationHookName<TOperation extends OperationLifecycle>(
  operation: TOperation,
  phase: "before" | "after",
): keyof NonNullable<ShieldPlugin<any>["hooks"]> {
  return OPERATION_HOOK_NAMES[operation][phase];
}

export async function runOperationHook<TContext extends object, TOperation extends OperationLifecycle>(
  plugins: readonly ShieldPlugin<TContext>[],
  phase: "before" | "after",
  operation: TOperation,
  args: OperationHookArgs<TContext, TOperation>,
): Promise<void> {
  const hook = getOperationHookName(operation, phase);
  for (const plugin of plugins) {
    const fn = plugin.hooks?.[hook] as ((args: OperationHookArgs<TContext, TOperation>) => Promise<void> | void) | undefined;
    await fn?.(args);
  }
}
