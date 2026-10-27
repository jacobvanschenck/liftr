const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Monday-based week start in the given time zone. */
export function startOfWeek(date: Date, timeZone: string): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [year, month, day] = today.split('-').map(Number);
  const local = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const offset = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - offset);
  return local.toISOString().slice(0, 10);
}

export function partOfDay(date: Date, timeZone: string): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date),
  );
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function shortDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function longDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function relativeDateLabel(value: string, today: string): string {
  if (value === today) return 'Today';
  if (value === addDays(today, -1)) return 'Yesterday';
  return shortDate(value);
}

export function formatLoad(load: number): string {
  if (!Number.isFinite(load)) return '0';
  return Number.isInteger(load) ? String(load) : String(Number(load.toFixed(2)));
}

export function formatScore(score: number): string {
  return Math.round(score).toLocaleString('en-US');
}

export function formatVolume(volume: number): string {
  return Math.round(volume).toLocaleString('en-US');
}
