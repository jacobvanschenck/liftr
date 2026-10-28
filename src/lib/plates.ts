export const BAR_WEIGHT = 45;

export const PLATES = [45, 35, 25, 10, 5, 2.5] as const;

export type PlateWeight = (typeof PLATES)[number];

export type PlateCounts = Partial<Record<PlateWeight, number>>;

export type PlateSpec = {
  weight: PlateWeight;
  color: string;
  height: number;
  width: number;
};

/**
 * One source of truth for the bar, the plate weights, and the visual plate
 * specs used by the session logger and the equipment illustration.
 */
export const PLATE_SPECS: readonly PlateSpec[] = [
  { weight: 45, color: '#2F6FED', height: 82, width: 10 },
  { weight: 35, color: '#F5C542', height: 68, width: 9 },
  { weight: 25, color: '#37C26A', height: 56, width: 8 },
  { weight: 10, color: '#D8D8DE', height: 40, width: 7 },
  { weight: 5, color: '#9A9AA3', height: 32, width: 6 },
  { weight: 2.5, color: '#E85B52', height: 26, width: 5 },
];

export function barbellLoad(plates: PlateCounts): number {
  let total = BAR_WEIGHT;
  for (const plate of PLATES) {
    total += 2 * plate * (Number(plates[plate]) || 0);
  }
  return Math.round(total * 100) / 100;
}

export function decomposeBarbell(load: number): PlateCounts | null {
  const perSide = (Number(load) - BAR_WEIGHT) / 2;
  if (!Number.isFinite(perSide) || perSide < -0.001) return null;

  const counts: PlateCounts = {};
  let remaining = Math.round(perSide * 100) / 100;

  for (const plate of PLATES) {
    let count = 0;
    while (remaining + 0.001 >= plate && count < 20) {
      remaining = Math.round((remaining - plate) * 100) / 100;
      count += 1;
    }
    if (count > 0) counts[plate] = count;
  }

  if (Math.abs(remaining) > 0.011) return null;
  return counts;
}
