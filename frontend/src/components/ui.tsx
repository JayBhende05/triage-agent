// Small shared pieces. Colour rules: amber means risk (reasons, retries, errors); the one
// accent (indigo) marks where the reviewer acts. Everything else stays neutral.
import type { ReactNode } from "react";
import { words } from "../lib/format";

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

type Tone = "neutral" | "risk" | "good" | "bad" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-200",
  risk: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-300",
  good: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  bad: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
  info: "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200",
};

const STATUS_TONES: Record<string, Tone> = {
  new: "neutral",
  running: "info",
  awaiting_approval: "risk",
  resolved: "good",
  escalated: "risk",
  rejected: "neutral",
  failed: "bad",
};

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={STATUS_TONES[status] ?? "neutral"}>{words(status)}</Chip>;
}

export function ReasonChips({ reasons }: { reasons: string[] | undefined | null }) {
  if (!reasons?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Chip key={r} tone="risk">
          {words(r)}
        </Chip>
      ))}
    </span>
  );
}

export function Spinner({ label = "Running" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block size-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200/70 ${className}`} />;
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
