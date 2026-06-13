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
  const operators: Record<string, ZodTypeAny> = {
    eq: scalar.optional(),
    ne: scalar.optional(),
    in: z.array(scalar).optional(),
    notIn: z.array(scalar).optional(),
    isNull: z.boolean().optional(),
  };

  const dataType = columnDataType(column);
  if (dataType === "number" || dataType === "bigint" || dataType === "date") {
    operators["gt"] = scalar.optional();
    operators["gte"] = scalar.optional();
    operators["lt"] = scalar.optional();
    operators["lte"] = scalar.optional();
  }

  if (dataType === "string" || !dataType) {
    operators["like"] = z.string().optional();
    operators["ilike"] = z.string().optional();
    operators["contains"] = z.string().optional();
    operators["startsWith"] = z.string().optional();
    operators["endsWith"] = z.string().optional();
  }

  return z.union([scalar, z.object(operators).strict()]);
}

function listSchema(resource: AnyResource): ZodObject<any> {
  const columns = getColumns(resource.table);
  const filterable = (resource.options.query?.filterable ?? []).map(String);
  const sortable = (resource.options.query?.sortable ?? []).map(String);
  const defaultLimit = resource.options.query?.defaultLimit ?? 25;
  const maxLimit = resource.options.query?.maxLimit ?? 100;
  const effectiveDefaultLimit = Math.min(defaultLimit, maxLimit);

  const whereShape = Object.fromEntries(
    filterable.map((name) => {
      const column = columns[name];
      if (!column) {
        throw new ConfigurationError(`Unknown filterable column "${name}".`);
      }
      return [name, filterValueSchema(column).optional()];
    }),
  );

  return z
    .object({
      where: z.object(whereShape).strict().optional(),
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
      limit: z.number().int().positive().max(maxLimit).default(effectiveDefaultLimit),
      offset: z.number().int().min(0).default(0),
    })
    .strict();
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
        case "update":
          return updateSchema(resource);
      }
    },
  };
}
