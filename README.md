# drizzle-trpc-shield

A plug-in layer that turns Drizzle ORM tables into secure, ready-to-use tRPC APIs automatically.

`drizzle-trpc-shield` is built for teams that want generated CRUD without giving up explicit authorization, field-level security, lifecycle hooks, plugin extension points, or TypeScript inference.

## What it gives you

- `defineTable` to wrap a Drizzle table with resource-level API config
- `defineResource` for a fluent, developer-friendly resource builder
- `createShieldRouter` for a plug-and-play router from raw tables or resource definitions
- `createDbRouter` for the direct table-map API
- `createShield` when you want the full shield object, router map, resource map, and contract
- `ApiContext` for typed request context flowing through policies, guards, hooks, and plugins
- `allow`, `deny`, `policy`, and guard helpers for row-level access control
- field visibility controls with `hidden`, `readonly`, `writable`, `select`, and `columnPolicies`
- safe query controls for filterable columns, sortable columns, limits, offsets, and cursor pagination
- generated procedures: `list`, `findMany`, `get`, `findById`, `create`, `createMany`, `update`, `delete`, and `deleteMany`
- lifecycle hooks and plugins for auditing, transforms, tenant injection, custom behavior, and side effects
- strict fail-closed defaults: enabled operations must have a global, resource, or operation policy

## Install

```bash
pnpm add drizzle-trpc-shield @trpc/server drizzle-orm zod
```

The package is ESM-first, ships CommonJS output, and expects Node.js 20 or newer.

## Quick Start

```ts
import { initTRPC } from "@trpc/server";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  allow,
  createDbRouter,
  defineTable,
  policy,
  type ApiContext,
} from "drizzle-trpc-shield";

type Context = ApiContext<{
  user?: {
    id: number;
    role?: "admin" | "member";
  };
}>;

const t = initTRPC.context<Context>().create();

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
});

export const appRouter = createDbRouter({
  db,
  trpc: t,
  tables: {
    users: defineTable(users, {
      policy: policy<Context>()({
        all: allow.authenticated(),
      }),
      fields: {
        hidden: ["passwordHash"],
        readonly: ["id"],
      },
      query: {
        filterable: ["email", "name"],
        sortable: ["id", "name"],
        defaultLimit: 20,
        maxLimit: 100,
      },
      operations: {
        list: true,
        get: true,
        create: true,
        createMany: true,
        update: true,
        delete: true,
        deleteMany: true,
      },
    }),
  },
});

export type AppRouter = typeof appRouter;
```

```ts
const caller = t.createCallerFactory(appRouter)({
  user: { id: 1, role: "admin" },
});

const page = await caller.users.findMany({
  filters: {
    email: { op: "contains", value: "@acme.com" },
  },
  sort: [{ column: "id", direction: "desc" }],
  pagination: { page: 1, limit: 20 },
});
```

## Plug-And-Play Router

If you already have a table map and want the shortest route to an API, use `createShieldRouter`. Raw resources are normalized into `defineTable(...)` resources for you.

```ts
import { createShieldRouter, contextGuard } from "drizzle-trpc-shield";

const isSignedIn = contextGuard<Context>((ctx) => Boolean(ctx.user));

export const appRouter = createShieldRouter({
  db,
  t,
  config: {
    globalGuards: [isSignedIn],
    resources: {
      users: {
        table: users,
        fields: {
          hidden: ["passwordHash"],
          readonly: ["id"],
        },
        query: {
          filterable: ["email", "name"],
          sortable: ["id"],
        },
      },
    },
  },
});
```

`createShieldRouter` is useful when integrating into existing apps or migrating from a hand-written router. It still keeps the same security model: if no global, resource, or operation policy exists, router creation fails unless you explicitly opt out with `security.requirePolicies: false`.

## Generated Procedures

