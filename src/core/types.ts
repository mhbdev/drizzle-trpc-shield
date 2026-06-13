import type { Table as AnyTable, InferInsertModel, InferSelectModel, SQL } from "drizzle-orm";
import type { ZodType, ZodTypeAny } from "zod";

import type { PolicyRule, ResourcePolicy } from "../policy/policy.js";
import type { ShieldPlugin } from "../plugins/plugin.js";

export type MaybePromise<T> = T | Promise<T>;
export type StringKeyOf<T> = Extract<keyof T, string>;
export type OperationName = "list" | "get" | "create" | "update" | "delete";
export type ApiContext<T extends object = Record<string, never>> = T;

export type TableSelect<TTable extends AnyTable> = InferSelectModel<TTable>;
export type TableInsert<TTable extends AnyTable> = InferInsertModel<TTable>;

export type ArrayValue<T> = T extends readonly (infer TValue)[] ? TValue : never;

export type FieldConfig<TTable extends AnyTable> = {
  hidden?: readonly StringKeyOf<TableSelect<TTable>>[];
  readonly?: readonly StringKeyOf<TableInsert<TTable>>[];
  writable?: readonly StringKeyOf<TableInsert<TTable>>[];
};

export type QueryConfig<TTable extends AnyTable> = {
  filterable?: readonly StringKeyOf<TableSelect<TTable>>[];
  sortable?: readonly StringKeyOf<TableSelect<TTable>>[];
  maxLimit?: number;
  defaultLimit?: number;
};

export type PrimaryKeyConfig<TTable extends AnyTable> =
  | StringKeyOf<TableSelect<TTable>>
  | readonly StringKeyOf<TableSelect<TTable>>[];

export type OperationConfig<TContext, TTable extends AnyTable, TInput = unknown, TOutput = unknown> = {
  enabled?: boolean;
  input?: ZodTypeAny;
  policy?: PolicyRule<TContext, TTable, TInput> | readonly PolicyRule<TContext, TTable, TInput>[];
  execute?: OperationExecutor<TContext, TTable, TInput, TOutput>;
  meta?: Record<string, unknown>;
};

export type OperationExecutor<TContext, TTable extends AnyTable, TInput, TOutput> = (
  args: OperationExecutorArgs<TContext, TTable, TInput>,
) => MaybePromise<TOutput>;

export type OperationExecutorArgs<TContext, TTable extends AnyTable, TInput> = {
  ctx: TContext;
  db: unknown;
  table: TTable;
  input: TInput;
  operation: OperationName;
  resourceName: string;
  scopes: SQL[];
};

export type OperationSwitch<TContext, TTable extends AnyTable> = Partial<
  Record<OperationName, boolean | OperationConfig<TContext, TTable, any, any>>
>;

export type ValidationConfig = Partial<Record<OperationName, ZodTypeAny>>;

export type ResourceRuntimeOptions<TContext, TTable extends AnyTable> = {
  name?: string;
  primaryKey?: PrimaryKeyConfig<TTable>;
  operations?: OperationSwitch<TContext, TTable>;
  policy?: ResourcePolicy<TContext, TTable>;
  fields?: FieldConfig<TTable>;
  query?: QueryConfig<TTable>;
  validation?: ValidationConfig;
  plugins?: readonly ShieldPlugin<TContext>[];
  meta?: Record<string, unknown>;
};

type EmptyObject = Record<string, never>;

type ConfigFields<TConfig> = TConfig extends { fields?: infer TFields } ? NonNullable<TFields> : EmptyObject;
type HiddenKeys<TConfig> = ConfigFields<TConfig> extends { hidden?: infer TKeys }
  ? Extract<ArrayValue<NonNullable<TKeys>>, string>
  : never;
type ReadonlyKeys<TConfig> = ConfigFields<TConfig> extends { readonly?: infer TKeys }
  ? Extract<ArrayValue<NonNullable<TKeys>>, string>
  : never;
type WritableKeysFromConfig<TConfig> = ConfigFields<TConfig> extends { writable?: infer TKeys }
  ? Extract<ArrayValue<NonNullable<TKeys>>, string>
  : never;

export type VisibleSelect<TTable extends AnyTable, TConfig> = Omit<
  TableSelect<TTable>,
  Extract<HiddenKeys<TConfig>, keyof TableSelect<TTable>>
>;

type DefaultWritableKeys<TTable extends AnyTable, TConfig> = Exclude<
  StringKeyOf<TableInsert<TTable>>,
  Extract<HiddenKeys<TConfig> | ReadonlyKeys<TConfig>, StringKeyOf<TableInsert<TTable>>>
>;

export type WritableKeys<TTable extends AnyTable, TConfig> = [WritableKeysFromConfig<TConfig>] extends [never]
  ? DefaultWritableKeys<TTable, TConfig>
  : Extract<WritableKeysFromConfig<TConfig>, StringKeyOf<TableInsert<TTable>>>;

export type WritableInsert<TTable extends AnyTable, TConfig> = Pick<TableInsert<TTable>, WritableKeys<TTable, TConfig>>;
export type CreateInput<TTable extends AnyTable, TConfig> = WritableInsert<TTable, TConfig>;

type ConfigPrimaryKey<TConfig> = TConfig extends { primaryKey?: infer TKey } ? NonNullable<TKey> : never;
type PrimaryKeyTuple<TTable extends AnyTable, TConfig> = [ConfigPrimaryKey<TConfig>] extends [never]
  ? "id" extends StringKeyOf<TableSelect<TTable>>
    ? readonly ["id"]
    : readonly []
  : ConfigPrimaryKey<TConfig> extends readonly string[]
    ? ConfigPrimaryKey<TConfig>
    : ConfigPrimaryKey<TConfig> extends string
      ? readonly [ConfigPrimaryKey<TConfig>]
      : readonly [];

