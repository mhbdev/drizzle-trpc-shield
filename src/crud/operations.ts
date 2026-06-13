import { and, gt, lt, type SQL } from "drizzle-orm";

import type { ShieldConfig } from "../core/create-shield.js";
import { ConfigurationError, NotFoundError, ValidationError } from "../core/errors.js";
import type { AnyResource } from "../core/resource.js";
import type { MaybePromise, OperationName } from "../core/types.js";
import {
  getColumns,
  maskRow,
  pickWritableDataWithInjectedFields,
  primaryKeyWhere,
} from "../drizzle/columns.js";
import { buildOrderBy, buildWhere } from "../query/filters.js";
import {
  authorizeAfter,
  authorizeBefore,
  pluginsFor,
  runOperationHook,
  runPluginHook,
  runTransformHook,
} from "../core/pipeline.js";
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

type NormalizedListInput = {
  where?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  orderBy?: readonly { field: string; direction?: "asc" | "desc" }[];
  sort?: readonly { column: string; direction?: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  pagination?: {
    page?: number;
    limit?: number;
    cursor?: unknown;
  };
  cursor?: unknown;
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

async function selectMany(args: CrudArgs<any>, where: SQL): Promise<Record<string, unknown>[]> {
  const query = args.db.select(getColumns(args.resource.table)).from(args.resource.table).where(where);
  return (await query) as Record<string, unknown>[];
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
  action: (scopes: SQL[], runtimeArgs: CrudArgs<TContext>) => MaybePromise<TOutput>,
): Promise<Awaited<TOutput>> {
  const plugins = pluginsFor(args.config, args.resource);
  let hookArgs = {
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
    const input = await runTransformHook(plugins, "beforeQuery", hookArgs, "input", args.input);
    const runtimeArgs = { ...args, input };
    hookArgs = { ...hookArgs, input };
    await runOperationHook(plugins, "before", args.operation, hookArgs);
    let result: Awaited<TOutput> = await action(scopes, runtimeArgs);
    await runOperationHook(plugins, "after", args.operation, { ...hookArgs, result });
    result = (await runTransformHook(plugins, "afterQuery", { ...hookArgs, result }, "result", result)) as Awaited<TOutput>;
    result = (await runTransformHook(plugins, "beforeReturn", { ...hookArgs, result }, "result", result)) as Awaited<TOutput>;
    return result;
  } catch (error) {
    await runPluginHook(plugins, "onError", { ...hookArgs, error });
    throw error;
  }
}

function paginationLimits(resource: AnyResource): { defaultLimit: number; maxLimit: number } {
  const pagination = resource.options.pagination;
  const defaultLimit = pagination?.defaultLimit ?? resource.options.query?.defaultLimit ?? 25;
  const maxLimit = pagination?.maxLimit ?? resource.options.query?.maxLimit ?? 100;
  return { defaultLimit: Math.min(defaultLimit, maxLimit), maxLimit };
}

function normalizeListInput(resource: AnyResource, input: unknown): NormalizedListInput {
  const raw = (input ?? {}) as NormalizedListInput;
  const { defaultLimit, maxLimit } = paginationLimits(resource);
  const requestedLimit = raw.pagination?.limit ?? raw.limit ?? defaultLimit;
  const limit = Math.min(requestedLimit, maxLimit);
  const offset = raw.pagination?.page ? (raw.pagination.page - 1) * limit : raw.offset ?? 0;
  const orderBy =
    raw.orderBy ??
    raw.sort?.map((item) =>
      item.direction === undefined ? { field: item.column } : { field: item.column, direction: item.direction },
    );
  const where = raw.where ?? raw.filters;
  const normalized: NormalizedListInput = {
    ...raw,
    limit,
    offset,
  };

  if (where !== undefined) {
    normalized.where = where;
  }
  if (orderBy !== undefined) {
    normalized.orderBy = orderBy;
  }
  if (raw.pagination?.cursor !== undefined) {
    normalized.cursor = raw.pagination.cursor;
  }

  return normalized;
}

function cursorClause(resource: AnyResource, input: { cursor?: unknown; orderBy?: readonly { direction?: "asc" | "desc" }[] }): SQL | undefined {
  if (resource.options.pagination?.mode !== "cursor" || input.cursor === undefined) {
    return undefined;
  }

  const columnName = String(resource.options.pagination.cursorColumn);
  const column = getColumns(resource.table)[columnName];
  if (!column) {
    throw new ConfigurationError(`Unknown cursor column "${columnName}".`);
  }

  const direction = input.orderBy?.[0]?.direction ?? "asc";
  return direction === "desc" ? lt(column as never, input.cursor) : gt(column as never, input.cursor);
}

function defaultCursorOrder(resource: AnyResource, input: NormalizedListInput): NormalizedListInput["orderBy"] {
  if (input.orderBy || resource.options.pagination?.mode !== "cursor") {
    return input.orderBy;
  }
  return [{ field: String(resource.options.pagination.cursorColumn), direction: "asc" }];
}

export async function executeList<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes, runtimeArgs) => {
    const input = normalizeListInput(runtimeArgs.resource, runtimeArgs.input);
    const limit = input.limit ?? paginationLimits(runtimeArgs.resource).defaultLimit;
    const offset = input.offset ?? 0;
    const cursor = cursorClause(runtimeArgs.resource, input);
    const where = combineWhere(buildWhere(runtimeArgs.resource, input.where, scopes), cursor);
    const orderBy = buildOrderBy(runtimeArgs.resource, defaultCursorOrder(runtimeArgs.resource, input));

    let query = runtimeArgs.db.select(getColumns(runtimeArgs.resource.table)).from(runtimeArgs.resource.table);
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
        await authorizeAfter({ ...runtimeArgs, row });
        visibleRows.push(maskRow(runtimeArgs.resource, row));
      } catch {
        // Row-level list policies hide unauthorized rows instead of failing the whole collection.
      }
    }

    const cursorColumn =
      runtimeArgs.resource.options.pagination?.mode === "cursor"
        ? String(runtimeArgs.resource.options.pagination.cursorColumn)
        : undefined;
    const lastRow = rows.slice(0, limit).at(-1);
    const nextCursor = rows.length > limit && cursorColumn && lastRow ? lastRow[cursorColumn] : undefined;

    return {
      items: visibleRows,
      meta: {
        limit,
        offset,
        hasMore: rows.length > limit,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      },
    };
  });
}

