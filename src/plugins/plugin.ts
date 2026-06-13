import type { Table as AnyTable } from "drizzle-orm";

import type { AnyResource } from "../core/resource.js";
import type { MaybePromise, OperationName } from "../core/types.js";

export type ShieldPluginHookArgs<TContext = unknown> = {
  ctx: TContext;
  db: unknown;
  resource: AnyResource;
  resourceName: string;
  operation: OperationName;
  input: unknown;
  result?: unknown;
  error?: unknown;
};

export type OperationLifecycle = OperationName;

export type OperationHookArgs<TContext = unknown, TOperation extends OperationLifecycle = OperationLifecycle> = Omit<
  ShieldPluginHookArgs<TContext>,
  "operation"
> & {
  operation: TOperation;
};

export type ShieldOperationHooks<TContext = unknown> = {
  beforeList?: (args: OperationHookArgs<TContext, "list">) => MaybePromise<void>;
  afterList?: (args: OperationHookArgs<TContext, "list">) => MaybePromise<void>;
  beforeGet?: (args: OperationHookArgs<TContext, "get">) => MaybePromise<void>;
  afterGet?: (args: OperationHookArgs<TContext, "get">) => MaybePromise<void>;
  beforeCreate?: (args: OperationHookArgs<TContext, "create">) => MaybePromise<void>;
  afterCreate?: (args: OperationHookArgs<TContext, "create">) => MaybePromise<void>;
  beforeCreateMany?: (args: OperationHookArgs<TContext, "createMany">) => MaybePromise<void>;
  afterCreateMany?: (args: OperationHookArgs<TContext, "createMany">) => MaybePromise<void>;
  beforeUpdate?: (args: OperationHookArgs<TContext, "update">) => MaybePromise<void>;
  afterUpdate?: (args: OperationHookArgs<TContext, "update">) => MaybePromise<void>;
  beforeDelete?: (args: OperationHookArgs<TContext, "delete">) => MaybePromise<void>;
  afterDelete?: (args: OperationHookArgs<TContext, "delete">) => MaybePromise<void>;
  beforeDeleteMany?: (args: OperationHookArgs<TContext, "deleteMany">) => MaybePromise<void>;
  afterDeleteMany?: (args: OperationHookArgs<TContext, "deleteMany">) => MaybePromise<void>;
};

export type ShieldPlugin<TContext = unknown> = {
  name: string;
  hooks?: ShieldOperationHooks<TContext> & {
    onResourceInit?: (args: { resource: AnyResource; resourceName: string }) => MaybePromise<void>;
    beforeValidate?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>;
    afterValidate?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>;
    beforeAuthorize?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<void>;
    afterAuthorize?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<void>;
    beforeQuery?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>;
    afterQuery?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>;
    beforeReturn?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<unknown>;
    onError?: (args: ShieldPluginHookArgs<TContext>) => MaybePromise<void>;
  };
};

export function createSoftDeletePlugin<TContext = unknown>(options: {
  column?: string;
  deletedValue?: unknown;
  activeValue?: unknown;
} = {}): ShieldPlugin<TContext> {
  const column = options.column ?? "deletedAt";
  return {
    name: "soft-delete",
    hooks: {
      onResourceInit({ resource, resourceName }) {
        const table = resource.table as AnyTable & Record<string, unknown>;
        if (!(column in table)) {
          return;
        }
        resource.options.meta = {
          ...resource.options.meta,
          softDelete: {
            resourceName,
            column,
            deletedValue: options.deletedValue ?? new Date(),
            activeValue: options.activeValue ?? null,
          },
        };
      },
    },
  };
}
