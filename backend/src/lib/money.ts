/** Money is compared as integer paise. A float never touches an amount. */

/** "499", "499.5", "499.50" or 499.5 -> 49950. Anything else (negative, 3 decimals, text) -> null. */
export function toPaise(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

export function fromPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  return `${whole}.${String(paise % 100).padStart(2, "0")}`;
}
