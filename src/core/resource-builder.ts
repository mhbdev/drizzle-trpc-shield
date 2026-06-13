import type { Table as AnyTable } from "drizzle-orm";

import type { PolicyRule, ResourcePolicy, ResourcePolicyContainer } from "../policy/policy.js";
import type { ShieldPlugin, ShieldPluginHookArgs } from "../plugins/plugin.js";
import type {
  ColumnPolicy,
  OperationName,
  PaginationConfig,
  ResourceRuntimeOptions,
  StringKeyOf,
  TableSelect,
} from "./types.js";
import { defineTable, type ResourceDefinition } from "./resource.js";

type BuilderOperationName = OperationName | "findMany" | "findById";

function normalizeOperationName(operation: BuilderOperationName): OperationName {
  switch (operation) {
    case "findMany":
      return "list";
    case "findById":
      return "get";
    default:
      return operation;
  }
}

function allOperations(): Record<OperationName, true> {
  return {
    list: true,
    get: true,
    create: true,
    createMany: true,
    update: true,
    delete: true,
    deleteMany: true,
  };
}

function mergePolicy<TContext, TTable extends AnyTable>(
  current: ResourcePolicy<TContext, TTable> | undefined,
  next: readonly PolicyRule<TContext, TTable>[],
): ResourcePolicy<TContext, TTable> {
  if (!current) {
    return [...next];
  }
  if (Array.isArray(current)) {
    return [...current, ...next];
  }
  if (typeof current === "function") {
    return [current, ...next];
  }
  const container = current as ResourcePolicyContainer<TContext, TTable>;
  return {
    ...container,
    all: container.all
      ? Array.isArray(container.all)
        ? [...container.all, ...next]
        : [container.all, ...next]
      : [...next],
  };
}

function mergeRuleSet<TContext, TTable extends AnyTable>(
  current: PolicyRule<TContext, TTable, any> | readonly PolicyRule<TContext, TTable, any>[] | undefined,
  next: readonly PolicyRule<TContext, TTable>[],
): PolicyRule<TContext, TTable, any>[] {
  if (!current) {
    return [...next];
  }
  return Array.isArray(current) ? [...current, ...next] : [current as PolicyRule<TContext, TTable, any>, ...next];
}

function pushHookPlugin<TContext extends object>(
  plugins: ShieldPlugin<TContext>[],
  hook: "beforeQuery" | "afterQuery",
  operation: OperationName,
  handler: (args: ShieldPluginHookArgs<TContext>) => unknown,
) {
  plugins.push({
    name: `builder:${hook}:${operation}`,
    hooks: {
      [hook]: (args: ShieldPluginHookArgs<TContext>) =>
        args.operation === operation ? handler(args) : undefined,
    },
  });
}

export type ResourceBuilder<TTable extends AnyTable, TContext extends object = object> = {
  operations(...operations: readonly BuilderOperationName[]): ResourceBuilder<TTable, TContext>;
  disableOperation(operation: BuilderOperationName): ResourceBuilder<TTable, TContext>;
  guards(...rules: PolicyRule<TContext, TTable>[]): ResourceBuilder<TTable, TContext>;
  operationGuards(operation: BuilderOperationName, ...rules: PolicyRule<TContext, TTable>[]): ResourceBuilder<TTable, TContext>;
  columnPolicy<TKey extends StringKeyOf<TableSelect<TTable>>>(
    column: TKey,
    policy: ColumnPolicy,
  ): ResourceBuilder<TTable, TContext>;
  transform<TKey extends StringKeyOf<TableSelect<TTable>>>(
    column: TKey,
    fn: (value: TableSelect<TTable>[TKey], row: TableSelect<TTable>) => unknown,
  ): ResourceBuilder<TTable, TContext>;
  beforeQuery(operation: BuilderOperationName, handler: (args: ShieldPluginHookArgs<TContext>) => unknown): ResourceBuilder<TTable, TContext>;
  afterQuery(operation: BuilderOperationName, handler: (args: ShieldPluginHookArgs<TContext>) => unknown): ResourceBuilder<TTable, TContext>;
  defaultSelect(...columns: readonly StringKeyOf<TableSelect<TTable>>[]): ResourceBuilder<TTable, TContext>;
  pagination(config: PaginationConfig<TTable>): ResourceBuilder<TTable, TContext>;
  plugin(plugin: ShieldPlugin<TContext>): ResourceBuilder<TTable, TContext>;
  meta(meta: Record<string, unknown>): ResourceBuilder<TTable, TContext>;
  build(): ResourceDefinition<TTable, ResourceRuntimeOptions<TContext, TTable>>;
};

export function defineResource<const TTable extends AnyTable, TContext extends object = object>(
  table: TTable,
): ResourceBuilder<TTable, TContext> {
  const plugins: ShieldPlugin<TContext>[] = [];
  const options: ResourceRuntimeOptions<TContext, TTable> = {
    operations: allOperations(),
    meta: {},
  };

  const builder: ResourceBuilder<TTable, TContext> = {
    operations(...operations) {
      options.operations = {
        list: false,
        get: false,
        create: false,
        createMany: false,
        update: false,
        delete: false,
        deleteMany: false,
      };
      for (const operation of operations) {
        options.operations[normalizeOperationName(operation)] = true;
      }
      return builder;
    },
    disableOperation(operation) {
      options.operations ??= allOperations();
      options.operations[normalizeOperationName(operation)] = false;
      return builder;
    },
    guards(...rules) {
      options.policy = mergePolicy(options.policy, rules);
      return builder;
    },
    operationGuards(operation, ...rules) {
      const normalized = normalizeOperationName(operation);
      const current = options.operations?.[normalized];
      options.operations ??= {};
      options.operations[normalized] =
        current && typeof current === "object"
          ? {
              ...current,
              policy: mergeRuleSet(current.policy, rules),
            }
          : {
              enabled: true,
              policy: mergeRuleSet(undefined, rules),
            };
      return builder;
    },
    columnPolicy(column, policy) {
      options.columnPolicies = {
        ...(options.columnPolicies ?? {}),
        [column]: {
          ...(options.columnPolicies?.[column] ?? {}),
          ...policy,
        },
      };
      return builder;
    },
    transform(column, fn) {
      options.transforms = {
        ...(options.transforms ?? {}),
        [column]: fn,
      };
      return builder;
    },
    beforeQuery(operation, handler) {
      pushHookPlugin(plugins, "beforeQuery", normalizeOperationName(operation), handler);
      return builder;
    },
    afterQuery(operation, handler) {
      pushHookPlugin(plugins, "afterQuery", normalizeOperationName(operation), handler);
      return builder;
    },
    defaultSelect(...columns) {
      options.fields = {
        ...(options.fields ?? {}),
        select: columns,
      };
      return builder;
    },
    pagination(config) {
      options.pagination = config;
      return builder;
    },
    plugin(plugin) {
      plugins.push(plugin);
      return builder;
    },
    meta(meta) {
      options.meta = {
        ...(options.meta ?? {}),
        ...meta,
      };
      return builder;
    },
    build() {
      return defineTable(table, {
        ...options,
        plugins,
      });
    },
  };

  return builder;
}
