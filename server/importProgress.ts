export interface ImportProgress {
  running: boolean;
  phase: string;
  currentLeg: number;
  totalLegs: number;
  importedLegs: number;
  startedAt: string;
}

let progress: ImportProgress | null = null;

export function getImportProgress(): ImportProgress | null {
  return progress;
}

export function beginImportProgress(totalLegs: number, phase = 'Förbereder import') {
  progress = {
    running: true,
    phase,
    currentLeg: 0,
    totalLegs,
    importedLegs: 0,
    startedAt: new Date().toISOString(),
  };
}

export function updateImportProgress(update: Partial<ImportProgress>) {
  if (!progress) return;
  progress = { ...progress, ...update, running: true };
}

export function finishImportProgress(importedLegs: number) {
  if (!progress) return;
  progress = {
    ...progress,
    running: false,
    importedLegs,
    phase: 'Klar',
  };
}

export function clearImportProgress() {
  progress = null;
}
