import { initTRPC } from "@trpc/server";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { allow, createDbRouter, defineTable, type ApiContext } from "../src/index.js";
import { createMemoryDb } from "./helpers/memory-db.js";

type AppContext = ApiContext<{ user?: { id: number } }>;

const t = initTRPC.context<AppContext>().create();

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

describe("compatibility layer", () => {
  it("supports defineTable and createDbRouter", async () => {
    const db = createMemoryDb([
      { id: 1, name: "Ada", email: "ada@example.com", secret: "hidden" },
    ]);

    const router = createDbRouter({
      db,
      trpc: t,
      tables: {
        users: defineTable(users, {
          name: "users",
          policy: { all: allow.all() },
          fields: { readonly: ["id"], hidden: ["secret"] },
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

    const createCaller = t.createCallerFactory(router);
    const caller = createCaller({});

    await expect(caller.users.get({ id: 1 })).resolves.toEqual({ id: 1, name: "Ada", email: "ada@example.com" });
  });
});
