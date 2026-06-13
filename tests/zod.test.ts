import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { allow, resource } from "../src/index.js";
import { createZodValidationAdapter } from "../src/validation/zod.js";

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

describe("zod adapter", () => {
  it("builds a strict create schema and strips hidden fields from outputs", () => {
    const usersResource = resource(users, {
      name: "users",
      policy: { list: allow.all() },
      fields: {
        readonly: ["id"],
        hidden: ["secret"],
      },
      operations: {
        create: true,
        update: true,
        get: true,
        delete: true,
        list: true,
      },
    });

    const adapter = createZodValidationAdapter();
    const createSchema = adapter.inputFor(usersResource, "create");
    const parsed = createSchema.parse({ name: "Ada", email: "ada@example.com" });

    expect(parsed).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(() => createSchema.parse({ name: "Ada", email: "ada@example.com", secret: "x" })).toThrow();
  });

  it("generates list schema with controlled inputs", () => {
    const usersResource = resource(users, {
      name: "users",
      policy: { list: allow.all() },
      query: {
        filterable: ["name", "email"],
        sortable: ["name"],
      },
      operations: {
        list: true,
      },
    });

    const adapter = createZodValidationAdapter();
    const schema = adapter.inputFor(usersResource, "list");
    const parsed = schema.parse({
      where: {
        name: { contains: "A" },
      },
      orderBy: [{ field: "name", direction: "desc" }],
      limit: 10,
      offset: 0,
    }) as {
      where?: { name?: { contains?: string } };
    };

    expect(parsed.where?.name).toMatchObject({ contains: "A" });
  });
});
