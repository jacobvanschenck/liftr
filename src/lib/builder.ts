import type { EquipmentCategory } from './types';

export type BuilderItem = {
  exerciseId: string;
  name: string;
  equipmentCategory: EquipmentCategory;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

const EQUIPMENT = new Set<EquipmentCategory>(['dumbbell', 'barbell', 'machine']);

/**
 * A failed routine save redirects back with the draft in the query string, so
 * the form survives server-side validation without a client store.
 */
export function parseBuilderDraft(raw: string | null): BuilderItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): BuilderItem[] => {
      if (typeof item !== 'object' || item === null) return [];
      const value = item as Record<string, unknown>;
      if (
        typeof value.exerciseId !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.equipmentCategory !== 'string' ||
        !EQUIPMENT.has(value.equipmentCategory as EquipmentCategory) ||
        typeof value.targetSetCount !== 'number'
      ) {
        return [];
      }
      return [
        {
          exerciseId: value.exerciseId,
          name: value.name,
          equipmentCategory: value.equipmentCategory as EquipmentCategory,
          targetSetCount: value.targetSetCount,
          targetRepMin: typeof value.targetRepMin === 'number' ? value.targetRepMin : null,
          targetRepMax: typeof value.targetRepMax === 'number' ? value.targetRepMax : null,
        },
      ];
    });
  } catch {
    return [];
  }
}
