// One page: top bar, then the queue (left) and one ticket's evidence (right).
// Each pane scrolls on its own. Background work never blocks the page: polling shows progress.
import { useCallback, useState } from "react";
import { isApiError } from "./api/client";
import { useHealth, useTickets } from "./api/hooks";
import { NewTicketForm } from "./components/NewTicketForm";
import { QueuePane } from "./components/QueuePane";
import { TicketDetail } from "./components/TicketDetail";
import { useToast } from "./components/Toasts";
import { useSelectedTicket } from "./lib/useSelectedTicket";

export default function App() {
  const [selected, select] = useSelectedTicket();
  const [creating, setCreating] = useState(false);
  const tickets = useTickets();
  const toast = useToast();

  const onDecided = useCallback(
    (ticketId: number, verdict: "approve" | "reject") => {
      toast(verdict === "reject" ? "Rejected." : "Approved. Finishing in the background.");
      // Open the next ticket waiting for approval, so a review session keeps moving.
      const next = tickets.data?.find((t) => t.status === "awaiting_approval" && t.id !== ticketId);
      if (next) select(next.id);
    },
    [tickets.data, select, toast],
  );

  const clearSelection = useCallback(() => select(null), [select]);

  return (
    <div className="grid h-screen grid-rows-[auto_auto_1fr] bg-zinc-50 text-zinc-900">
      <TopBar />
      <NetworkBanner failed={isApiError(tickets.error, "network")} />
      <main className="grid min-h-0 grid-cols-[minmax(340px,1fr)_2fr]">
        <QueuePane selected={selected} onSelect={select} onNew={() => setCreating(true)} />
        <div className="min-h-0 overflow-y-auto bg-zinc-50">
          {selected === null ? (
            <p className="px-8 py-16 text-center text-sm text-zinc-500">
              Pick a ticket from the queue to see what the agent did.
            </p>
          ) : (
            <TicketDetail key={selected} ticketId={selected} onGone={clearSelection} onDecided={onDecided} />
          )}
        </div>
      </main>
      {creating && (
        <NewTicketForm
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            select(id);
          }}
        />
      )}
    </div>
  );
}

function TopBar() {
  const health = useHealth();
  const tickets = useTickets();
  const all = tickets.data ?? [];
  const count = (s: string) => all.filter((t) => t.status === s).length;

  return (
    <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-5 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">Triage Desk</h1>
        <span className="text-xs text-zinc-500">The model proposes; code decides; you approve.</span>
      </div>
      <div className="ml-auto flex items-center gap-4 text-xs text-zinc-500">
        <span>{count("awaiting_approval")} awaiting</span>
        <span>{count("resolved")} resolved</span>
        <span>{count("escalated")} escalated</span>
        <span>{count("failed")} failed</span>
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${health.data?.ok ? "bg-emerald-500" : "bg-zinc-300"}`} />
          API
        </span>
      </div>
    </header>
  );
}

/** Shown while the API is unreachable; the data on screen stays and polling keeps retrying. */
function NetworkBanner({ failed }: { failed: boolean }) {
  if (!failed) return <div />;
  return (
    <div role="alert" className="bg-amber-100 px-5 py-1.5 text-center text-sm text-amber-900">
      Can't reach the server. Retrying...
    </div>
  );
}
