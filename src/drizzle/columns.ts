import { and, eq, getTableColumns, getTableName, type AnyColumn, type Table as AnyTable, type SQL } from "drizzle-orm";

import { ConfigurationError } from "../core/errors.js";
import type { AnyResource } from "../core/resource.js";

export type ColumnMap = Record<string, AnyColumn>;

export function getColumns(table: AnyTable): ColumnMap {
  return getTableColumns(table) as ColumnMap;
}

export function tableName(table: AnyTable): string {
  return getTableName(table);
}

export function normalizePrimaryKey(resource: AnyResource): string[] {
  const configured = resource.options.primaryKey;
  const columns = getColumns(resource.table);

  const keys = configured ? (Array.isArray(configured) ? [...configured] : [configured]) : ["id"];

  for (const key of keys) {
    if (!columns[String(key)]) {
      throw new ConfigurationError(
        `Primary key column "${String(key)}" does not exist on resource "${resource.options.name ?? tableName(resource.table)}".`,
      );
    }
  }

  if (keys.length === 0) {
    throw new ConfigurationError(`Resource "${resource.options.name ?? tableName(resource.table)}" needs a primary key.`);
  }

  return keys.map(String);
}

export function primaryKeyWhere(resource: AnyResource, input: unknown): SQL {
  const columns = getColumns(resource.table);
  const primaryKeys = normalizePrimaryKey(resource);
  const value = input as { id?: unknown; where?: Record<string, unknown> };
  const clauses = primaryKeys.map((key) => {
    const column = columns[key];
    const keyValue = primaryKeys.length === 1 ? value.id : value.where?.[key];

    if (!column) {
      throw new ConfigurationError(`Unknown primary key column "${key}".`);
    }

    if (keyValue === undefined) {
      throw new ConfigurationError(`Missing primary key value for "${key}".`);
    }

    return eq(column, keyValue);
  });

  const condition = clauses.length === 1 ? clauses[0] : and(...clauses);
  if (!condition) {
    throw new ConfigurationError("Unable to build primary key condition.");
  }
  return condition;
}

export function resolveColumnNames(resource: AnyResource): string[] {
  return Object.keys(getColumns(resource.table));
}

function selectedColumnNames(resource: AnyResource): string[] {
  const columns = resolveColumnNames(resource);
  const selected = resource.options.fields?.select?.map(String);
  return selected ? selected.filter((name) => columns.includes(name)) : columns;
}

export function visibleColumnNames(resource: AnyResource): string[] {
  const hidden = new Set((resource.options.fields?.hidden ?? []).map(String));
  return selectedColumnNames(resource).filter((name) => {
    const columnPolicy = resource.options.columnPolicies?.[name];
    return !hidden.has(name) && columnPolicy?.readable !== false;
  });
}

export function writableColumnNames(resource: AnyResource): string[] {
  const columns = resolveColumnNames(resource);
  const explicit = resource.options.fields?.writable?.map(String);
  const isWritableByPolicy = (name: string) => {
    const columnPolicy = resource.options.columnPolicies?.[name];
    return columnPolicy?.readable !== false && columnPolicy?.writable !== false;
  };

  if (explicit) {
    return explicit.filter((name) => columns.includes(name) && isWritableByPolicy(name));
  }

  const hidden = new Set((resource.options.fields?.hidden ?? []).map(String));
  const readonly = new Set((resource.options.fields?.readonly ?? []).map(String));
  return columns.filter((name) => !hidden.has(name) && !readonly.has(name) && isWritableByPolicy(name));
}

export function visibleSelection(resource: AnyResource): ColumnMap {
  const columns = getColumns(resource.table);
  const visible = new Set(visibleColumnNames(resource));
  return Object.fromEntries(Object.entries(columns).filter(([name]) => visible.has(name)));
}

export function pickWritableData(resource: AnyResource, data: Record<string, unknown>): Record<string, unknown> {
  const writable = new Set(writableColumnNames(resource));
  return Object.fromEntries(Object.entries(data).filter(([name]) => writable.has(name)));
}

export function pickWritableDataWithInjectedFields(
  resource: AnyResource,
  originalData: Record<string, unknown>,
  runtimeData: Record<string, unknown>,
): Record<string, unknown> {
  const columns = new Set(resolveColumnNames(resource));
  const originalKeys = new Set(Object.keys(originalData));
  const data = pickWritableData(resource, runtimeData);

  for (const [name, value] of Object.entries(runtimeData)) {
    if (!originalKeys.has(name) && columns.has(name)) {
      data[name] = value;
    }
  }

  return data;
}

export function maskRow(resource: AnyResource, row: Record<string, unknown>): Record<string, unknown> {
  const visible = new Set(visibleColumnNames(resource));
  const output: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(row)) {
    if (!visible.has(name)) {
      continue;
    }

    const transform = resource.options.transforms?.[name] as
      | ((value: unknown, row: Record<string, unknown>) => unknown)
      | undefined;
    output[name] = transform ? transform(value, row) : value;
  }

  return output;
}
