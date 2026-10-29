// All network code goes through request(): it prefixes /api, parses JSON and turns every
// failure into an ApiError carrying the backend's error code. Components never fetch.

export type TicketStatus =
  | "new"
  | "running"
  | "awaiting_approval"
  | "resolved"
  | "escalated"
  | "rejected"
  | "failed";

export type Action = "reply" | "refund_and_reply" | "close_spam" | "escalate";

export type Proposal = {
  action: Action;
  order_id: number | null;
  refund_amount_inr: string | number | null;
  reply_text: string | null;
};

export type TicketSummary = {
  id: number;
  from_email: string;
  subject: string;
  status: TicketStatus;
  category: string | null;
  final_action: string | null;
  approval_id: number | null;
  reasons: string[] | null;
};

export type Ticket = Omit<TicketSummary, "approval_id" | "reasons"> & {
  body: string;
  draft_reply: string | null;
};

export type Decision = {
  verdict: "approve" | "reject";
  refund_amount_inr?: string;
  reply_text?: string;
};

export type Approval = {
  id: number;
  ticket_id: number;
  proposal: Proposal;
  reasons: string[];
  status: "pending" | "approved" | "rejected";
  decision: Decision | null;
};

export type Refund = {
  id: number;
  ticket_id: number;
  order_id: number;
  amount_inr: string;
  idempotency_key: string;
};

export type AuditRow = {
  id: number;
  ticket_id: number;
  kind: "llm" | "tool" | "decision";
  name: string;
  input: unknown;
  output: unknown;
  created_at: string;
};

export type TicketDetail = {
  ticket: Ticket;
  proposal: Proposal | null;
  approval: Approval | null;
  refunds: Refund[];
  audit: AuditRow[];
};

export type NewTicket = { from_email: string; subject: string; body: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Options = { method?: "GET" | "POST"; json?: unknown; signal?: AbortSignal };

export async function request<T>(path: string, { method = "GET", json, signal }: Options = {}) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: json === undefined ? undefined : { "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "Can't reach the server.");
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body as T;

  const error = (body as { error?: { code: string; message: string } } | null)?.error;
  if (!error) {
    // The API always sends its error shape; without it a 5xx came from the dev proxy (API down).
    const code = response.status >= 500 ? "network" : "http_error";
    throw new ApiError(response.status, code, response.statusText || "Request failed");
  }
  throw new ApiError(response.status, error.code, error.message);
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

/** What the reviewer sees for an error. null means "show nothing". */
export function messageFor(err: unknown): string | null {
  if (!(err instanceof ApiError)) return "Something went wrong.";
  switch (err.code) {
    case "network":
      return "Can't reach the server. Retrying...";
    case "ticket_not_found":
    case "approval_not_found":
      return "That ticket no longer exists.";
    case "not_runnable":
      return null; // it already started: the next poll shows it
    case "already_decided":
      return "Someone already decided this ticket.";
    case "invalid_edit":
    case "invalid_request":
      return err.message;
    default:
      return "Something went wrong.";
  }
}