| Procedure | Kind | Input shape | Notes |
| --- | --- | --- | --- |
| `list` | query | `{ where?, orderBy?, limit?, offset? }` | canonical list procedure |
| `findMany` | query | `{ filters?, sort?, pagination? }` | ergonomic alias for `list` |
| `get` | query | primary key input | canonical single-row procedure |
| `findById` | query | primary key input | ergonomic alias for `get` |
| `create` | mutation | writable insert data | strips hidden, readonly, and non-writable fields |
| `createMany` | mutation | `{ data: [...] }` | bulk create with the same write protection |
| `update` | mutation | primary key plus writable data | protects readonly and non-writable fields |
| `delete` | mutation | primary key input | returns the deleted visible row |
| `deleteMany` | mutation | `{ where }` or `{ filters }` | requires at least one filter |

The type of each generated procedure is inferred from the Drizzle table, resource options, field visibility, transforms, and enabled operations.

## Core Building Blocks

### `defineTable`

Use `defineTable` when you want the strictest, most explicit type inference:

```ts
const usersResource = defineTable(users, {
  name: "users",
  policy: { all: allow.authenticated() },
  fields: {
    hidden: ["passwordHash"],
    readonly: ["id", "createdAt", "updatedAt"],
    select: ["id", "name", "email", "createdAt"],
  },
  columnPolicies: {
    passwordHash: {
      readable: false,
      writable: false,
      filterable: false,
      sortable: false,
    },
    role: {
      writable: false,
    },
  },
  query: {
    filterable: ["email", "name", "role"],
    sortable: ["id", "name", "createdAt"],
    defaultLimit: 25,
    maxLimit: 100,
  },
  operations: {
    list: true,
    get: true,
    create: true,
    update: true,
  },
});
```

Use this for production resources where you want the configuration to read like an API contract.

### `defineResource`

Use `defineResource` when you prefer a fluent API:

```ts
import {
  defineResource,
  hasRole,
  injectField,
  scopeToTenant,
  toISOString,
} from "drizzle-trpc-shield";

const postsResource = defineResource<typeof posts, Context>(posts)
  .operations("findMany", "findById", "create", "update", "delete")
  .guards(scopeToTenant<Context, typeof posts>("tenantId", (ctx) => ctx.user?.tenantId))
  .operationGuards("delete", hasRole<Context>((ctx) => ctx.user?.role, "admin"))
  .columnPolicy("tenantId", { writable: false, filterable: false })
  .beforeQuery("create", injectField("tenantId", (ctx) => ctx.user?.tenantId))
  .transform("createdAt", toISOString)
  .defaultSelect("id", "tenantId", "title", "createdAt")
  .pagination({
    mode: "cursor",
    cursorColumn: "id",
    defaultLimit: 20,
    maxLimit: 100,
  })
  .build();
```

`defineTable` is best for exact literal config inference. `defineResource` is best for progressive setup and discoverable DX.

### `ApiContext`

Define request context once, then use it everywhere:

```ts
type Context = ApiContext<{
  user?: {
    id: string;
    tenantId: string;
    role: "owner" | "admin" | "member";
    permissions: string[];
  };
  req: Request;
}>;
```

Policies, guard helpers, hook handlers, and plugins all receive this typed context.

### Policies And Guards

You can use the low-level policy helpers:

```ts
defineTable(posts, {
  policy: policy<Context>()({
    all: allow.authenticated(),
    before: {
      list: allow.scope(({ ctx }) => eq(posts.tenantId, ctx.user!.tenantId)),
      update: allow.role("admin", (ctx) => ctx.user?.role),
    },
  }),
});
```

Or use guard helpers when you want reusable rules:

```ts
import {
  and,
  contextGuard,
  hasPermission,
  hasRole,
  readOnly,
} from "drizzle-trpc-shield";

const isSignedIn = contextGuard<Context>((ctx) => Boolean(ctx.user));
const canManageUsers = hasPermission<Context>(
  (ctx) => ctx.user?.permissions,
  "users:manage",
);

const usersResource = defineTable(users, {
  policy: {
    all: isSignedIn,
    before: {
      list: readOnly(),
      update: and(hasRole<Context>((ctx) => ctx.user?.role, ["owner", "admin"]), canManageUsers),
    },
  },
});
```

Available helpers include `contextGuard`, `hasRole`, `hasPermission`, `and`, `or`, `not`, `readOnly`, `scopeToTenant`, and `injectField`.

### Field Security

There are two layers of field control:

