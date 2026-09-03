/** Small shared formatters. */

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "3 days ago" without pulling in a relative-time dependency. */
export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["month", 2_592_000_000],
    ["year", 31_536_000_000],
  ];
  let chosen: [Intl.RelativeTimeFormatUnit, number] = table[0]!;
  for (const entry of table) if (diff >= entry[1]) chosen = entry;
  return rtf.format(-Math.round(diff / chosen[1]), chosen[0]);
}

export const STATUS_COLOR: Record<string, string> = {
  draft: "gray",
  published: "green",
  unpublished: "yellow",
  disabled: "red",
  deleting: "orange",
  delete_failed: "red",
};
