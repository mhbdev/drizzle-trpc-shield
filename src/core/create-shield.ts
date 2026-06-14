import type { Table as AnyTable } from "drizzle-orm";

import { ConfigurationError } from "./errors.js";
import {
  assertResource,
  defineTable,
  getResourceName,
  isOperationEnabled,
  type AnyResource,
  type ResourceDefinition,
} from "./resource.js";
import type { OperationName, ResourceRuntimeOptions, ShieldRouterContract } from "./types.js";
import { collectAllRules, pluginsFor } from "./pipeline.js";
import type { PolicyRule, ResourcePolicy, ResourcePolicyContainer } from "../policy/policy.js";
import type { ShieldPlugin } from "../plugins/plugin.js";
import {
  createResourceRouter,
  createRootRouter,
  createTRPCFactory,
  type ResourceRouter,
  type RootRouter,
  type TRPCFactory,
} from "../trpc/router-factory.js";
import { createZodValidationAdapter, type ValidationAdapter } from "../validation/zod.js";

export type ShieldConfig<TContext extends object, TResources extends Record<string, AnyResource>> = {
  db: unknown;
  resources: TResources;
  trpc?: TRPCFactory;
  policy?: ResourcePolicy<TContext, AnyTable>;
  validation?: ValidationAdapter;
  plugins?: readonly ShieldPlugin<TContext>[];
  security?: {
    requirePolicies?: boolean;
  };
};

export type CreateShieldResult<TResources extends Record<string, AnyResource>> = {
  router: RootRouter<TResources>;
  routers: {
    [TName in keyof TResources]: ResourceRouter<TResources[TName]>;
  };
  contract: ShieldRouterContract<TResources>;
  resources: TResources;
  trpc: TRPCFactory;
};

export type DbRouterConfig<TContext extends object, TResources extends Record<string, AnyResource>> = Omit<
  ShieldConfig<TContext, TResources>,
  "resources"
> & {
  tables: TResources;
};

export type CreateShieldRouterConfig<TContext extends object, TResources extends Record<string, { table: AnyTable }>> = {
  db: unknown;
  t?: TRPCFactory;
  trpc?: TRPCFactory;
  config: {
      resources: TResources;
      globalGuards?: readonly PolicyRule<TContext, AnyTable>[];
      policy?: ResourcePolicy<TContext, AnyTable>;
      validation?: ValidationAdapter;
      plugins?: readonly ShieldPlugin<TContext>[];
      security?: {
      requirePolicies?: boolean;
    };
  };
};

type NormalizedResource<TContext extends object, TEntry> = TEntry extends AnyResource
  ? TEntry
  : TEntry extends { table: infer TTable extends AnyTable }
    ? ResourceDefinition<TTable, Omit<TEntry, "table"> & ResourceRuntimeOptions<TContext, TTable>>
    : never;

type NormalizedResources<TContext extends object, TResources extends Record<string, { table: AnyTable }>> = {
  [TName in keyof TResources]: NormalizedResource<TContext, TResources[TName]>;
};

export function createContextContract<TContext>() {
  return undefined as unknown as TContext;
}

const OPERATIONS = [
  "list",
  "get",
  "create",
  "createMany",
  "update",
  "delete",
  "deleteMany",
] as const satisfies readonly OperationName[];
const ALL_OPERATIONS = {
  list: true,
  get: true,
  create: true,
  createMany: true,
  update: true,
  delete: true,
  deleteMany: true,
} as const;

function isResourceDefinition(value: unknown): value is AnyResource {
  return Boolean(value && typeof value === "object" && "kind" in value && "table" in value && "options" in value);
}

function mergeGlobalPolicy<TContext extends object>(
  guards: readonly PolicyRule<TContext, AnyTable>[] | undefined,
  policy: ResourcePolicy<TContext, AnyTable> | undefined,
): ResourcePolicy<TContext, AnyTable> | undefined {
  if (!guards || guards.length === 0) {
    return policy;
  }
  if (!policy) {
    return [...guards];
  }
  if (Array.isArray(policy)) {
    return [...guards, ...policy];
  }
  if (typeof policy === "function") {
    return [...guards, policy];
  }
  const container = policy as ResourcePolicyContainer<TContext, AnyTable>;
  return {
    ...container,
    all: container.all
      ? Array.isArray(container.all)
        ? [...guards, ...container.all]
        : [...guards, container.all]
      : [...guards],
  };
}

