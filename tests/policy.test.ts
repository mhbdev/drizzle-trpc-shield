import { describe, expect, it } from "vitest";

import { allow, deny, policy } from "../src/index.js";

describe("policy helpers", () => {
  it("allows authenticated contexts", () => {
    const rule = allow.authenticated<{ user?: { id: number } }>();
    expect(rule({ ctx: { user: { id: 1 } }, input: null, operation: "list", resourceName: "users", table: {} as never })).toBe(true);
  });

  it("denies by default", () => {
    const rule = deny.all();
    expect(rule({ ctx: {}, input: null, operation: "list", resourceName: "users", table: {} as never })).toMatchObject({ allow: false });
  });

  it("builds policy containers", () => {
    const rules = policy<{ user?: { id: number } }>()({
      list: allow.all(),
      after: {
        get: allow.owner({
          userId: (ctx) => ctx.user?.id,
          rowUserId: (row) => (row as { userId?: number }).userId,
        }),
      },
    });

    expect(rules.list).toBeDefined();
    expect(rules.after?.get).toBeDefined();
  });
});
