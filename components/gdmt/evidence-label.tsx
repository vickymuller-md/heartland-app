import { Badge } from '@/components/ui/badge';
import { EVIDENCE_LEVEL_CONFIG } from '@/lib/gdmt/evidence-levels';
import type { EvidenceLevel } from '@/lib/gdmt/types';

interface EvidenceLabelProps {
  level: EvidenceLevel;
}

export function EvidenceLabel({ level }: EvidenceLabelProps) {
  const config = EVIDENCE_LEVEL_CONFIG[level];
  return (
    <Badge
      variant="outline"
      className={config.className}
      aria-label={`Evidence level: ${config.label}`}
      title={config.description}
    >
      {config.label}
    </Badge>
  );
}