function normalizeResources<TContext extends object, TResources extends Record<string, { table: AnyTable }>>(
  resources: TResources,
): NormalizedResources<TContext, TResources> {
  const normalized = {} as NormalizedResources<TContext, TResources>;

  for (const [key, value] of Object.entries(resources) as Array<[keyof TResources, TResources[keyof TResources]]>) {
    if (isResourceDefinition(value)) {
      normalized[key] = value as NormalizedResources<TContext, TResources>[typeof key];
      continue;
    }

    const raw = value as { table: AnyTable } & Partial<ResourceRuntimeOptions<TContext, AnyTable>>;
    const { table, ...options } = raw;
    if (!table) {
      throw new ConfigurationError(`Resource "${String(key)}" must define a Drizzle table.`);
    }
    normalized[key] = defineTable(table, {
      ...options,
      name: options.name ?? String(key),
      operations: options.operations ?? ALL_OPERATIONS,
    }) as NormalizedResources<TContext, TResources>[typeof key];
  }

  return normalized;
}

function validateResources<TContext extends object, TResources extends Record<string, AnyResource>>(
  config: ShieldConfig<TContext, TResources>,
): void {
  for (const [key, definition] of Object.entries(config.resources)) {
    assertResource(definition);

    const enabled = OPERATIONS.filter((operation) => isOperationEnabled(definition, operation));
    if (enabled.length === 0) {
      throw new ConfigurationError(
        `Resource "${getResourceName(key, definition)}" has no enabled operations. Enable at least one operation explicitly.`,
      );
    }

    if (config.security?.requirePolicies === false) {
      continue;
    }

    for (const operation of enabled) {
      const rules = collectAllRules(config, definition, operation);
      if (rules.length === 0) {
        throw new ConfigurationError(
          `Resource "${getResourceName(key, definition)}" enables "${operation}" but has no policy. Add a global, resource, or operation policy.`,
        );
      }
    }
  }
}

export function createShield<TContext extends object = Record<string, never>, const TResources extends Record<string, AnyResource> = Record<string, AnyResource>>(
  config: ShieldConfig<TContext, TResources>,
): CreateShieldResult<TResources> {
  validateResources(config);

  const t = createTRPCFactory(config);
  const validation = config.validation ?? createZodValidationAdapter();
  const routers = {} as CreateShieldResult<TResources>["routers"];

  for (const [key, definition] of Object.entries(config.resources)) {
    const resourceName = getResourceName(key, definition);
    const plugins = pluginsFor(config, definition);
    for (const plugin of plugins) {
      void plugin.hooks?.onResourceInit?.({ resource: definition, resourceName });
    }

    routers[key as keyof TResources] = createResourceRouter({
      config,
      t,
      resource: definition,
      resourceName,
      validation,
    }) as ResourceRouter<TResources[typeof key]>;
  }

  return {
    router: createRootRouter({
      config,
      t,
      resources: config.resources,
      validation,
    }),
    routers,
    contract: undefined as unknown as ShieldRouterContract<TResources>,
    resources: config.resources,
    trpc: t,
  };
}

export function createDbRouter<TContext extends object, const TResources extends Record<string, AnyResource>>(
  config: DbRouterConfig<TContext, TResources>,
): RootRouter<TResources> {
  return createShield({
    ...config,
    resources: config.tables,
  }).router;
}

export function createShieldRouter<TContext extends object, const TResources extends Record<string, { table: AnyTable }>>(
  args: CreateShieldRouterConfig<TContext, TResources>,
): RootRouter<NormalizedResources<TContext, TResources>> {
  const t = args.t ?? args.trpc;
  if (!t) {
    throw new ConfigurationError("createShieldRouter requires a tRPC factory.");
  }

  const resources = normalizeResources<TContext, TResources>(args.config.resources);
  const policy = mergeGlobalPolicy(args.config.globalGuards, args.config.policy);

  return createShield({
    db: args.db,
    trpc: t,
    resources,
    ...(policy === undefined ? {} : { policy }),
    ...(args.config.validation === undefined ? {} : { validation: args.config.validation }),
    ...(args.config.plugins === undefined ? {} : { plugins: args.config.plugins }),
    ...(args.config.security === undefined ? {} : { security: args.config.security }),
  }).router;
}
