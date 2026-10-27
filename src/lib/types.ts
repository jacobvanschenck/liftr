export type EquipmentCategory = 'dumbbell' | 'barbell' | 'machine';
export type SessionStatus = 'inProgress' | 'completed';

export type Member = {
  id: string;
  familyId: string;
  authUserId: string | null;
  email: string | null;
  name: string;
  timezone: string;
  createdAt: number;
};

export type Exercise = {
  id: string;
  familyId: string;
  name: string;
  normalizedName: string;
  equipmentCategory: EquipmentCategory;
  isCore: boolean;
  archivedAt: number | null;
  createdAt: number;
};

export type RoutineSummary = {
  id: string;
  name: string;
  exerciseCount: number;
};

export type RoutineExercise = {
  exerciseId: string;
  name: string;
  equipmentCategory: EquipmentCategory;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
};

export type Routine = {
  id: string;
  name: string;
  exercises: RoutineExercise[];
};

export type CompletedSet = {
  id: string;
  position: number;
  repetitions: number;
  load: number;
};

export type SessionExercise = {
  id: string;
  exerciseId: string | null;
  name: string;
  equipmentCategory: EquipmentCategory;
  position: number;
  targetSetCount: number;
  targetRepMin: number | null;
  targetRepMax: number | null;
  sets: CompletedSet[];
  previousSet: { repetitions: number; load: number } | null;
};

export type ActiveSession = {
  id: string;
  routineName: string;
  trainingDate: string;
  exercises: SessionExercise[];
};

export type BodyMetric = {
  id: string;
  key: string;
  label: string;
  unit: 'lb' | 'in';
  position: number;
  isActive: boolean;
};

export type BodyValue = {
  metricId: string;
  value: number;
};

export type BodyEntry = {
  date: string;
  values: BodyValue[];
};

export type BodySeries = {
  metricId: string;
  points: { date: string; value: number }[];
};
