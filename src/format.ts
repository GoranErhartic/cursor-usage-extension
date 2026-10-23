export function formatCents(cents: number): string {
  const dollars = cents / 100;
  const fixed = dollars.toFixed(2);
  if (fixed.endsWith(".00")) {
    return `$${Math.round(dollars)}`;
  }
  return `$${fixed}`;
}

export function formatUsage(used: number, limit: number): string {
  if (limit <= 0) {
    return formatCents(used);
  }
  return `${formatCents(used)}/${formatCents(limit)}`;
}

export function percentUsed(used: number, limit: number): number | null {
  if (limit <= 0) {
    return null;
  }
  return (used / limit) * 100;
}
