// Every step the agent took, in order, from audit_log. Amber marks a failed tool call or an
// error; the input and output of a step open on click. Rendered as text, never as HTML.
import type { AuditRow } from "../api/client";
import { time, words } from "../lib/format";
import { Chip } from "./ui";

const KIND_TONES = { llm: "info", tool: "neutral", decision: "risk" } as const;

function isFailure(row: AuditRow): boolean {
  const out = row.output as { ok?: boolean; error?: unknown } | null;
  return row.name === "error" || out?.ok === false || (row.kind === "llm" && !!out && "error" in out);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function TraceTimeline({ audit }: { audit: AuditRow[] }) {
  if (audit.length === 0) return <p className="text-sm text-zinc-500">No steps recorded yet.</p>;
  return (
    <ol className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
      {audit.map((row) => (
        <li key={row.id}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50">
              <span className="w-16 shrink-0 font-mono text-xs text-zinc-400">{time(row.created_at)}</span>
              <Chip tone={KIND_TONES[row.kind]}>{row.kind}</Chip>
              <span className="font-medium">{words(row.name)}</span>
              {isFailure(row) && <Chip tone="risk">failed</Chip>}
              <span aria-hidden className="ml-auto text-zinc-400 group-open:rotate-90">›</span>
            </summary>
            <div className="grid gap-2 border-t border-zinc-100 bg-zinc-50 px-3 py-2 md:grid-cols-2">
              <Block label="Input" value={row.input} />
              <Block label="Output" value={row.output} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 font-mono text-xs text-zinc-700 ring-1 ring-zinc-200">
        {value === null || value === undefined ? "—" : json(value)}
      </pre>
    </div>
  );
}
