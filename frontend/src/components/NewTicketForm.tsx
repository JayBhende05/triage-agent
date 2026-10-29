// Create a ticket from the page, so the demo isn't limited to the six seeded ones.
import { useState, type FormEvent } from "react";
import { messageFor } from "../api/client";
import { useCreateTicket } from "../api/hooks";

export function NewTicketForm({ onCreated, onClose }: { onCreated: (id: number) => void; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTicket();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { from_email: from, subject, body },
      { onSuccess: (t) => onCreated(t.id), onError: (err) => setError(messageFor(err)) },
    );
  };

  const field =
    "mt-1 block w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-zinc-900/40 p-4" role="dialog" aria-modal="true" aria-label="New ticket">
      <form onSubmit={submit} className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold">New ticket</h2>
        <label className="block text-sm">
          <span className="text-xs font-medium text-zinc-500">From</span>
          <input required type="email" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="asha@example.com" className={field} />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-zinc-500">Subject</span>
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-zinc-500">Message</span>
          <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={field} />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md px-3.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
