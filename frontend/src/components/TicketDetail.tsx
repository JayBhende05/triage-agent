// One ticket's evidence: the customer's message, what the agent concluded, what it wants to do,
// what actually happened (refunds, final reply) and the full step trace.
import type { AuditRow, Decision, TicketDetail as Detail } from "../api/client";
import { isApiError, messageFor } from "../api/client";
import { useRunTicket, useTicket } from "../api/hooks";
import { actionLabel, explainFailure, inr, words } from "../lib/format";
import { DecisionCard } from "./DecisionCard";
import { TraceTimeline } from "./TraceTimeline";
import { useToast } from "./Toasts";
import { Chip, Section, Skeleton, Spinner, StatusChip } from "./ui";

type Props = {
  ticketId: number;
  onGone: () => void;
  onDecided: (ticketId: number, verdict: Decision["verdict"]) => void;
};

type Triage = { category: string; confidence: number; summary: string };

/** The model's triage and the owner check come from the audit rows the tools and gate wrote. */
function facts(audit: AuditRow[], senderEmail: string) {
  const gate = [...audit].reverse().find((r) => r.name === "risk_gate");
  const triage = (gate?.input as { triage?: Triage | null } | null)?.triage ?? null;
  const orders = audit
    .filter((r) => r.name === "lookup_order")
    .map((r) => (r.output as { ok?: boolean; data?: { id: number; status: string; total_inr: string; owner_email: string } })?.data)
    .filter((o): o is NonNullable<typeof o> => !!o);
  const failure = [...audit].reverse().find((r) => r.name === "error");
  const message = (failure?.output as { message?: string } | null)?.message ?? null;
  return { triage, orders, message, sender: senderEmail.toLowerCase() };
}

export function TicketDetail({ ticketId, onGone, onDecided }: Props) {
  const query = useTicket(ticketId);
  const run = useRunTicket();
  const toast = useToast();

  if (query.isPending) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (query.isError) {
    if (isApiError(query.error, "ticket_not_found")) {
      return (
        <div className="p-8 text-sm text-zinc-600">
          That ticket no longer exists.{" "}
          <button type="button" className="text-indigo-700 underline" onClick={onGone}>
            Back to the queue
          </button>
        </div>
      );
    }
    return <p className="p-8 text-sm text-amber-800">{messageFor(query.error)}</p>;
  }

  const d: Detail = query.data;
  const { ticket, approval, proposal, refunds, audit } = d;
  const { triage, orders, message, sender } = facts(audit, ticket.from_email);
  const proposedOrder = proposal?.order_id != null ? orders.find((o) => o.id === proposal.order_id) : undefined;
  const ownerOk = proposedOrder ? proposedOrder.owner_email.toLowerCase() === sender : null;
  const canRun = ticket.status === "new" || ticket.status === "failed";
  const explained = ticket.status === "failed" ? explainFailure(message) : null;

  return (
    <article className="mx-auto max-w-3xl space-y-6 px-8 py-6">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold leading-snug">
            <span className="mr-2 font-mono text-sm text-zinc-400">#{ticket.id}</span>
            {ticket.subject}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {ticket.status === "running" && <Spinner />}
            <StatusChip status={ticket.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span>{ticket.from_email}</span>
          {ticket.category && <Chip>{words(ticket.category)}</Chip>}
          {ticket.final_action && <Chip tone="info">{actionLabel(ticket.final_action)}</Chip>}
        </div>
        {canRun && (
          <button
            type="button"
            disabled={run.isPending}
            onClick={() =>
              run.mutate(ticket.id, {
                onError: (err) => {
                  const m = messageFor(err);
                  if (m) toast(m, "error");
                },
              })
            }
            className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {ticket.status === "failed" ? "Run again" : "Run agent"}
          </button>
        )}
      </header>

      {ticket.status === "failed" && (
        <div role="alert" className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-300">
          <p className="font-medium">{explained ?? "This run failed."}</p>
          {message && <p className="break-words font-mono text-xs text-amber-800">{message}</p>}
        </div>
      )}

      <Section title="Customer message">
        <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
          {ticket.body}
        </p>
      </Section>

      {triage && (
        <Section title="Agent read" aside={<span className="text-xs text-zinc-500">confidence {Math.round(triage.confidence * 100)}%</span>}>
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">{triage.summary}</p>
        </Section>
      )}

      {orders.length > 0 && (
        <Section title="Orders looked up">
          <ul className="grid gap-2 sm:grid-cols-2">
            {orders.map((o) => (
              <li key={o.id} className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Order #{o.id}</span>
                  <Chip>{o.status}</Chip>
                </div>
                <div className="mt-1 font-mono">{inr(o.total_inr)}</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                  <span className="truncate">{o.owner_email}</span>
                  {o.owner_email.toLowerCase() !== sender && <Chip tone="risk">not the sender</Chip>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {proposal && (
        <DecisionCard
          key={approval ? `${approval.id}:${approval.status}` : "none"}
          proposal={proposal}
          approval={approval}
          ownerOk={ownerOk}
          onDecided={onDecided}
        />
      )}

      {refunds.length > 0 && (
        <Section title="Refunds issued">
          <ul className="divide-y divide-zinc-200 rounded-lg border border-emerald-200 bg-emerald-50/50">
            {refunds.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>Order #{r.order_id}</span>
                <span className="font-mono font-medium">{inr(r.amount_inr)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {ticket.draft_reply && (
        <Section title="Reply saved">
          <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800">
            {ticket.draft_reply}
          </p>
        </Section>
      )}

      <Section title="Trace" aside={<span className="text-xs text-zinc-500">{audit.length} steps</span>}>
        <TraceTimeline audit={audit} />
      </Section>
    </article>
  );
}
