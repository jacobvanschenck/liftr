export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeName(value: string): string {
  return cleanName(value).toLowerCase();
}

export function firstName(value: string): string {
  return cleanName(value).split(/\s+/)[0] || 'there';
}
