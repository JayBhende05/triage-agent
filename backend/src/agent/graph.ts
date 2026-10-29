/**
 * triage -> gather_context -> propose -> risk_gate -+-> finalize (escalate)
 *                                                   +-> await_approval -> execute -> finalize
 *                                                   |        '-> (rejected) finalize
 *                                                   +-> execute -> finalize (safe to run)
 *
 * State holds only JSON-friendly values. The thread id is the ticket id.
 */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { audit, pool } from "../db/index.ts";
import { evaluate, MAX_TOOL_CALLS } from "./policy.ts";
import { callTool, modelFacingSpecs } from "../tools/index.ts";
import {
  ProposalSchema,
  TriageSchema,
  type Context,
  type Decision,
  type Flags,
  type OrderFact,
  type Proposal,
  type Risk,
  type Triage,
} from "./types.ts";
import type { Model } from "./model.ts";
import { GATHER_SYSTEM, PROPOSE_SYSTEM, proposeInput, ticketBlock, TRIAGE_SYSTEM } from "./prompts.ts";

interface Ticket {
  id: number;
  from_email: string;
  subject: string;
  body: string;
}

const State = Annotation.Root({
  ticketId: Annotation<number>(),
  ticket: Annotation<Ticket | null>(),
  triage_result: Annotation<Triage | null>(),
  context: Annotation<Context>(),
  proposal: Annotation<Proposal | null>(),
  risk: Annotation<Risk | null>(),
  decision: Annotation<Decision | null>(),
  flags: Annotation<Flags>(),
});
type S = typeof State.State;

/** A reply action with no reply text can never be executed, so it counts as invalid output. */
const ReplyableProposal = ProposalSchema.refine(
  (p) => !(p.action === "reply" || p.action === "refund_and_reply") || !!p.reply_text?.trim(),
  { message: "reply_text is required for reply and refund_and_reply", path: ["reply_text"] },
);

function isValidationError(e: unknown): boolean {
  const err = e as { name?: string; lc_error_code?: string };
  return e instanceof z.ZodError || err?.name === "OutputParserException" || err?.lc_error_code === "OUTPUT_PARSING_FAILURE";
}

const render = (msgs: BaseMessage[]) =>
  msgs.map((m) => ({ role: m.type, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }));