```ts
defineTable(users, {
  policy: { all: allow.authenticated() },
  fields: {
    hidden: ["passwordHash"],
    readonly: ["id", "createdAt"],
    writable: ["name", "email"],
    select: ["id", "name", "email", "createdAt"],
  },
  columnPolicies: {
    passwordHash: {
      readable: false,
      writable: false,
      filterable: false,
      sortable: false,
    },
    emailVerifiedAt: {
      writable: false,
    },
  },
});
```

`fields` is the resource-level API shape. `columnPolicies` is the stricter per-column security layer. If a column is not readable, it is removed from output and cannot be filtered or sorted. If it is not writable, client input cannot set it.

### Querying

Canonical list input:

```ts
await caller.users.list({
  where: {
    email: { contains: "@acme.com" },
    createdAt: { between: [from, to] },
  },
  orderBy: [{ field: "id", direction: "desc" }],
  limit: 50,
  offset: 0,
});
```

Ergonomic alias input:

```ts
await caller.users.findMany({
  filters: {
    email: { op: "contains", value: "@acme.com" },
    status: { op: "in", values: ["active", "invited"] },
  },
  sort: [{ column: "createdAt", direction: "desc" }],
  pagination: { page: 1, limit: 25 },
});
```

Supported filter operators include `eq`, `ne`, `neq`, `in`, `notIn`, `isNull`, `isNotNull`, `gt`, `gte`, `lt`, `lte`, `between`, `like`, `ilike`, `contains`, `startsWith`, and `endsWith`.

### Transforms

Transforms run before data leaves the generated API:

```ts
import { parseJSON, redact, toISOString, trimString } from "drizzle-trpc-shield";

defineTable(users, {
  policy: { all: allow.authenticated() },
  transforms: {
    name: trimString,
    metadata: parseJSON,
    createdAt: toISOString,
    passwordHash: redact,
  },
  columnPolicies: {
    passwordHash: { readable: false, writable: false },
  },
});
```

Use transforms for serialized dates, JSON text columns, display normalization, and defensive redaction.

### Hooks And Plugins

Hooks can observe or transform input and output around generated operations:

```ts
import type { ShieldPlugin } from "drizzle-trpc-shield";

const auditPlugin: ShieldPlugin<Context> = {
  name: "audit",
  hooks: {
    beforeCreate({ ctx, resourceName, input }) {
      console.log("create", resourceName, ctx.user?.id, input);
      return input;
    },
    afterUpdate({ ctx, resourceName, result }) {
      console.log("update", resourceName, ctx.user?.id, result);
      return result;
    },
  },
};

const appRouter = createDbRouter({
  db,
  trpc: t,
  plugins: [auditPlugin],
  tables: {
    users: defineTable(users, { policy: { all: allow.authenticated() } }),
  },
});
```

Resource-level plugins are also supported:

```ts
defineTable(users, {
  policy: { all: allow.authenticated() },
  plugins: [auditPlugin],
});
```

### Logging Hooks

For simple structured logs:

```ts
import { createLoggingHooks, type ShieldPlugin } from "drizzle-trpc-shield";

const loggingPlugin: ShieldPlugin<Context> = {
  name: "logging",
  hooks: createLoggingHooks((entry) => {
    console.log(entry.resource, entry.operation, entry.durationMs);
  }),
};
```

## Practical Recipes

### Secure Admin Users API

```ts
const usersResource = defineTable(users, {
  policy: policy<Context>()({
    all: allow.authenticated(),
    before: {
      create: allow.role("admin", (ctx) => ctx.user?.role),
      update: allow.role("admin", (ctx) => ctx.user?.role),
      delete: allow.role("owner", (ctx) => ctx.user?.role),
      deleteMany: allow.role("owner", (ctx) => ctx.user?.role),
    },
  }),
  fields: {
    hidden: ["passwordHash", "resetToken"],
    readonly: ["id", "createdAt", "updatedAt"],
  },
  columnPolicies: {
    passwordHash: { readable: false, writable: false, filterable: false, sortable: false },
    resetToken: { readable: false, writable: false, filterable: false, sortable: false },
  },
  query: {
    filterable: ["email", "role"],
    sortable: ["id", "email", "createdAt"],
    defaultLimit: 25,
    maxLimit: 100,
  },
  operations: {
    list: true,
    get: true,
    create: true,
    createMany: false,
    update: true,
    delete: true,
    deleteMany: true,
  },
});
```

