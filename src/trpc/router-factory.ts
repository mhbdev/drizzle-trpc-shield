import {
  initTRPC,
  type AnyMutationProcedure,
  type AnyQueryProcedure,
  type AnyTRPCRootTypes,
  type TRPCBuiltRouter,
  type TRPCRouterBuilder,
} from "@trpc/server";

import type { ShieldConfig } from "../core/create-shield.js";
import { toTRPCError } from "../core/errors.js";
import { getOperationConfig, isOperationEnabled, type AnyResource } from "../core/resource.js";
import type { EnabledOperations, OperationName } from "../core/types.js";
import {
  executeCreate,
  executeDelete,
  executeGet,
  executeList,
  executeUpdate,
  withPipeline,
} from "../crud/operations.js";
import type { ValidationAdapter } from "../validation/zod.js";

export type TRPCFactory = {
  procedure: any;
  router: TRPCRouterBuilder<AnyTRPCRootTypes>;
};

type OperationProcedure<TOperation extends OperationName> = TOperation extends "list" | "get"
  ? AnyQueryProcedure
  : AnyMutationProcedure;

type ResourceRouterRecord<TResource extends AnyResource> = {
  [TOperation in EnabledOperations<TResource>]: OperationProcedure<TOperation>;
};

export type ResourceRouter<TResource extends AnyResource> = TRPCBuiltRouter<
  AnyTRPCRootTypes,
  ResourceRouterRecord<TResource>
>;

type RootRouterInput<TResources extends Record<string, AnyResource>> = {
  [TName in keyof TResources]: ResourceRouter<TResources[TName]>;
};

type RootRouterRecord<TResources extends Record<string, AnyResource>> = {
  [TName in keyof TResources]: ResourceRouterRecord<TResources[TName]>;
};

export type RootRouter<TResources extends Record<string, AnyResource>> = TRPCBuiltRouter<
  AnyTRPCRootTypes,
  RootRouterRecord<TResources>
>;

const DEFAULT_OPERATIONS = ["list", "get", "create", "update", "delete"] as const satisfies readonly OperationName[];

function isQuery(operation: OperationName): boolean {
  return operation === "list" || operation === "get";
}

async function executeOperation<TContext extends object>(args: {
  config: ShieldConfig<TContext, any>;
  db: unknown;
  ctx: TContext;
  resource: AnyResource;
  resourceName: string;
  operation: OperationName;
  input: unknown;
}) {
  const operationConfig = getOperationConfig(args.resource, args.operation);
  const custom = operationConfig["execute"] as ((args: unknown) => unknown) | undefined;

  if (custom) {
    return withPipeline(
      {
        config: args.config,
        db: args.db,
        ctx: args.ctx,
        resource: args.resource,
        resourceName: args.resourceName,
        operation: args.operation,
        input: args.input,
      },
      (scopes) =>
        custom({
          ctx: args.ctx,
          db: args.db,
          table: args.resource.table,
          input: args.input,
          operation: args.operation,
          resourceName: args.resourceName,
          scopes,
        }),
    );
  }

  switch (args.operation) {
    case "list":
      return executeList({ ...args, db: args.db as any });
    case "get":
      return executeGet({ ...args, db: args.db as any });
    case "create":
      return executeCreate({ ...args, db: args.db as any });
    case "update":
      return executeUpdate({ ...args, db: args.db as any });
    case "delete":
      return executeDelete({ ...args, db: args.db as any });
  }
}

export function createTRPCFactory<TContext extends object>(config: ShieldConfig<TContext, any>): TRPCFactory {
  return config.trpc ?? initTRPC.context<TContext>().create();
}

export function createResourceRouter<TContext extends object, const TResource extends AnyResource>(args: {
  config: ShieldConfig<TContext, any>;
  t: TRPCFactory;
  resource: TResource;
  resourceName: string;
  validation: ValidationAdapter;
}): ResourceRouter<TResource> {
  const procedures: Partial<Record<OperationName, AnyQueryProcedure | AnyMutationProcedure>> = {};

  for (const operation of DEFAULT_OPERATIONS) {
    if (!isOperationEnabled(args.resource, operation)) {
      continue;
    }

    const schema = args.validation.inputFor(args.resource, operation);
    const resolver = async ({ ctx, input }: { ctx: TContext; input: unknown }) => {
      try {
        return await executeOperation({
          config: args.config,
          db: args.config.db,
          ctx,
          resource: args.resource,
          resourceName: args.resourceName,
          operation,
          input,
        });
      } catch (error) {
        throw toTRPCError(error);
      }
    };

    const procedure = args.t.procedure.input(schema);
    procedures[operation] = isQuery(operation) ? procedure.query(resolver) : procedure.mutation(resolver);
  }

  return args.t.router(procedures as ResourceRouterRecord<TResource>);
}

export function createRootRouter<TContext extends object, const TResources extends Record<string, AnyResource>>(args: {
  config: ShieldConfig<TContext, any>;
  t: TRPCFactory;
  resources: TResources;
  validation: ValidationAdapter;
}): RootRouter<TResources> {
  const routers: Partial<RootRouterInput<TResources>> = {};

  for (const [key, resource] of Object.entries(args.resources) as Array<
    [keyof TResources, TResources[keyof TResources]]
  >) {
    routers[key] = createResourceRouter({
      config: args.config,
      t: args.t,
      resource,
      resourceName: resource.options.name ?? String(key),
      validation: args.validation,
    });
  }

  return args.t.router(routers as RootRouterInput<TResources>);
}
