import type { AnyColumn } from "drizzle-orm";
import { z, type ZodObject, type ZodTypeAny } from "zod";

import { ConfigurationError } from "../core/errors.js";
import type { OperationName } from "../core/types.js";
import type { AnyResource } from "../core/resource.js";
import { getColumns, normalizePrimaryKey, writableColumnNames } from "../drizzle/columns.js";

export type ValidationAdapter = {
  inputFor(resource: AnyResource, operation: OperationName): ZodTypeAny;
};

function stringEnum(values: readonly string[]): ZodTypeAny {
  if (values.length === 0) {
    return z.never();
  }
  return z.enum(values as [string, ...string[]]);
}

function columnDataType(column: AnyColumn): string | undefined {
  return (column as unknown as { dataType?: string }).dataType;
}

function columnEnumValues(column: AnyColumn): readonly string[] | undefined {
  const values = (column as unknown as { enumValues?: readonly string[] }).enumValues;
  return values && values.length > 0 ? values : undefined;
}

function columnNotNull(column: AnyColumn): boolean {
  return Boolean((column as unknown as { notNull?: boolean }).notNull);
}

function columnHasDefault(column: AnyColumn): boolean {
  return Boolean((column as unknown as { hasDefault?: boolean }).hasDefault);
}

function paginationLimits(resource: AnyResource): { defaultLimit: number; maxLimit: number } {
  const pagination = resource.options.pagination;
  const defaultLimit = pagination?.defaultLimit ?? resource.options.query?.defaultLimit ?? 25;
  const maxLimit = pagination?.maxLimit ?? resource.options.query?.maxLimit ?? 100;
  return { defaultLimit: Math.min(defaultLimit, maxLimit), maxLimit };
}

function columnToZod(column: AnyColumn): ZodTypeAny {
  const enumValues = columnEnumValues(column);
  let schema: ZodTypeAny;

  if (enumValues) {
    schema = stringEnum(enumValues);
  } else {
    switch (columnDataType(column)) {
      case "number":
        schema = z.number();
        break;
      case "bigint":
        schema = z.bigint();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "date":
        schema = z.union([z.date(), z.string().datetime().transform((value) => new Date(value))]);
        break;
      case "json":
      case "array":
        schema = z.unknown();
        break;
      case "buffer":
        schema = z.instanceof(Uint8Array);
        break;
      case "string":
      default:
        schema = z.string();
        break;
    }
  }

  return columnNotNull(column) ? schema : schema.nullable();
}

function insertColumnToZod(column: AnyColumn): ZodTypeAny {
  const schema = columnToZod(column);
  return columnHasDefault(column) || !columnNotNull(column) ? schema.optional() : schema;
}

function primaryKeySchema(resource: AnyResource): ZodObject<any> {
  const columns = getColumns(resource.table);
  const primaryKeys = normalizePrimaryKey(resource);
  const shape = Object.fromEntries(
    primaryKeys.map((key) => {
      const column = columns[key];
      if (!column) {
        throw new ConfigurationError(`Unknown primary key column "${key}".`);
      }
      return [key, columnToZod(column)];
    }),
  );

  if (primaryKeys.length === 1) {
    const first = primaryKeys[0];
    const column = first ? columns[first] : undefined;
    if (!first || !column) {
      throw new ConfigurationError("Unable to build primary key schema.");
    }
    return z.object({ id: columnToZod(column) }).strict();
  }

  return z.object({ where: z.object(shape).strict() }).strict();
}

function filterSchema(resource: AnyResource, requireAtLeastOne = false): ZodTypeAny {
  const columns = getColumns(resource.table);
  const filterable = (resource.options.query?.filterable ?? [])
    .map(String)
    .filter((name) => {
      const policy = resource.options.columnPolicies?.[name];
      return policy?.readable !== false && policy?.filterable !== false;
    });
  const shape = Object.fromEntries(
    filterable.map((name) => {
      const column = columns[name];
      if (!column) {
        throw new ConfigurationError(`Unknown filterable column "${name}".`);
      }
      return [name, filterValueSchema(column).optional()];
    }),
  );

  const schema = z.object(shape).strict();
  if (requireAtLeastOne) {
    return schema.refine((value: Record<string, unknown>) => Object.keys(value).length > 0, "Delete many requires at least one filter.");
  }
  return schema;
}

function createSchema(resource: AnyResource): ZodObject<any> {
  const columns = getColumns(resource.table);
  const writable = writableColumnNames(resource);
  const shape = Object.fromEntries(
    writable.map((name) => {
      const column = columns[name];
      if (!column) {
        throw new ConfigurationError(`Unknown writable column "${name}".`);
      }
      return [name, insertColumnToZod(column)];
    }),
  );

  return z.object(shape).strict();
}

