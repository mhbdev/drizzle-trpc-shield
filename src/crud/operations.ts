import { and, type SQL } from "drizzle-orm";

import type { ShieldConfig } from "../core/create-shield.js";
import { ConfigurationError, NotFoundError } from "../core/errors.js";
import type { AnyResource } from "../core/resource.js";
import type { ListInput, MaybePromise, OperationName } from "../core/types.js";
import { getColumns, maskRow, pickWritableData, primaryKeyWhere } from "../drizzle/columns.js";
import { buildOrderBy, buildWhere } from "../query/filters.js";
import { authorizeAfter, authorizeBefore, pluginsFor, runOperationHook, runPluginHook } from "../core/pipeline.js";
import type { OperationHookArgs } from "../plugins/plugin.js";

type CrudArgs<TContext extends object> = {
  config: ShieldConfig<TContext, any>;
  db: any;
  ctx: TContext;
  resource: AnyResource;
  resourceName: string;
  operation: OperationName;
  input: unknown;
};

function combineWhere(...conditions: (SQL | undefined)[]): SQL | undefined {
  const present = conditions.filter(Boolean) as SQL[];
  if (present.length === 0) {
    return undefined;
  }
  return present.length === 1 ? present[0] : and(...present);
}

async function selectOne(args: CrudArgs<any>, where: SQL): Promise<Record<string, unknown> | undefined> {
  const query = args.db.select(getColumns(args.resource.table)).from(args.resource.table).where(where).limit(1);
  const rows = (await query) as Record<string, unknown>[];
  return rows[0];
}

function returningCapable(query: unknown): query is { returning: (selection?: unknown) => Promise<unknown[]> } {
  return Boolean(query && typeof query === "object" && "returning" in query && typeof (query as any).returning === "function");
}

async function executeReturningOrThrow(
  query: unknown,
  selection: Record<string, unknown>,
  message: string,
): Promise<Record<string, unknown>[]> {
  if (!returningCapable(query)) {
    throw new ConfigurationError(message);
  }
  return (await query.returning(selection)) as Record<string, unknown>[];
}

export async function withPipeline<TContext extends object, TOutput>(
  args: CrudArgs<TContext>,
  action: (scopes: SQL[]) => MaybePromise<TOutput>,
): Promise<TOutput> {
  const plugins = pluginsFor(args.config, args.resource);
  const hookArgs = {
    ctx: args.ctx,
    db: args.db,
    resource: args.resource,
    resourceName: args.resourceName,
    operation: args.operation,
    input: args.input,
  } as OperationHookArgs<TContext, OperationName>;

  try {
    await runPluginHook(plugins, "beforeAuthorize", hookArgs);
    const scopes = await authorizeBefore(args);
    await runPluginHook(plugins, "afterAuthorize", hookArgs);
    await runPluginHook(plugins, "beforeQuery", hookArgs);
    await runOperationHook(plugins, "before", args.operation, hookArgs);
    const result = await action(scopes);
    await runOperationHook(plugins, "after", args.operation, { ...hookArgs, result });
    await runPluginHook(plugins, "afterQuery", { ...hookArgs, result });
    await runPluginHook(plugins, "beforeReturn", { ...hookArgs, result });
    return result;
  } catch (error) {
    await runPluginHook(plugins, "onError", { ...hookArgs, error });
    throw error;
  }
}

export async function executeList<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes) => {
    const input = (args.input ?? {}) as ListInput<any, any>;
    const limit = input.limit ?? args.resource.options.query?.defaultLimit ?? 25;
    const offset = input.offset ?? 0;
    const where = buildWhere(args.resource, input.where, scopes);
    const orderBy = buildOrderBy(args.resource, input.orderBy as any);

    let query = args.db.select(getColumns(args.resource.table)).from(args.resource.table);
    if (where) {
      query = query.where(where);
    }
    if (orderBy.length > 0) {
      query = query.orderBy(...orderBy);
    }
    query = query.limit(limit + 1).offset(offset);

    const rows = (await query) as Record<string, unknown>[];
    const visibleRows: Record<string, unknown>[] = [];

    for (const row of rows.slice(0, limit)) {
      try {
        await authorizeAfter({ ...args, row });
        visibleRows.push(maskRow(args.resource, row));
      } catch {
        // Row-level list policies hide unauthorized rows instead of failing the whole collection.
      }
    }

    return {
      items: visibleRows,
      meta: {
        limit,
        offset,
        hasMore: rows.length > limit,
      },
    };
  });
}

export async function executeGet<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes) => {
    const where = combineWhere(primaryKeyWhere(args.resource, args.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build get condition.");
    }

    const row = await selectOne(args, where);
    if (!row) {
      throw new NotFoundError(`${args.resourceName} was not found.`);
    }

    await authorizeAfter({ ...args, row });
    return maskRow(args.resource, row);
  });
}

export async function executeCreate<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async () => {
    const data = pickWritableData(args.resource, args.input as Record<string, unknown>);
    const query = args.db.insert(args.resource.table).values(data);
    const rows = await executeReturningOrThrow(
      query,
      getColumns(args.resource.table),
      `Database driver for ${args.resourceName}.create does not support returning(). Provide a custom create operation executor.`,
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundError(`${args.resourceName} create did not return a row.`);
    }

    await authorizeAfter({ ...args, row });
    return maskRow(args.resource, row);
  });
}

export async function executeUpdate<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes) => {
    const input = args.input as { data: Record<string, unknown> };
    const where = combineWhere(primaryKeyWhere(args.resource, args.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build update condition.");
    }

    const current = await selectOne(args, where);
    if (!current) {
      throw new NotFoundError(`${args.resourceName} was not found.`);
    }
    await authorizeAfter({ ...args, row: current });

    const data = pickWritableData(args.resource, input.data);
    const query = args.db.update(args.resource.table).set(data).where(where);
    const rows = await executeReturningOrThrow(
      query,
      getColumns(args.resource.table),
      `Database driver for ${args.resourceName}.update does not support returning(). Provide a custom update operation executor.`,
    );
    const row = rows[0] ?? (await selectOne(args, where));
    if (!row) {
      throw new NotFoundError(`${args.resourceName} update did not return a row.`);
    }

    return maskRow(args.resource, row);
  });
}

export async function executeDelete<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes) => {
    const where = combineWhere(primaryKeyWhere(args.resource, args.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build delete condition.");
    }

    const current = await selectOne(args, where);
    if (!current) {
      throw new NotFoundError(`${args.resourceName} was not found.`);
    }
    await authorizeAfter({ ...args, row: current });

    const query = args.db.delete(args.resource.table).where(where);
    if (returningCapable(query)) {
      await query.returning(getColumns(args.resource.table));
    } else {
      await query;
    }

    return maskRow(args.resource, current);
  });
}
