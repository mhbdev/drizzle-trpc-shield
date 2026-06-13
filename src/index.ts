export {
  createShield,
  createDbRouter,
  createShieldRouter,
  createContextContract,
  type CreateShieldResult,
  type DbRouterConfig,
  type CreateShieldRouterConfig,
  type ShieldConfig,
} from "./core/create-shield.js";
export {
  defineTable,
  resource,
  type AnyResource,
  type ResourceDefinition,
  type ResourceOptions,
} from "./core/resource.js";
export {
  defineResource,
  type ResourceBuilder,
} from "./core/resource-builder.js";
export {
  and,
  contextGuard,
  hasPermission,
  hasRole,
  injectField,
  not,
  readOnly,
  scopeToTenant,
  or,
  type Guard,
} from "./guards/guards.js";
export {
  ShieldError,
  AuthorizationError,
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  toTRPCError,
} from "./core/errors.js";
export {
  allow,
  deny,
  policy,
  type AuthorizationTiming,
  type PolicyDecision,
  type PolicyRule,
  type ResourcePolicy,
} from "./policy/policy.js";
export {
  type CreateInput,
  type CreateManyInput,
  type ColumnPolicy,
  type ColumnPolicyConfig,
  type DeleteInput,
  type DeleteManyInput,
  type FilterInput,
  type GetInput,
  type InferResourceInput,
  type InferResourceOutput,
  type ListInput,
  type ListOutput,
  type BulkOutput,
  type OperatorFilter,
  type OperationName,
  type PaginationConfig,
  type ProcedureName,
  type PrimaryKeyInput,
  type OrderByInput,
  type ScalarFilter,
  type ApiContext,
  type ResourceRouterContract,
  type ShieldRouterContract,
  type TableInsert,
  type TableSelect,
  type UpdateInput,
  type VisibleSelect,
  type WritableInsert,
} from "./core/types.js";
export {
  createSoftDeletePlugin,
  type ShieldPlugin,
  type ShieldPluginHookArgs,
  type ShieldOperationHooks,
  type OperationHookArgs,
} from "./plugins/plugin.js";
export {
  createLoggingHooks,
  parseJSON,
  redact,
  toISOString,
  trimString,
  type LoggingEntry,
} from "./utils/transforms.js";
export {
  createZodValidationAdapter,
  type ValidationAdapter,
} from "./validation/zod.js";
