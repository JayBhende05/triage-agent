// TanStack Query hooks for every endpoint. Polling keeps the page fresh (no websockets);
// mutations invalidate what they change so the page updates without waiting for a poll.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  isApiError,
  request,
  type Decision,
  type NewTicket,
  type Ticket,
  type TicketDetail,
  type TicketStatus,
  type TicketSummary,
} from "./client";

const POLL_MS = 3000;
export const LIVE_STATUSES: TicketStatus[] = ["new", "running", "awaiting_approval"];

export const keys = {
  health: ["health"] as const,
  tickets: ["tickets"] as const,
  ticket: (id: number) => ["ticket", id] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => request<{ ok: boolean }>("/health", { signal }),
    refetchInterval: 10000,
  });
}

export function useTickets() {
  return useQuery({
    queryKey: keys.tickets,
    queryFn: ({ signal }) =>
      request<{ tickets: TicketSummary[] }>("/tickets", { signal }).then((r) => r.tickets),
    refetchInterval: POLL_MS,
  });
}

/** Polls while the ticket can still change; a finished ticket's query goes idle. */
export function useTicket(id: number | null) {
  return useQuery({
    queryKey: keys.ticket(id ?? 0),
    queryFn: ({ signal }) => request<TicketDetail>(`/tickets/${id}`, { signal }),
    enabled: id !== null,
    retry: (count, err) => !isApiError(err, "ticket_not_found") && count < 1,
    refetchInterval: (query) => {
      const status = query.state.data?.ticket.status;
      return status === undefined || LIVE_STATUSES.includes(status) ? POLL_MS : false;
    },
  });
}

function refreshAll(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "health" });
}

export function useRunTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<{ id: number; status: string }>(`/tickets/${id}/run`, { method: "POST" }),
    onSettled: () => refreshAll(qc), // a 409 not_runnable just means it already started
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewTicket) => request<Ticket>("/tickets", { method: "POST", json: body }),
    onSettled: () => refreshAll(qc),
  });
}

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, body }: { approvalId: number; body: Decision }) =>
      request<{ ticket_id: number; status: string }>(`/approvals/${approvalId}/decision`, {
        method: "POST",
        json: body,
      }),
    onSettled: () => refreshAll(qc), // after a 409 too: show what the other reviewer decided
  });
}
