import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { allow, createShield, defineTable } from "../src/index.js";
import { createMemoryDb } from "./helpers/memory-db.js";

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

describe("shield router", () => {
  it("runs CRUD operations end to end", async () => {
    const db = createMemoryDb([
      { id: 1, name: "Ada", email: "ada@example.com", secret: "hidden" },
    ]);

    const shield = createShield({
      db,
      resources: {
        users: defineTable(users, {
          name: "users",
          policy: {
            all: allow.all(),
          },
          fields: {
            readonly: ["id"],
            hidden: ["secret"],
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

    const createCaller = (shield.trpc as any).createCallerFactory(shield.router);
    const caller = createCaller({});

    await expect(caller.users.get({ id: 1 })).resolves.toEqual({ id: 1, name: "Ada", email: "ada@example.com" });
    await expect(caller.users.list({})).resolves.toMatchObject({
      items: [{ id: 1, name: "Ada", email: "ada@example.com" }],
    });
    await expect(caller.users.create({ name: "Grace", email: "grace@example.com" })).resolves.toMatchObject({
      name: "Grace",
      email: "grace@example.com",
    });
    await expect(caller.users.update({ id: 1, data: { name: "Ada Lovelace" } })).resolves.toMatchObject({
      id: 1,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    await expect(caller.users.delete({ id: 1 })).resolves.toMatchObject({
      id: 1,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });
});