This gives you an admin-ready router while keeping secrets out of output, filters, sorts, and client writes.

### Multi-Tenant SaaS Resource

```ts
const projectsResource = defineResource<typeof projects, Context>(projects)
  .guards(
    contextGuard<Context>((ctx) => Boolean(ctx.user)),
    scopeToTenant<Context, typeof projects>("tenantId", (ctx) => ctx.user?.tenantId),
  )
  .columnPolicy("tenantId", { writable: false, filterable: false })
  .beforeQuery("create", injectField("tenantId", (ctx) => ctx.user?.tenantId))
  .beforeQuery("createMany", injectField("tenantId", (ctx) => ctx.user?.tenantId))
  .operations("findMany", "findById", "create", "createMany", "update", "delete")
  .build();
```

The client never sends `tenantId`; the server injects it after validation, and row-level scopes keep every query inside the caller's tenant.

### Bulk Import

```ts
await caller.users.createMany({
  data: [
    { name: "Ada", email: "ada@acme.com" },
    { name: "Grace", email: "grace@acme.com" },
  ],
});
```

`createMany` uses the same writable-column rules, policies, hooks, transforms, and output masking as `create`.

### Safe Bulk Cleanup

```ts
await caller.users.deleteMany({
  filters: {
    email: { op: "endsWith", value: "@example.test" },
  },
});
```

`deleteMany` requires at least one filter, only accepts filterable columns, and still applies row-level policy scopes.

### Custom Write Path

```ts
defineTable(users, {
  policy: { create: allow.authenticated() },
  operations: {
    create: {
      execute: async ({ db, table, input }) => {
        const [row] = await db.insert(table).values(input).returning();
        return row;
      },
    },
  },
});
```

Use custom operation executors when a resource needs special joins, driver-specific behavior, database functions, or a non-standard mutation flow.

## Real-World Use Cases

- Admin dashboards with generated CRUD and no hand-written router boilerplate
- Multi-tenant SaaS apps where every query must be tenant-scoped
- Internal tools that move quickly while hiding sensitive columns
- BFF layers for web and mobile clients that need one typed API per table
- Audit-heavy workflows that need consistent lifecycle hooks
- Data import screens with guarded `createMany`
- Moderation tools with safe, filtered `deleteMany`
- Prototypes that should keep production-shaped security from day one

## Architecture Map

The current architecture supports the system model:

- `defineTable` wraps a Drizzle schema with per-table config
- `defineResource` adds fluent resource composition for DX
- `createDbRouter` turns table definitions into a tRPC router
- `createShieldRouter` accepts raw resource configs and emits the same generated API
- `ApiContext` is the typed request context for policies, hooks, plugins, and guards
- access policies are composable through `allow`, `deny`, `policy`, and guard helpers
- row-level access is expressed as SQL scopes returned by policies and guards
- field-level security is enforced by `fields` and `columnPolicies`
- lifecycle hooks cover CRUD and bulk operations
- plugins can observe resource init, transform input/output, and attach side effects
- validation is adapter-based, with a Zod adapter included by default

## Security Notes

- Access is fail-closed by default. If an operation is enabled, it must have a policy from the global, resource, or operation layer.
- Hidden and unreadable fields are removed from output.
- Readonly and non-writable fields are stripped from client writes.
- Filters and sorts are allow-listed. A column must be explicitly filterable or sortable before the generated API accepts it.
- Bulk deletes require a filter object.
- Server-side hooks can inject trusted fields after validation, which is useful for tenant IDs, owner IDs, and audit columns.

## Package Scripts

```bash
pnpm lint
pnpm typecheck
pnpm test:type
pnpm test
pnpm build
pnpm check
pnpm publint
pnpm attw --pack .
```

## Notes

- If your database driver does not support `returning()`, provide a custom `execute` handler for that operation.
- `defineTable` gives the tightest literal config inference; `defineResource` gives a more fluent authoring experience.
- The package is designed to stay explicit: no implicit access, no unbounded filters, and no lost TypeScript inference.
