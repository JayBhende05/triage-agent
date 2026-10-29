// Display helpers. Money arrives as a string ("499.00"); it becomes a number only to be shown.
const rupees = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function inr(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return rupees.format(Number(value));
}

const ACTIONS: Record<string, string> = {
  reply: "Reply",
  refund_and_reply: "Refund + reply",
  close_spam: "Close as spam",
  escalate: "Escalate",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  return ACTIONS[action] ?? action;
}

/** "owner_mismatch" -> "owner mismatch", for statuses, categories and reason codes. */
export function words(code: string | null | undefined): string {
  return code ? code.replaceAll("_", " ") : "—";
}

export function time(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** A model-provider error in plain words; the raw message stays in the trace. */
export function explainFailure(message: string | null | undefined): string | null {
  if (!message) return null;
  if (/401|authentication|API key/i.test(message))
    return "The model rejected the API key, or none is set. Check GROQ_API_KEY in .env and restart the API.";
  if (/413|too large/i.test(message))
    return "The request is bigger than the tokens-per-minute limit. Wait a minute and run it again.";
  if (/429|quota|rate.?limit/i.test(message))
    return "The model rate limit is used up. Wait for it to reset, then run the ticket again.";
  if (/503|529|UNAVAILABLE|overloaded|high demand/i.test(message))
    return "The model provider is overloaded. Try again in a few minutes.";
  if (/504|timed? ?out/i.test(message)) return "The model call timed out. Try again.";
  if (/interrupted by restart/i.test(message))
    return "The server restarted mid-run. Run the ticket again.";
  return null;
}