export async function executeGet<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes, runtimeArgs) => {
    const where = combineWhere(primaryKeyWhere(runtimeArgs.resource, runtimeArgs.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build get condition.");
    }

    const row = await selectOne(runtimeArgs, where);
    if (!row) {
      throw new NotFoundError(`${runtimeArgs.resourceName} was not found.`);
    }

    await authorizeAfter({ ...runtimeArgs, row });
    return maskRow(runtimeArgs.resource, row);
  });
}

export async function executeCreate<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (_scopes, runtimeArgs) => {
    const data = pickWritableDataWithInjectedFields(
      runtimeArgs.resource,
      (args.input ?? {}) as Record<string, unknown>,
      runtimeArgs.input as Record<string, unknown>,
    );
    const query = runtimeArgs.db.insert(runtimeArgs.resource.table).values(data);
    const rows = await executeReturningOrThrow(
      query,
      getColumns(runtimeArgs.resource.table),
      `Database driver for ${runtimeArgs.resourceName}.create does not support returning(). Provide a custom create operation executor.`,
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundError(`${runtimeArgs.resourceName} create did not return a row.`);
    }

    await authorizeAfter({ ...runtimeArgs, row });
    return maskRow(runtimeArgs.resource, row);
  });
}

export async function executeCreateMany<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (_scopes, runtimeArgs) => {
    const originalInput = args.input as { data: readonly Record<string, unknown>[] };
    const input = runtimeArgs.input as { data: readonly Record<string, unknown>[] };
    const data = input.data.map((row, index) =>
      pickWritableDataWithInjectedFields(runtimeArgs.resource, originalInput.data[index] ?? {}, row),
    );
    const query = runtimeArgs.db.insert(runtimeArgs.resource.table).values(data);
    const rows = await executeReturningOrThrow(
      query,
      getColumns(runtimeArgs.resource.table),
      `Database driver for ${runtimeArgs.resourceName}.createMany does not support returning(). Provide a custom createMany operation executor.`,
    );

    const items: Record<string, unknown>[] = [];
    for (const row of rows) {
      await authorizeAfter({ ...runtimeArgs, row });
      items.push(maskRow(runtimeArgs.resource, row));
    }

    return {
      items,
      meta: {
        count: items.length,
      },
    };
  });
}

