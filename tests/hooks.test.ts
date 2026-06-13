import { initTRPC } from "@trpc/server";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { allow, createShield, defineTable, type ApiContext, type ShieldPlugin } from "../src/index.js";
import { createMemoryDb } from "./helpers/memory-db.js";

type AppContext = ApiContext<{ user?: { id: number } }>;

const t = initTRPC.context<AppContext>().create();

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

describe("operation hooks", () => {
  it("runs beforeCreate and afterUpdate", async () => {
    const events: string[] = [];
    const hookPlugin: ShieldPlugin<AppContext> = {
      name: "tracker",
      hooks: {
        beforeCreate: ({ operation }) => {
          events.push(`before:${operation}`);
        },
        afterCreate: ({ operation }) => {
          events.push(`after:${operation}`);
        },
        beforeUpdate: ({ operation }) => {
          events.push(`before:${operation}`);
        },
        afterUpdate: ({ operation }) => {
          events.push(`after:${operation}`);
        },
      },
    };

    const shield = createShield({
      db: createMemoryDb([
        { id: 1, name: "Ada", email: "ada@example.com", secret: "hidden" },
      ]),
      trpc: t,
      plugins: [hookPlugin],
      resources: {
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

    const createCaller = t.createCallerFactory(shield.router);
    const caller = createCaller({});

    await caller.users.create({ name: "Grace", email: "grace@example.com" });
    await caller.users.update({ id: 1, data: { name: "Ada Lovelace" } });

    expect(events).toEqual(["before:create", "after:create", "before:update", "after:update"]);
  });
});
