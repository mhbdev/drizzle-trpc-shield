import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { expectTypeOf } from "expect-type";

import { allow, createShield, defineTable, type ApiContext, type InferResourceInput, type InferResourceOutput } from "../src/index.js";

type AppContext = ApiContext<{ user?: { id: number } }>;
type _CheckContext = AppContext;

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  secret: text("secret").notNull(),
});

const usersResource = defineTable(users, {
  name: "users",
  policy: { all: allow.all() },
  fields: { readonly: ["id"], hidden: ["secret"] },
  query: { filterable: ["name"], sortable: ["name"] },
  operations: { list: true, get: true, create: true, update: true, delete: true },
});

type CreateInput = InferResourceInput<typeof usersResource, "create">;
type ListOutput = InferResourceOutput<typeof usersResource, "list">;

expectTypeOf<CreateInput>().toEqualTypeOf<{
  name: string;
  email: string;
}>();

expectTypeOf<ListOutput>().toEqualTypeOf<{
  items: Array<{
    id: number;
    name: string;
    email: string;
  }>;
  meta: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}>();

const shield = createShield({
  db: {} as never,
  resources: { users: usersResource },
});

void shield;
