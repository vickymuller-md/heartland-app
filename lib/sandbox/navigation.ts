import { SANDBOX_PATIENTS, SANDBOX_SECTIONS } from './fixtures';
import { POPULATION_SIZES, type PopulationSize } from './population';
import { SANDBOX_DAY_COUNT } from './day-selectors';
import type { SandboxDemoState, SandboxSectionId } from './types';

export function selectSandboxSection(state: SandboxDemoState, selectedSection: SandboxSectionId): SandboxDemoState {
  return {
    ...state,
    selectedSection,
    visitedSections: state.visitedSections.includes(selectedSection) ? state.visitedSections : [...state.visitedSections, selectedSection],
  };
}

export function sandboxStateFromUrl(saved: SandboxDemoState, url: URL): SandboxDemoState {
  const area = SANDBOX_SECTIONS.find(({ id }) => id === url.searchParams.get('area'));
  if (!area) return saved;
  const next = selectSandboxSection(saved, area.id);
  if (area.id === 'patient-360' || area.id === 'patient-view') {
    const patient = SANDBOX_PATIENTS.find(({ id }) => id === url.searchParams.get('person'));
    if (patient) next.selectedPatientId = patient.id;
  }
  if (area.id === 'command') {
    next.completedRound = undefined;
    const size = Number(url.searchParams.get('size')) as PopulationSize;
    const day = Number(url.searchParams.get('day'));
    if (POPULATION_SIZES.includes(size) && Number.isInteger(day) && day >= 1 && day <= SANDBOX_DAY_COUNT) {
      next.populationSize = size;
      next.dayIndex = day - 1;
      if (url.searchParams.get('round') === '1') {
        const value = url.searchParams.get('case');
        const caseOrdinal = value !== null && /^\d{1,4}$/.test(value) && Number(value) < size ? Number(value) : null;
        next.completedRound = { size, dayIndex: next.dayIndex, caseOrdinal };
      }
    }
  }
  return next;
}

export function sandboxUrlFromState(url: URL, state: SandboxDemoState): URL {
  const next = new URL(url);
  for (const field of ['day', 'size', 'round', 'case', 'person']) next.searchParams.delete(field);
  next.searchParams.set('area', state.selectedSection);
  if (state.selectedSection === 'patient-360' || state.selectedSection === 'patient-view') {
    next.searchParams.set('person', state.selectedPatientId);
  }
  if (state.selectedSection === 'command') {
    next.searchParams.set('day', String(state.dayIndex + 1));
    next.searchParams.set('size', String(state.populationSize));
    if (state.completedRound?.size === state.populationSize && state.completedRound.dayIndex === state.dayIndex) {
      next.searchParams.set('round', '1');
      if (state.completedRound.caseOrdinal !== null) next.searchParams.set('case', String(state.completedRound.caseOrdinal));
    }
  }
  return next;
}
