import type { EvidenceLevel } from './types';

export const EVIDENCE_LEVEL_CONFIG: Record<
  EvidenceLevel,
  { label: string; className: string; description: string }
> = {
  established: {
    label: 'Established',
    className: 'bg-green-100 text-green-800 border-green-300',
    description: 'Supported by major guideline recommendations and multiple large RCTs',
  },
  emerging: {
    label: 'Emerging',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    description: 'Supported by recent trial evidence; guideline integration ongoing',
  },
  pragmatic: {
    label: 'Pragmatic',
    className: 'bg-gray-100 text-gray-700 border-gray-300',
    description: 'Based on clinical experience and practical considerations',
  },
};
