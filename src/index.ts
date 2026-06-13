export {
  createShield,
  createDbRouter,
  createContextContract,
  type CreateShieldResult,
  type DbRouterConfig,
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
  type DeleteInput,
  type FilterInput,
  type GetInput,
  type InferResourceInput,
  type InferResourceOutput,
  type ListInput,
  type ListOutput,
  type OperationName,
  type PrimaryKeyInput,
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
  createZodValidationAdapter,
  type ValidationAdapter,
} from "./validation/zod.js";
