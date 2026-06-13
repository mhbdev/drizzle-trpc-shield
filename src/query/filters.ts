import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";

import { ConfigurationError } from "../core/errors.js";
import type { AnyResource } from "../core/resource.js";
import { getColumns } from "../drizzle/columns.js";

const OPERATOR_KEYS = new Set([
  "eq",
  "ne",
  "neq",
  "in",
  "notIn",
  "isNull",
  "isNotNull",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "like",
  "ilike",
  "contains",
  "startsWith",
  "endsWith",
]);

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || value instanceof Date || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value).some((key) => OPERATOR_KEYS.has(key));
}

function isOpFilterObject(value: unknown): value is { op: string; value?: unknown; values?: readonly unknown[] } {
  return Boolean(value && typeof value === "object" && "op" in value);
}

function filterableColumns(resource: AnyResource): Set<string> {
  return new Set(
    (resource.options.query?.filterable ?? [])
      .map(String)
      .filter((name) => {
        const policy = resource.options.columnPolicies?.[name];
        return policy?.readable !== false && policy?.filterable !== false;
      }),
  );
}

function sortableColumns(resource: AnyResource): Set<string> {
  const columns = new Set(
    (resource.options.query?.sortable ?? [])
      .map(String)
      .filter((name) => {
        const policy = resource.options.columnPolicies?.[name];
        return policy?.readable !== false && policy?.sortable !== false;
      }),
  );
  if (resource.options.pagination?.mode === "cursor") {
    columns.add(String(resource.options.pagination.cursorColumn));
  }
  return columns;
}

function assertFilterable(resource: AnyResource, field: string): void {
  const filterable = filterableColumns(resource);
  if (!filterable.has(field)) {
    throw new ConfigurationError(`Column "${field}" is not filterable. Add it to query.filterable first.`);
  }
}

function assertSortable(resource: AnyResource, field: string): void {
  const sortable = sortableColumns(resource);
  if (!sortable.has(field)) {
    throw new ConfigurationError(`Column "${field}" is not sortable. Add it to query.sortable first.`);
  }
}

function eqOrNull(column: unknown, value: unknown): SQL {
  return value === null ? isNull(column as never) : eq(column as never, value);
}

function neOrNull(column: unknown, value: unknown): SQL {
  return value === null ? isNotNull(column as never) : ne(column as never, value);
}

function buildOperatorClauses(column: unknown, operators: Record<string, unknown>): SQL[] {
  const clauses: SQL[] = [];

  if ("eq" in operators) {
    clauses.push(eqOrNull(column, operators["eq"]));
  }
  if ("ne" in operators) {
    clauses.push(neOrNull(column, operators["ne"]));
  }
  if ("neq" in operators) {
    clauses.push(neOrNull(column, operators["neq"]));
  }
  if (Array.isArray(operators["in"])) {
    clauses.push(inArray(column as never, [...(operators["in"] as readonly unknown[])]));
  }
  if (Array.isArray(operators["notIn"])) {
    clauses.push(notInArray(column as never, [...(operators["notIn"] as readonly unknown[])]));
  }
  if (operators["isNull"] === true) {
    clauses.push(isNull(column as never));
  }
  if (operators["isNull"] === false) {
    clauses.push(isNotNull(column as never));
  }
  if (operators["isNotNull"] === true) {
    clauses.push(isNotNull(column as never));
  }
  if (operators["isNotNull"] === false) {
    clauses.push(isNull(column as never));
  }
  if ("gt" in operators) {
    clauses.push(gt(column as never, operators["gt"]));
  }
  if ("gte" in operators) {
    clauses.push(gte(column as never, operators["gte"]));
  }
  if ("lt" in operators) {
    clauses.push(lt(column as never, operators["lt"]));
  }
  if ("lte" in operators) {
    clauses.push(lte(column as never, operators["lte"]));
  }
  const between = operators["between"];
  if (Array.isArray(between) && between.length === 2) {
    const [from, to] = between;
    clauses.push(gte(column as never, from), lte(column as never, to));
  }
  if (typeof operators["like"] === "string") {
    clauses.push(like(column as never, operators["like"]));
  }
  if (typeof operators["ilike"] === "string") {
    clauses.push(sql`lower(${column}) like lower(${operators["ilike"]})`);
  }
  if (typeof operators["contains"] === "string") {
    clauses.push(like(column as never, `%${operators["contains"]}%`));
  }
  if (typeof operators["startsWith"] === "string") {
    clauses.push(like(column as never, `${operators["startsWith"]}%`));
  }
  if (typeof operators["endsWith"] === "string") {
    clauses.push(like(column as never, `%${operators["endsWith"]}`));
  }

  return clauses;
}

function normalizeOpFilter(value: { op: string; value?: unknown; values?: readonly unknown[] }): Record<string, unknown> {
  switch (value.op) {
    case "eq":
    case "ne":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike":
    case "contains":
    case "startsWith":
    case "endsWith":
      return { [value.op]: value.value };
    case "in":
    case "notIn":
    case "between":
      return { [value.op]: value.values };
    case "isNull":
    case "isNotNull":
      return { [value.op]: true };
    default:
      throw new ConfigurationError(`Unsupported filter operator "${value.op}".`);
  }
}

export function buildWhere(resource: AnyResource, where: Record<string, unknown> | undefined, scopes: readonly SQL[] = []): SQL | undefined {
  const columns = getColumns(resource.table);
  const clauses: SQL[] = [...scopes];

  for (const [field, value] of Object.entries(where ?? {})) {
    assertFilterable(resource, field);
    const column = columns[field];

    if (!column) {
      throw new ConfigurationError(`Unknown filter column "${field}".`);
    }

    if (isOpFilterObject(value)) {
      clauses.push(...buildOperatorClauses(column, normalizeOpFilter(value)));
    } else if (isOperatorObject(value)) {
      clauses.push(...buildOperatorClauses(column, value));
    } else {
      clauses.push(eqOrNull(column, value));
    }
  }

  if (clauses.length === 0) {
    return undefined;
  }

  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export function buildOrderBy(resource: AnyResource, orderBy: readonly { field: string; direction?: "asc" | "desc" }[] | undefined): SQL[] {
  const columns = getColumns(resource.table);

  return (orderBy ?? []).map((item) => {
    assertSortable(resource, item.field);
    const column = columns[item.field];

    if (!column) {
      throw new ConfigurationError(`Unknown sortable column "${item.field}".`);
    }

    return item.direction === "desc" ? desc(column) : asc(column);
  });
}
