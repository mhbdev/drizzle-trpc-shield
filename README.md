# drizzle-trpc-shield

Turn Drizzle ORM tables into secure, type-safe tRPC APIs with explicit policies, field controls, hooks, and plugin support.

## What it gives you

- `defineTable` for wrapping a Drizzle table with API config
- `createDbRouter` for the fastest path from table definitions to a tRPC router
- `createShield` when you want the full API object and more control
- `ApiContext` for a typed request context
- `allow`, `deny`, and `policy` for composable authorization rules
- `ShieldPlugin` for lifecycle hooks and extension points
- automatic CRUD procedures: `list`, `get`, `create`, `update`, `delete`

## Install

```bash
pnpm add drizzle-trpc-shield @trpc/server drizzle-orm zod
```

## Quick start

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
// db is your Drizzle database instance.

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

const appRouter = createDbRouter({
  db,
  trpc: t,
  tables: {
    users: defineTable(users, {
      name: "users",
      policy: policy<Context>()({
        all: allow.authenticated(),
      }),
      fields: {
        hidden: ["secret"],
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
        update: true,
        delete: true,
      },
    }),
  },
});

export type AppRouter = typeof appRouter;

const caller = t.createCallerFactory(appRouter)({
  user: { id: 1, role: "admin" },
});

await caller.users.list({});
```

## Core building blocks

### `defineTable`

Wraps a Drizzle table with API behavior:

- `policy` for row-level access rules
- `fields.hidden` for output masking
- `fields.readonly` and `fields.writable` for write control
- `query.filterable` and `query.sortable` for safe list queries
- `operations` for enabling, disabling, or customizing CRUD operations
- `plugins` and `meta` for resource-specific extension points

`resource(...)` is still exported as a lower-level alias, but `defineTable(...)` is the preferred name.

### `createDbRouter`

Use this when you want a single router from a table map:

```ts
const appRouter = createDbRouter({
  db,
  trpc: t,
  tables: {
    users: defineTable(users, { policy: { all: allow.authenticated() } }),
  },
});
```

### `createShield`

Use this when you want the full shield object:

```ts
const shield = createShield({
  db,
  trpc: t,
  resources: {
    users: defineTable(users, { policy: { all: allow.authenticated() } }),
  },
});

export const appRouter = shield.router;
```

### `ApiContext`

Type your request context once and let it flow through policies, hooks, and plugins:

```ts
type Context = ApiContext<{
  user?: {
    id: number;
    tenantId: number;
    role: "admin" | "member";
  };
  req: Request;
}>;
```

## Practical examples

### 1. Hidden secrets and read-only columns

```ts
defineTable(users, {
  policy: { all: allow.authenticated() },
  fields: {
    hidden: ["secret"],
    readonly: ["id", "createdAt", "updatedAt"],
  },
});
```

Use this for password hashes, internal flags, or any column that should never leak through the API.

### 2. Multi-tenant row-level access

Assume `posts` is a Drizzle table with `tenantId`, `authorId`, and `title` columns.

```ts
import { eq } from "drizzle-orm";

defineTable(posts, {
  policy: policy<Context>()({
    all: allow.authenticated(),
    before: {
      list: allow.scope(({ ctx }) => eq(posts.tenantId, ctx.user!.tenantId)),
      get: allow.scope(({ ctx }) => eq(posts.tenantId, ctx.user!.tenantId)),
      update: allow.scope(({ ctx }) => eq(posts.tenantId, ctx.user!.tenantId)),
      delete: allow.role<Context, typeof posts>("admin"),
    },
    after: {
      get: allow.owner({
        userId: (ctx) => ctx.user?.id,
        rowUserId: (row) => row.authorId,
      }),
    },
  }),
});
```

Use this for SaaS products where every request must stay inside the caller's tenant boundary.

### 3. Audit logging with hooks

```ts
import type { ShieldPlugin } from "drizzle-trpc-shield";

const auditPlugin: ShieldPlugin<Context> = {
  name: "audit",
  hooks: {
    beforeCreate({ resourceName, ctx, input }) {
      console.log("creating", resourceName, ctx.user?.id, input);
    },
    afterUpdate({ resourceName, ctx, result }) {
      console.log("updated", resourceName, ctx.user?.id, result);
    },
  },
};

const shield = createShield({
  db,
  trpc: t,
  plugins: [auditPlugin],
  resources: {
    users: defineTable(users, { policy: { all: allow.authenticated() } }),
  },
});
```

Use this for audit trails, analytics, cache invalidation, and side effects that should stay outside the core resolver logic.

### 4. Custom resource behavior

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

Use this when one resource needs a special write path, a custom join, or a driver-specific workaround.

## Real-world use cases

- Admin dashboards that need generated CRUD without hand-writing every router
- Multi-tenant SaaS products that need tenant-scoped access by default
- Internal tools that must hide sensitive columns but still move fast
- Mobile or BFF layers that want one typed API per table
- Regulated workflows that need audit hooks and explicit authorization
- Prototypes that should stay production-shaped from day one

## Architecture map

This package already supports the model you described:

- `defineTable` wraps a Drizzle schema with per-table config
- `createDbRouter` emits a tRPC router from table definitions
- `ApiContext` defines the typed per-request context
- access control comes from composable `allow` / `deny` / `policy` rules
- row-level filtering is handled through scope-producing policies
- field visibility is handled through `hidden`, `readonly`, and `writable`
- hooks include `beforeCreate`, `afterUpdate`, and the rest of the CRUD lifecycle
- `ShieldPlugin` is the extension surface for middleware-like behavior and resource init

## Notes

- `list`, `get`, `create`, `update`, and `delete` are generated automatically when enabled.
- If your database driver does not support `returning()`, provide a custom `execute` handler for that operation.
- This package is designed to stay strict: no implicit access, no hidden router magic, and no lost TypeScript inference.
