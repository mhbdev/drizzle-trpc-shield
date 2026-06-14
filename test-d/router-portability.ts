import { initTRPC } from "@trpc/server";
import { expectTypeOf } from "expect-type";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { inferRouterInputs } from "@trpc/server";

import {
  contextGuard,
  createShieldRouter,
  defineResource,
  hasRole,
  toISOString,
  type ApiContext,
} from "../src/index.js";

type Context = ApiContext<{
  session: { userId: string } | null;
  user?: { role?: string | null };
}>;

const t = initTRPC.context<Context>().create();

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

const isSignedIn = contextGuard<Context>((ctx) => Boolean(ctx.session));
const usersResource = defineResource<typeof users, Context>(users)
  .operations("findMany", "findById", "create", "update", "delete")
  .operationGuards("delete", hasRole<Context>((ctx) => ctx.user?.role, "admin"))
  .transform("createdAt", toISOString)
  .defaultSelect("id", "name", "role", "createdAt")
  .pagination({
    mode: "offset",
    defaultLimit: 20,
    maxLimit: 100,
  })
  .build();

export const dbRouter = createShieldRouter({
  db: {} as never,
  t,
  config: {
    globalGuards: [isSignedIn],
    resources: {
      users: usersResource,
    },
  },
});

export const appRouter = t.router({
  db: dbRouter,
  healthCheck: t.procedure.query(() => "OK"),
});

const rawRouter = createShieldRouter({
  db: {} as never,
  t,
  config: {
    resources: {
      users: {
        table: users,
        policy: { all: isSignedIn },
        fields: {
          hidden: ["role"],
          readonly: ["id"],
        },
        query: {
          filterable: ["name"],
          sortable: ["name"],
        },
        pagination: {
          mode: "cursor",
          cursorColumn: "id",
        },
        operations: {
          list: true,
        },
      },
    },
  },
});

type RawRouterInputs = inferRouterInputs<typeof rawRouter>;

expectTypeOf<RawRouterInputs["users"]["findMany"]>().toMatchTypeOf<{
  sort?: readonly {
    column: "id" | "name";
    direction?: "asc" | "desc";
  }[];
  pagination?: {
    cursor?: string;
  };
}>();

export type AppRouter = typeof appRouter;