export function buildGraph(model: Model, checkpointer: PostgresSaver) {
  /** One audited structured call. A bad reply gets one retry with the error; then null. */
  async function structured<T>(ticketId: number, name: string, schema: z.ZodType<T>, messages: BaseMessage[]) {
    let msgs = messages;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const out = await model.structured(name, schema, msgs);
        await audit(ticketId, "llm", name, { attempt, messages: render(msgs) }, out);
        return out;
      } catch (e) {
        if (!isValidationError(e)) throw e; // a provider outage fails the run, it is not an "invalid answer"
        const message = e instanceof Error ? e.message : String(e);
        await audit(ticketId, "llm", name, { attempt, messages: render(msgs) }, { error: message });
        msgs = [...messages, new HumanMessage(`Your previous answer was rejected: ${message}\nAnswer again, fixing that.`)];
      }
    }
    return null;
  }

  const triageNode = async (state: S): Promise<Partial<S>> => {
    const { rows } = await pool.query("SELECT id, from_email, subject, body FROM tickets WHERE id = $1", [state.ticketId]);
    const ticket = rows[0] as Ticket;
    const out = await structured(ticket.id, "triage", TriageSchema, [
      new SystemMessage(TRIAGE_SYSTEM),
      new HumanMessage(ticketBlock(ticket)),
    ]);
    return {
      ticket,
      triage_result: out,
      context: { customers: {}, orders: {} },
      flags: out ? {} : { triage_invalid: true },
    };
  };

  const gatherContext = async (state: S): Promise<Partial<S>> => {
    const ticket = state.ticket!;
    const offered = new Set(modelFacingSpecs().map((t) => t.name));
    const context: Context = { customers: {}, orders: {} };
    const flags: Flags = { ...state.flags };
    const messages: BaseMessage[] = [
      new SystemMessage(GATHER_SYSTEM),
      new HumanMessage(`${ticketBlock(ticket)}\n\nTriage: ${JSON.stringify(state.triage_result)}`),
    ];

    let calls = 0;
    gather: for (;;) {
      const step = await model.toolStep(messages);
      await audit(ticket.id, "llm", "gather_context", { messages: render(messages) }, step);
      if (step.toolCalls.length === 0) break;

      messages.push(
        new AIMessage({
          content: step.content,
          tool_calls: step.toolCalls.map((c) => ({ id: c.id, name: c.name, args: c.args as Record<string, unknown> })),
        }),
      );
      for (const c of step.toolCalls) {
        if (calls >= MAX_TOOL_CALLS) {
          flags.loop_guard = true;
          break gather;
        }
        calls++;
        let result;
        if (offered.has(c.name)) {
          result = await callTool(c.name, c.args, { ticketId: ticket.id });
        } else {
          // The model asked for a tool it was never offered (for example a write tool). Refuse it.
          result = { ok: false as const, error: { kind: "unknown_tool", message: `no tool named ${c.name}` } };
          await audit(ticket.id, "tool", c.name, c.args, result);
        }
        if (result.ok) {
          if (c.name === "lookup_customer") {
            const cust = result.data as Context["customers"][string];
            context.customers[cust.email] = cust;
          } else {
            const o = result.data as OrderFact;
            context.orders[String(o.id)] = o;
          }
        }
        messages.push(new ToolMessage({ tool_call_id: c.id, content: JSON.stringify(result) }));
      }
    }
    return { context, flags };
  };

  const propose = async (state: S): Promise<Partial<S>> => {
    const ticket = state.ticket!;
    if (state.flags.loop_guard) return {}; // the gate will escalate
    if (state.triage_result!.category === "spam") {
      // Built in code: spam text never reaches a second model call.
      return { proposal: { action: "close_spam", order_id: null, refund_amount_inr: null, reply_text: null } };
    }
    const out = await structured(ticket.id, "propose", ReplyableProposal, [
      new SystemMessage(PROPOSE_SYSTEM),
      new HumanMessage(proposeInput(ticket, state.triage_result!, state.context)),
    ]);
    return out ? { proposal: out } : { proposal: null, flags: { ...state.flags, proposal_invalid: true } };
  };

  const riskGate = async (state: S): Promise<Partial<S>> => {
    const risk = evaluate(state.ticket!, state.triage_result, state.proposal, state.context, state.flags);
    await audit(state.ticketId, "decision", "risk_gate", { triage: state.triage_result, proposal: state.proposal, flags: state.flags }, risk);
    return { risk };
  };

  const awaitApproval = async (state: S): Promise<Partial<S>> => {
    // Everything before interrupt() runs again on resume, so each write here is safe to repeat.
    await pool.query(
      `INSERT INTO approvals (ticket_id, proposal, reasons) VALUES ($1,$2,$3)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [state.ticketId, JSON.stringify(state.proposal), JSON.stringify(state.risk!.reasons)],
    );
    await pool.query(
      `UPDATE tickets SET status = 'awaiting_approval', category = $2
        WHERE id = $1 AND EXISTS (SELECT 1 FROM approvals WHERE ticket_id = $1 AND status = 'pending')`,
      [state.ticketId, state.triage_result!.category],
    );
    const decision = interrupt({ ticket_id: state.ticketId, proposal: state.proposal, reasons: state.risk!.reasons });
    return { decision: decision as Decision };
  };

  const execute = async (state: S): Promise<Partial<S>> => {
    const id = state.ticketId;
    const proposal = { ...state.proposal! };
    const edits = state.decision;
    if (edits?.verdict === "approve") {
      if (edits.reply_text !== undefined) proposal.reply_text = edits.reply_text;
      if (edits.refund_amount_inr !== undefined) proposal.refund_amount_inr = edits.refund_amount_inr;
    }

    if (proposal.action === "refund_and_reply") {
      const r = await callTool(
        "create_refund",
        { order_id: proposal.order_id, amount_inr: proposal.refund_amount_inr, reason: state.triage_result!.summary || "refund" },
        { ticketId: id },
      );
      if (!r.ok) throw new Error(`create_refund failed: ${r.error.message}`);
    }
    if (proposal.action === "reply" || proposal.action === "refund_and_reply") {
      const r = await callTool("draft_reply", { body: proposal.reply_text }, { ticketId: id });
      if (!r.ok) throw new Error(`draft_reply failed: ${r.error.message}`);
    }
    return { proposal };
  };

  const finalize = async (state: S): Promise<Partial<S>> => {
    const id = state.ticketId;
    const risk = state.risk!;
    let status: string;
    let finalAction: string | null;
    if (state.decision?.verdict === "reject") {
      status = "rejected";
      finalAction = null;
    } else if (risk.final_action === "escalate") {
      status = "escalated";
      finalAction = "escalate";
      // The summary and reasons go to the log for a person. No draft is ever saved for an escalation.
      await audit(id, "decision", "escalate", null, { summary: state.triage_result?.summary ?? null, reasons: risk.reasons });
    } else {
      status = "resolved";
      finalAction = risk.final_action;
    }
    await pool.query("UPDATE tickets SET status = $2, category = $3, final_action = $4 WHERE id = $1", [
      id,
      status,
      state.triage_result?.category ?? null,
      finalAction,
    ]);
    return {};
  };

  return new StateGraph(State)
    .addNode("triage", triageNode)
    .addNode("gather_context", gatherContext)
    .addNode("propose", propose)
    .addNode("risk_gate", riskGate)
    .addNode("await_approval", awaitApproval)
    .addNode("execute", execute)
    .addNode("finalize", finalize)
    .addEdge(START, "triage")
    .addConditionalEdges("triage", (s: S) =>
      s.flags.triage_invalid ? "risk_gate" : s.triage_result!.category === "spam" ? "propose" : "gather_context",
    )
    .addEdge("gather_context", "propose")
    .addEdge("propose", "risk_gate")
    .addConditionalEdges("risk_gate", (s: S) =>
      s.risk!.final_action === "escalate" ? "finalize" : s.risk!.needs_approval ? "await_approval" : "execute",
    )
    .addConditionalEdges("await_approval", (s: S) => (s.decision?.verdict === "reject" ? "finalize" : "execute"))
    .addEdge("execute", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

export type TriageGraph = ReturnType<typeof buildGraph>;
