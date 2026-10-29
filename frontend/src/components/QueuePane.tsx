// The left pane answers "what needs me next?". Pending (awaiting approval) is oldest first;
// All is newest first. Clicking a row selects it via ?ticket=.
import { useState } from "react";
import { useTickets } from "../api/hooks";
import type { TicketSummary } from "../api/client";
import { actionLabel, words } from "../lib/format";
import { Chip, ReasonChips, Skeleton, Spinner, StatusChip } from "./ui";

type Tab = "pending" | "all";

type Props = {
  selected: number | null;
  onSelect: (ticketId: number) => void;
  onNew: () => void;
};

export function QueuePane({ selected, onSelect, onNew }: Props) {
  const [tab, setTab] = useState<Tab>("pending");
  const tickets = useTickets();
  const all = tickets.data ?? [];
  const pending = all.filter((t) => t.status === "awaiting_approval").reverse();
  const rows = tab === "pending" ? pending : all;

  return (
    <aside className="flex min-h-0 flex-col border-r border-zinc-200 bg-zinc-50/60">
      <nav className="flex items-center gap-1 border-b border-zinc-200 px-3 pt-2" aria-label="Queue">
        {(["pending", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              tab === t
                ? "border-indigo-600 text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t}
            {t === "pending" && pending.length > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
                {pending.length}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={onNew}
          className="mb-1 ml-auto rounded-md px-2.5 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
        >
          + New ticket
        </button>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tickets.isPending ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-zinc-500">
            {tab === "pending"
              ? "Nothing is waiting for you. Run a new ticket to see the agent work."
              : "No tickets yet."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {rows.map((t) => (
              <Row key={t.id} ticket={t} active={t.id === selected} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function Row({
  ticket,
  active,
  onSelect,
}: {
  ticket: TicketSummary;
  active: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(ticket.id)}
        aria-current={active ? "true" : undefined}
        className={`block w-full px-4 py-3 text-left hover:bg-white ${
          active ? "bg-white shadow-[inset_3px_0_0_0_theme(colors.indigo.600)]" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-zinc-900">
            <span className="mr-1.5 font-mono text-xs text-zinc-400">#{ticket.id}</span>
            {ticket.subject}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {ticket.status === "running" && <Spinner />}
            <StatusChip status={ticket.status} />
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
          <span className="truncate">{ticket.from_email}</span>
          {ticket.category && <Chip>{words(ticket.category)}</Chip>}
          {ticket.final_action && <Chip tone="info">{actionLabel(ticket.final_action)}</Chip>}
        </div>
        {ticket.status === "awaiting_approval" && (
          <div className="mt-1.5">
            <ReasonChips reasons={ticket.reasons} />
          </div>
        )}
      </button>
    </li>
  );
}
