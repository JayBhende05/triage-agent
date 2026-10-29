import { beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../src/api/server.ts";
import { seed } from "../src/db/seed.ts";
import { newGraph, refunds, scripts } from "./support/harness.ts";
import type { Script } from "./support/scripted-model.ts";

beforeEach(seed);

async function makeApp(script: Script) {
  const { graph } = await newGraph(script);
  return buildApp(graph);
}

describe("API", () => {
  test("create, run, queue, approve, resolved with one refund; the second approval is 409", async () => {
    const app = await makeApp(scripts.refund());

    const created = await app.inject({
      method: "POST",
      url: "/tickets",
      payload: { from_email: "Rohan@Example.com", subject: "Refund", body: "Order 1003 was wrong." },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number; // 7: the seed made 1-6
    expect(created.json()).toMatchObject({ from_email: "rohan@example.com", status: "new" });

    // Run the seeded refund ticket (2), whose script matches.
    const run = await app.inject({ method: "POST", url: "/tickets/2/run" });
    expect(run.statusCode).toBe(202);
    await app.idle();

    const queue = await app.inject({ method: "GET", url: "/approvals?status=pending" });
    const [approval] = queue.json().approvals;
    expect(queue.json().approvals).toHaveLength(1);
    expect(approval).toMatchObject({ ticket_id: 2, status: "pending", reasons: ["refund"] });

    const detail = (await app.inject({ method: "GET", url: "/tickets/2" })).json();
    expect(detail.ticket.status).toBe("awaiting_approval");
    expect(detail.proposal).toMatchObject({ action: "refund_and_reply", order_id: 1003, refund_amount_inr: "2499.00" });
    expect(detail.audit.map((a: { kind: string }) => a.kind)).toContain("llm");

    const ok = await app.inject({ method: "POST", url: `/approvals/${approval.id}/decision`, payload: { verdict: "approve" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ticket_id: 2, status: "resolved" });

    const done = (await app.inject({ method: "GET", url: "/tickets/2" })).json();
    expect(done.ticket.status).toBe("resolved");
    expect(done.refunds).toHaveLength(1);
    expect(done.refunds[0].amount_inr).toBe("2499.00"); // money is a string

    const second = await app.inject({ method: "POST", url: `/approvals/${approval.id}/decision`, payload: { verdict: "approve" } });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: { code: "already_decided", message: expect.any(String) } });
    expect(await refunds()).toHaveLength(1);
    expect(id).toBe(7);
  });

  test("a double run returns 409, even when both arrive at once", async () => {
    const app = await makeApp(scripts.refund());
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/tickets/2/run" }),
      app.inject({ method: "POST", url: "/tickets/2/run" }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    await app.idle();
    // Still 409 once it has paused.
    expect((await app.inject({ method: "POST", url: "/tickets/2/run" })).statusCode).toBe(409);
  });

  test("a failed ticket can be run again through the API", async () => {
    const script = scripts.refund();
    script.triage = [new Error("boom"), ...(script.triage ?? [])];
    const app = await makeApp(script);

    expect((await app.inject({ method: "POST", url: "/tickets/2/run" })).statusCode).toBe(202);
    await app.idle();
    expect((await app.inject({ method: "GET", url: "/tickets/2" })).json().ticket.status).toBe("failed");

    expect((await app.inject({ method: "POST", url: "/tickets/2/run" })).statusCode).toBe(202);
    await app.idle();
    expect((await app.inject({ method: "GET", url: "/tickets/2" })).json().ticket.status).toBe("awaiting_approval");
  });

  test("errors use one shape: 404 unknown id, 422 bad input", async () => {
    const app = await makeApp({});
    const shape = { error: { code: expect.any(String), message: expect.any(String) } };

    for (const [method, url, payload, status] of [
      ["POST", "/tickets/999/run", undefined, 404],
      ["GET", "/tickets/999", undefined, 404],
      ["POST", "/approvals/999/decision", { verdict: "approve" }, 404],
      ["GET", "/tickets/abc", undefined, 422],
      ["POST", "/tickets", { from_email: "not-an-email", subject: "s", body: "b" }, 422],
      ["POST", "/tickets", { from_email: "a@b.com", subject: "s" }, 422],
      ["POST", "/approvals/1/decision", { verdict: "approve", extra: 1 }, 422],
      ["GET", "/approvals?status=bogus", undefined, 422],
    ] as const) {
      const r = await app.inject({ method, url, payload });
      expect([method, url, r.statusCode]).toEqual([method, url, status]);
      expect(r.json()).toMatchObject(shape);
    }
  });

  test("health checks the database", async () => {
    const app = await makeApp({});
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
  });
});
