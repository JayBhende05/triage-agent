import { beforeEach, describe, expect, test } from "bun:test";
import { pool } from "../src/db/index.ts";
import { seed } from "../src/db/seed.ts";
import { callTool, modelFacingSpecs } from "../src/tools/index.ts";
import { refunds, ticket } from "./support/harness.ts";

beforeEach(seed);

const ctx = { ticketId: 2 };
const refund = (args: object, c = ctx) => callTool("create_refund", args, c);

describe("create_refund", () => {
  test("twice with the same arguments leaves exactly one row", async () => {
    const args = { order_id: 1003, amount_inr: "500.00", reason: "wrong item" };
    const first = await refund(args);
    const second = await refund(args);
    expect(first).toMatchObject({ ok: true, data: { created: true } });
    expect(second).toMatchObject({ ok: true, data: { created: false } });
    const rows = await refunds();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticket_id: 2, order_id: 1003, amount_inr: "500.00", idempotency_key: "2:1003:500.00" });
  });

  test("the same amount written differently is the same refund", async () => {
    await refund({ order_id: 1003, amount_inr: "500", reason: "x" });
    await refund({ order_id: 1003, amount_inr: 500.0, reason: "x" });
    await refund({ order_id: 1003, amount_inr: "500.00", reason: "x" });
    expect(await refunds()).toHaveLength(1);
  });

  test("concurrent identical calls still leave one row", async () => {
    const args = { order_id: 1003, amount_inr: "100.00", reason: "x" };
    await Promise.all(Array.from({ length: 6 }, () => refund(args)));
    expect(await refunds()).toHaveLength(1);
  });

  test("a refund above the order total is refused", async () => {
    const r = await refund({ order_id: 1009, amount_inr: "1200.01", reason: "x" }, { ticketId: 6 });
    expect(r).toMatchObject({ ok: false, error: { kind: "business_rule" } });
    expect(await refunds()).toHaveLength(0);
  });

  test("the total counts refunds from other tickets too", async () => {
    await refund({ order_id: 1009, amount_inr: "800.00", reason: "x" }, { ticketId: 6 });
    const r = await refund({ order_id: 1009, amount_inr: "500.00", reason: "x" }, { ticketId: 1 });
    expect(r).toMatchObject({ ok: false, error: { kind: "business_rule" } });
    const exact = await refund({ order_id: 1009, amount_inr: "400.00", reason: "x" }, { ticketId: 1 });
    expect(exact.ok).toBe(true);
    expect(await refunds()).toHaveLength(2);
  });

  test("bad amounts and unknown orders fail without writing", async () => {
    for (const amount_inr of ["0", "-1", "abc", "1.234", ""]) {
      expect(await refund({ order_id: 1003, amount_inr, reason: "x" })).toMatchObject({ ok: false, error: { kind: "validation" } });
    }
    expect(await refund({ order_id: 4242, amount_inr: "5", reason: "x" })).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(await refunds()).toHaveLength(0);
  });

  test("the ticket cannot be chosen through the arguments", async () => {
    const r = await refund({ order_id: 1003, amount_inr: "5", reason: "x", ticket_id: 1 });
    expect(r).toMatchObject({ ok: false, error: { kind: "validation" } });
  });
});

describe("other tools", () => {
  test("the model is only offered the two lookups", () => {
    expect(modelFacingSpecs().map((t) => t.name).sort()).toEqual(["lookup_customer", "lookup_order"]);
  });

  test("lookup_customer lowercases the email and reports not found", async () => {
    expect(await callTool("lookup_customer", { email: " ASHA@Example.com " }, ctx)).toMatchObject({
      ok: true,
      data: { id: 1, name: "Asha Patil", email: "asha@example.com" },
    });
    expect(await callTool("lookup_customer", { email: "nobody@example.com" }, ctx)).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  test("lookup_order returns the owner's email", async () => {
    expect(await callTool("lookup_order", { order_id: "1002" }, ctx)).toMatchObject({
      ok: true,
      data: { id: 1002, total_inr: "799.00", owner_email: "asha@example.com" },
    });
  });

  test("draft_reply saves the text on the context's ticket", async () => {
    expect((await callTool("draft_reply", { body: "Hello" }, { ticketId: 4 })).ok).toBe(true);
    expect((await ticket(4)).draft_reply).toBe("Hello");
    expect(await callTool("draft_reply", { body: "   " }, ctx)).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  test("an unknown tool is an error result, not a throw", async () => {
    expect(await callTool("drop_tables", {}, ctx)).toMatchObject({ ok: false, error: { kind: "unknown_tool" } });
  });

  test("every call writes one audit row, failures included", async () => {
    await callTool("lookup_order", { order_id: 1001 }, ctx);
    await callTool("lookup_order", { order_id: 9 }, ctx);
    const { rows } = await pool.query("SELECT name, output FROM audit_log WHERE ticket_id = 2 AND kind = 'tool' ORDER BY id");
    expect(rows).toHaveLength(2);
    expect(rows[1].output.ok).toBe(false);
  });
});
