import type { Table as AnyTable } from "drizzle-orm";

import { ConfigurationError } from "./errors.js";
import type { OperationName, OperationConfig, ResourceRuntimeOptions } from "./types.js";

const RESOURCE_KIND = Symbol.for("drizzle-trpc-shield.resource");

export type ResourceOptions<TContext, TTable extends AnyTable> = ResourceRuntimeOptions<TContext, TTable>;

export type ResourceDefinition<TTable extends AnyTable, TOptions extends ResourceOptions<any, TTable>> = {
  readonly kind: typeof RESOURCE_KIND;
  readonly table: TTable;
  readonly options: TOptions;
};

export type AnyResource = {
  readonly kind: typeof RESOURCE_KIND;
  readonly table: AnyTable;
  readonly options: ResourceRuntimeOptions<any, any>;
};

export function resource<const TTable extends AnyTable, const TOptions extends ResourceOptions<any, TTable>>(
  table: TTable,
  options: TOptions,
): ResourceDefinition<TTable, TOptions> {
  return {
    kind: RESOURCE_KIND,
    table,
    options,
  };
}

export function defineTable<const TTable extends AnyTable, const TOptions extends ResourceOptions<any, TTable>>(
  table: TTable,
  options: TOptions,
): ResourceDefinition<TTable, TOptions> {
  return resource(table, options);
}

export function assertResource(value: unknown): asserts value is AnyResource {
  if (!value || typeof value !== "object" || (value as { kind?: unknown }).kind !== RESOURCE_KIND) {
    throw new ConfigurationError("Invalid resource definition. Use resource(table, options).");
  }
}

export function getResourceName(key: string, definition: AnyResource): string {
  return definition.options.name ?? key;
}

export function isOperationEnabled(definition: AnyResource, operation: OperationName): boolean {
  const value = definition.options.operations?.[operation];

  if (value === undefined || value === false) {
    return false;
  }

  if (value === true) {
    return true;
  }

  return value.enabled !== false;
}

export function getOperationConfig(definition: AnyResource, operation: OperationName): OperationConfig<any, AnyTable, any, any> {
  const value = definition.options.operations?.[operation];
  return typeof value === "object" && value !== null ? (value as OperationConfig<any, AnyTable, any, any>) : {};
}