export type PrimaryKeyNames<TTable extends AnyTable, TConfig> = Extract<
  ArrayValue<PrimaryKeyTuple<TTable, TConfig>>,
  StringKeyOf<TableSelect<TTable>>
>;

export type PrimaryKeyInput<TTable extends AnyTable, TConfig> = PrimaryKeyTuple<TTable, TConfig> extends readonly [
  infer TOnly extends string,
]
  ? TOnly extends StringKeyOf<TableSelect<TTable>>
    ? { id: TableSelect<TTable>[TOnly] }
    : never
  : { where: Pick<TableSelect<TTable>, PrimaryKeyNames<TTable, TConfig>> };

export type GetInput<TTable extends AnyTable, TConfig> = PrimaryKeyInput<TTable, TConfig>;
export type DeleteInput<TTable extends AnyTable, TConfig> = PrimaryKeyInput<TTable, TConfig>;
export type UpdateInput<TTable extends AnyTable, TConfig> = PrimaryKeyInput<TTable, TConfig> & {
  data: Partial<WritableInsert<TTable, TConfig>>;
};

type QueryOptions<TConfig> = TConfig extends { query?: infer TQuery } ? NonNullable<TQuery> : EmptyObject;
export type FilterableKeys<TTable extends AnyTable, TConfig> = QueryOptions<TConfig> extends {
  filterable?: infer TKeys;
}
  ? Extract<ArrayValue<NonNullable<TKeys>>, StringKeyOf<TableSelect<TTable>>>
  : never;
export type SortableKeys<TTable extends AnyTable, TConfig> = QueryOptions<TConfig> extends { sortable?: infer TKeys }
  ? Extract<ArrayValue<NonNullable<TKeys>>, StringKeyOf<TableSelect<TTable>>>
  : never;

export type ScalarFilter<TValue> = {
  eq?: TValue;
  ne?: TValue;
  in?: readonly TValue[];
  notIn?: readonly TValue[];
  isNull?: boolean;
} & (NonNullable<TValue> extends number | bigint | Date
  ? {
      gt?: TValue;
      gte?: TValue;
      lt?: TValue;
      lte?: TValue;
    }
  : EmptyObject) &
  (NonNullable<TValue> extends string
    ? {
        like?: string;
        ilike?: string;
        contains?: string;
        startsWith?: string;
        endsWith?: string;
      }
    : EmptyObject);

export type FilterInput<TTable extends AnyTable, TConfig> = Partial<{
  [TKey in FilterableKeys<TTable, TConfig>]:
    | TableSelect<TTable>[TKey]
    | ScalarFilter<NonNullable<TableSelect<TTable>[TKey]>>;
}>;

export type OrderByInput<TTable extends AnyTable, TConfig> = {
  field: SortableKeys<TTable, TConfig>;
  direction?: "asc" | "desc";
};

export type ListInput<TTable extends AnyTable, TConfig> = {
  where?: FilterInput<TTable, TConfig>;
  orderBy?: readonly OrderByInput<TTable, TConfig>[];
  limit?: number;
  offset?: number;
};

export type ListOutput<TTable extends AnyTable, TConfig> = {
  items: VisibleSelect<TTable, TConfig>[];
  meta: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
};

export type InferResourceInput<TResource, TOperation extends OperationName> = TResource extends {
  table: infer TTable extends AnyTable;
  options: infer TOptions;
}
  ? TOperation extends "list"
    ? ListInput<TTable, TOptions>
    : TOperation extends "get"
      ? GetInput<TTable, TOptions>
      : TOperation extends "create"
        ? CreateInput<TTable, TOptions>
        : TOperation extends "update"
          ? UpdateInput<TTable, TOptions>
          : DeleteInput<TTable, TOptions>
  : never;

export type InferResourceOutput<TResource, TOperation extends OperationName> = TResource extends {
  table: infer TTable extends AnyTable;
  options: infer TOptions;
}
  ? TOperation extends "list"
    ? ListOutput<TTable, TOptions>
    : VisibleSelect<TTable, TOptions>
  : never;

type OperationValue<TResource, TOperation extends OperationName> = TResource extends { options: infer TOptions }
  ? TOptions extends { operations?: infer TOperations }
    ? TOperation extends keyof NonNullable<TOperations>
      ? NonNullable<TOperations>[TOperation]
      : false
    : false
  : false;

export type IsOperationEnabled<TValue> = TValue extends false | undefined
  ? false
  : TValue extends { enabled: false }
    ? false
    : true;

export type EnabledOperations<TResource> = {
  [TOperation in OperationName]: IsOperationEnabled<OperationValue<TResource, TOperation>> extends true
    ? TOperation
    : never;
}[OperationName];

export type ResourceRouterContract<TResource> = {
  [TOperation in EnabledOperations<TResource>]: {
    input: InferResourceInput<TResource, TOperation>;
    output: InferResourceOutput<TResource, TOperation>;
  };
};

export type ShieldRouterContract<TResources extends Record<string, unknown>> = {
  [TName in keyof TResources]: ResourceRouterContract<TResources[TName]>;
};

export type RuntimeOperationArgs<TContext, TTable extends AnyTable, TInput> = {
  ctx: TContext;
  db: unknown;
  table: TTable;
  input: TInput;
  operation: OperationName;
  resourceName: string;
  scopes: SQL[];
};

export type ZodInput<T> = ZodType<T>;