export async function executeUpdate<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes, runtimeArgs) => {
    const input = runtimeArgs.input as { data: Record<string, unknown> };
    const where = combineWhere(primaryKeyWhere(runtimeArgs.resource, runtimeArgs.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build update condition.");
    }

    const current = await selectOne(runtimeArgs, where);
    if (!current) {
      throw new NotFoundError(`${runtimeArgs.resourceName} was not found.`);
    }
    await authorizeAfter({ ...runtimeArgs, row: current });

    const originalInput = args.input as { data?: Record<string, unknown> };
    const data = pickWritableDataWithInjectedFields(runtimeArgs.resource, originalInput.data ?? {}, input.data);
    const query = runtimeArgs.db.update(runtimeArgs.resource.table).set(data).where(where);
    const rows = await executeReturningOrThrow(
      query,
      getColumns(runtimeArgs.resource.table),
      `Database driver for ${runtimeArgs.resourceName}.update does not support returning(). Provide a custom update operation executor.`,
    );
    const row = rows[0] ?? (await selectOne(runtimeArgs, where));
    if (!row) {
      throw new NotFoundError(`${runtimeArgs.resourceName} update did not return a row.`);
    }

    return maskRow(runtimeArgs.resource, row);
  });
}

export async function executeDelete<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes, runtimeArgs) => {
    const where = combineWhere(primaryKeyWhere(runtimeArgs.resource, runtimeArgs.input), ...scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build delete condition.");
    }

    const current = await selectOne(runtimeArgs, where);
    if (!current) {
      throw new NotFoundError(`${runtimeArgs.resourceName} was not found.`);
    }
    await authorizeAfter({ ...runtimeArgs, row: current });

    const query = runtimeArgs.db.delete(runtimeArgs.resource.table).where(where);
    if (returningCapable(query)) {
      await query.returning(getColumns(runtimeArgs.resource.table));
    } else {
      await query;
    }

    return maskRow(runtimeArgs.resource, current);
  });
}

export async function executeDeleteMany<TContext extends object>(args: CrudArgs<TContext>) {
  return withPipeline(args, async (scopes, runtimeArgs) => {
    const input = runtimeArgs.input as { where?: Record<string, unknown>; filters?: Record<string, unknown> };
    const filters = input.where ?? input.filters;
    if (!filters || Object.keys(filters).length === 0) {
      throw new ValidationError("deleteMany requires at least one filter.");
    }

    const where = buildWhere(runtimeArgs.resource, filters, scopes);
    if (!where) {
      throw new ConfigurationError("Unable to build deleteMany condition.");
    }

    const currentRows = await selectMany(runtimeArgs, where);
    const query = runtimeArgs.db.delete(runtimeArgs.resource.table).where(where);
    const deletedRows = returningCapable(query)
      ? ((await query.returning(getColumns(runtimeArgs.resource.table))) as Record<string, unknown>[])
      : undefined;
    if (!deletedRows) {
      await query;
    }

    const rows = deletedRows && deletedRows.length > 0 ? deletedRows : currentRows;
    const items: Record<string, unknown>[] = [];
    for (const row of rows) {
      await authorizeAfter({ ...runtimeArgs, row });
      items.push(maskRow(runtimeArgs.resource, row));
    }

    return {
      items,
      meta: {
        count: items.length,
      },
    };
  });
}
