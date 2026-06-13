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

const secureUsersResource = defineTable(users, {
  name: "secureUsers",
  policy: { all: allow.all() },
  fields: { readonly: ["id"] },
  columnPolicies: {
    secret: { readable: false, writable: false, filterable: false },
  },
  transforms: {
    name: (value: string) => value.toUpperCase(),
  },
  query: { filterable: ["email", "secret"], sortable: ["name"] },
  operations: { list: true, get: true, create: true, createMany: true, deleteMany: true },
});

type CreateInput = InferResourceInput<typeof usersResource, "create">;
type ListOutput = InferResourceOutput<typeof usersResource, "list">;
type SecureCreateInput = InferResourceInput<typeof secureUsersResource, "create">;
type SecureCreateManyInput = InferResourceInput<typeof secureUsersResource, "createMany">;
type SecureOutput = InferResourceOutput<typeof secureUsersResource, "get">;

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
    nextCursor?: unknown;
  };
}>();

expectTypeOf<SecureCreateInput>().toEqualTypeOf<{
  name: string;
  email: string;
}>();

expectTypeOf<SecureCreateManyInput>().toEqualTypeOf<{
  data: readonly {
    name: string;
    email: string;
  }[];
}>();

expectTypeOf<SecureOutput>().toEqualTypeOf<{
  id: number;
  name: string;
  email: string;
}>();

const shield = createShield({
  db: {} as never,
  resources: { users: usersResource },
});

void shield;
