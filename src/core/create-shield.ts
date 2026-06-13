import type { Table as AnyTable } from "drizzle-orm";

import { ConfigurationError } from "./errors.js";
import { assertResource, getResourceName, isOperationEnabled, type AnyResource } from "./resource.js";
import type { OperationName, ShieldRouterContract } from "./types.js";
import { collectAllRules, pluginsFor } from "./pipeline.js";
import type { ResourcePolicy } from "../policy/policy.js";
import type { ShieldPlugin } from "../plugins/plugin.js";
import {
  createResourceRouter,
  createRootRouter,
  createTRPCFactory,
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
  routers: Record<keyof TResources, unknown>;
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

export function createContextContract<TContext>() {
  return undefined as unknown as TContext;
}

const OPERATIONS = ["list", "get", "create", "update", "delete"] as const satisfies readonly OperationName[];

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
  const routers = {} as Record<keyof TResources, unknown>;

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
    });
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
