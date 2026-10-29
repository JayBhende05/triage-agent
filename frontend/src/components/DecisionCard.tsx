// The proposal and, while the approval is pending, the only place a reviewer can act.
// Edits are optional: an untouched field is not sent, so the backend applies the model's values.
import { useState } from "react";
import { messageFor, type Approval, type Decision, type Proposal } from "../api/client";
import { useDecide } from "../api/hooks";
import { actionLabel, inr } from "../lib/format";
import { Chip, ReasonChips, Section } from "./ui";
import { useToast } from "./Toasts";

type Props = {
  proposal: Proposal;
  approval: Approval | null;
  ownerOk: boolean | null; // does the looked-up order belong to the sender? null = unknown
  onDecided: (ticketId: number, verdict: Decision["verdict"]) => void;
};

export function DecisionCard({ proposal, approval, ownerOk, onDecided }: Props) {
  const pending = approval?.status === "pending";
  const canEditRefund = proposal.action === "refund_and_reply";
  const canEditReply = proposal.action === "reply" || proposal.action === "refund_and_reply";

  const [amount, setAmount] = useState(proposal.refund_amount_inr?.toString() ?? "");
  const [reply, setReply] = useState(proposal.reply_text ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const decide = useDecide();
  const toast = useToast();

  const submit = (verdict: Decision["verdict"]) => {
    if (!approval) return;
    const body: Decision = { verdict };
    if (verdict === "approve") {
      if (canEditRefund && amount.trim() !== (proposal.refund_amount_inr?.toString() ?? "")) {
        body.refund_amount_inr = amount.trim();
      }
      if (canEditReply && reply !== (proposal.reply_text ?? "")) body.reply_text = reply;
    }
    setFormError(null);
    decide.mutate(
      { approvalId: approval.id, body },
      {
        onSuccess: () => onDecided(approval.ticket_id, verdict),
        onError: (err) => {
          const m = messageFor(err);
          if (m) setFormError(m);
          else toast("Could not record the decision.", "error");
        },
      },
    );
  };

  return (
    <Section
      title={pending ? "Proposed action — needs your decision" : "Proposed action"}
      aside={<ReasonChips reasons={approval?.reasons} />}
    >
      <div
        className={`space-y-3 rounded-lg border bg-white p-4 ${
          pending ? "border-indigo-300 ring-1 ring-indigo-100" : "border-zinc-200"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{actionLabel(proposal.action)}</span>
          {proposal.order_id !== null && <Chip>order #{proposal.order_id}</Chip>}
          {ownerOk === false && <Chip tone="risk">order belongs to someone else</Chip>}
          {approval && approval.status !== "pending" && (
            <Chip tone={approval.status === "approved" ? "good" : "neutral"}>{approval.status}</Chip>
          )}
        </div>

        {canEditRefund && (
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Refund amount (INR)</span>
            {pending ? (
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-zinc-300 px-2.5 py-1.5 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            ) : (
              <span className="mt-1 block font-mono">{inr(proposal.refund_amount_inr)}</span>
            )}
          </label>
        )}

        {canEditReply && (
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Reply to customer</span>
            {pending ? (
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={6}
                className="mt-1 block w-full rounded-md border border-zinc-300 px-2.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-zinc-800">{proposal.reply_text}</p>
            )}
          </label>
        )}

        {!canEditRefund && !canEditReply && (
          <p className="text-sm text-zinc-600">
            {proposal.action === "close_spam"
              ? "The message will be closed as spam. No reply is sent."
              : "A person will pick this up. No reply is drafted."}
          </p>
        )}

        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            {formError}
          </p>
        )}

        {pending && (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => submit("approve")}
              className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={decide.isPending}
              onClick={() => submit("reject")}
              className="rounded-md border border-zinc-300 bg-white px-3.5 py-1.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}
