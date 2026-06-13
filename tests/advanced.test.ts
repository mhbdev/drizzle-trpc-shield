import { initTRPC } from "@trpc/server";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import {
  allow,
  contextGuard,
  createShield,
  createShieldRouter,
  defineResource,
  defineTable,
  injectField,
  type ApiContext,
} from "../src/index.js";
import { createMemoryDb } from "./helpers/memory-db.js";

type AppContext = ApiContext<{
  session?: {
    userId: number;
    orgId: number;
    role?: "admin" | "member";
  } | null;
}>;

const t = initTRPC.context<AppContext>().create();

const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
  orgId: integer("org_id").notNull(),
});

describe("advanced compatibility features", () => {
  it("supports createShieldRouter raw resources and operation aliases", async () => {
    const db = createMemoryDb([
      { id: 1, name: "Ada", email: "ada@example.com", secret: "hidden", orgId: 10 },
    ]);

    const router = createShieldRouter({
      db,
      t,
      config: {
        globalGuards: [contextGuard<AppContext>((ctx) => ctx.session !== null)],
        resources: {
          accounts: {
            table: accounts,
            fields: { hidden: ["secret"], readonly: ["id"] },
            query: { filterable: ["name"], sortable: ["id"] },
            operations: {
              list: true,
              get: true,
              create: true,
              createMany: true,
              update: true,
              delete: true,
              deleteMany: true,
            },
          },
        },
      },
    });

    const caller = t.createCallerFactory(router)({
      session: { userId: 1, orgId: 10, role: "admin" },
    });

    await expect(caller.accounts.findById({ id: 1 })).resolves.toEqual({
      id: 1,
      name: "Ada",
      email: "ada@example.com",
      orgId: 10,
    });
    await expect(
      caller.accounts.findMany({ filters: { name: { op: "contains", value: "A" } } }),
    ).resolves.toMatchObject({
      items: [{ id: 1, name: "Ada", email: "ada@example.com", orgId: 10 }],
    });
  });

  it("supports fluent resources, column policies, transforms, and server-side injection", async () => {
    const db = createMemoryDb([
      { id: 1, name: "Ada", email: "ada@example.com", secret: "hidden", orgId: 10 },
    ]);

    const accountsResource = defineResource<typeof accounts, AppContext>(accounts)
      .operations("findMany", "findById", "create")
      .guards(allow.all<AppContext, typeof accounts>())
      .columnPolicy("secret", { readable: false, writable: false, filterable: false })
      .columnPolicy("orgId", { writable: false, filterable: false })
      .transform("name", (value) => String(value).toUpperCase())
      .defaultSelect("id", "name", "email", "secret", "orgId")
      .beforeQuery("create", injectField("orgId", (ctx) => ctx.session?.orgId ?? 0))
      .build();

    const shield = createShield({
      db,
      trpc: t,
      resources: {
        accounts: accountsResource,
      },
    });
    const caller = t.createCallerFactory(shield.router)({
      session: { userId: 1, orgId: 42, role: "member" },
    });

    await expect(caller.accounts.findById({ id: 1 })).resolves.toEqual({
      id: 1,
      name: "ADA",
      email: "ada@example.com",
      orgId: 10,
    });
    await expect(caller.accounts.create({ name: "Grace", email: "grace@example.com" })).resolves.toMatchObject({
      name: "GRACE",
      email: "grace@example.com",
      orgId: 42,
    });
    expect(db.snapshot().at(-1)).toMatchObject({ name: "Grace", orgId: 42 });
    await expect(
      caller.accounts.create({ name: "Mallory", email: "mallory@example.com", orgId: 999 }),
    ).rejects.toThrow();
  });

  it("supports createMany and deleteMany", async () => {
    const db = createMemoryDb([]);
    const shield = createShield({
      db,
      trpc: t,
      resources: {
        accounts: defineTable(accounts, {
          name: "accounts",
          policy: { all: allow.all() },
          fields: { hidden: ["secret"], readonly: ["id"] },
          query: { filterable: ["email"], sortable: ["id"] },
          operations: {
            list: true,
            createMany: true,
            deleteMany: true,
          },
        }),
      },
    });
    const caller = t.createCallerFactory(shield.router)({});

    await expect(
      caller.accounts.createMany({
        data: [
          { name: "Ada", email: "ada@example.com", orgId: 10 },
          { name: "Grace", email: "grace@example.com", orgId: 10 },
        ],
      }),
    ).resolves.toMatchObject({
      meta: { count: 2 },
      items: [
        { name: "Ada", email: "ada@example.com", orgId: 10 },
        { name: "Grace", email: "grace@example.com", orgId: 10 },
      ],
    });

    await expect(
      caller.accounts.deleteMany({ filters: { email: { op: "contains", value: "example.com" } } }),
    ).resolves.toMatchObject({
      meta: { count: 2 },
    });
  });
});