function updateSchema(resource: AnyResource): ZodObject<any> {
  const dataSchema = createSchema(resource)
    .partial()
    .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, "Update data must contain at least one writable field.");
  const base = primaryKeySchema(resource);

  if (base instanceof z.ZodObject) {
    return base.extend({ data: dataSchema });
  }

  const primaryKeys = normalizePrimaryKey(resource);
  const columns = getColumns(resource.table);
  const shape = Object.fromEntries(
    primaryKeys.map((key) => {
      const column = columns[key];
      if (!column) {
        throw new ConfigurationError(`Unknown primary key column "${key}".`);
      }
      return [key, columnToZod(column)];
    }),
  );

  return z.object({ where: z.object(shape).strict(), data: dataSchema }).strict();
}

function filterValueSchema(column: AnyColumn): ZodTypeAny {
  const scalar = columnToZod(column);
  const dataType = columnDataType(column);
  const operators: Record<string, ZodTypeAny> = {
    eq: scalar.optional(),
    ne: scalar.optional(),
    neq: scalar.optional(),
    in: z.array(scalar).optional(),
    notIn: z.array(scalar).optional(),
    isNull: z.boolean().optional(),
    isNotNull: z.boolean().optional(),
  };
  const valueOperators = ["eq", "ne", "neq"] as string[];

  if (dataType === "number" || dataType === "bigint" || dataType === "date") {
    operators["gt"] = scalar.optional();
    operators["gte"] = scalar.optional();
    operators["lt"] = scalar.optional();
    operators["lte"] = scalar.optional();
    operators["between"] = z.tuple([scalar, scalar]).optional();
    valueOperators.push("gt", "gte", "lt", "lte");
  }

  if (dataType === "string" || !dataType) {
    operators["like"] = z.string().optional();
    operators["ilike"] = z.string().optional();
    operators["contains"] = z.string().optional();
    operators["startsWith"] = z.string().optional();
    operators["endsWith"] = z.string().optional();
    valueOperators.push("like", "ilike", "contains", "startsWith", "endsWith");
  }

  const opSchemas = [
    scalar,
    z.object(operators).strict(),
    z
      .object({
        op: stringEnum(valueOperators),
        value: scalar,
      })
      .strict(),
    z
      .object({
        op: z.enum(["in", "notIn"]),
        values: z.array(scalar),
      })
      .strict(),
    z
      .object({
        op: z.enum(["isNull", "isNotNull"]),
      })
      .strict(),
  ] as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]];

  if (dataType === "number" || dataType === "bigint" || dataType === "date") {
    opSchemas.push(
      z
        .object({
          op: z.literal("between"),
          values: z.tuple([scalar, scalar]),
        })
        .strict(),
    );
  }

  return z.union(opSchemas);
}

function listSchema(resource: AnyResource): ZodObject<any> {
  const columns = getColumns(resource.table);
  const sortable = (resource.options.query?.sortable ?? [])
    .map(String)
    .filter((name) => {
      const policy = resource.options.columnPolicies?.[name];
      return policy?.readable !== false && policy?.sortable !== false;
    });
  const { defaultLimit, maxLimit } = paginationLimits(resource);
  const cursorColumn = resource.options.pagination?.mode === "cursor" ? resource.options.pagination.cursorColumn : undefined;
  if (cursorColumn && !sortable.includes(String(cursorColumn))) {
    sortable.push(String(cursorColumn));
  }

  return z
    .object({
      where: filterSchema(resource).optional(),
      filters: filterSchema(resource).optional(),
      orderBy: z
        .array(
          z
            .object({
              field: stringEnum(sortable),
              direction: z.enum(["asc", "desc"]).default("asc"),
            })
            .strict(),
        )
        .optional(),
      sort: z
        .array(
          z
            .object({
              column: stringEnum(sortable),
              direction: z.enum(["asc", "desc"]).default("asc"),
            })
            .strict(),
        )
        .optional(),
      limit: z.number().int().positive().max(maxLimit).default(defaultLimit),
      offset: z.number().int().min(0).default(0),
      pagination: z
        .object({
          page: z.number().int().min(1).optional(),
          limit: z.number().int().positive().max(maxLimit).optional(),
          cursor:
            cursorColumn && columns[cursorColumn]
              ? columnToZod(columns[cursorColumn]).optional()
              : z.unknown().optional(),
        })
        .strict()
        .optional(),
    })
    .strict();
}

function createManySchema(resource: AnyResource): ZodObject<any> {
  const itemSchema = createSchema(resource);
  return z.object({ data: z.array(itemSchema).min(1).max(500) }).strict();
}

function deleteManySchema(resource: AnyResource): ZodTypeAny {
  const filters = filterSchema(resource, true);
  return z
    .object({
      where: filters.optional(),
      filters: filters.optional(),
    })
    .strict()
    .refine((value) => value.where !== undefined || value.filters !== undefined, "Delete many requires filters.");
}

export function createZodValidationAdapter(): ValidationAdapter {
  return {
    inputFor(resource, operation) {
      const explicit = resource.options.validation?.[operation];
      if (explicit) {
        return explicit;
      }

      switch (operation) {
        case "list":
          return listSchema(resource);
        case "get":
        case "delete":
          return primaryKeySchema(resource);
        case "create":
          return createSchema(resource);
        case "createMany":
          return createManySchema(resource);
        case "deleteMany":
          return deleteManySchema(resource);
        case "update":
          return updateSchema(resource);
      }
    },
  };
}
