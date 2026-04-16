import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { EVIDENCE_LEVEL_CONFIG } from '@/lib/gdmt/evidence-levels';
import { GdmtTabs } from './gdmt-tabs';
import { FinerenoneGuide } from '@/components/gdmt/finerenone-guide';
import { SafetyGateCard } from '@/components/gdmt/safety-gate-card';
import { NonPharmacological } from './non-pharmacological';
import { GenericBridge } from '@/components/gdmt/generic-bridge';
import { PrintSection } from './print-section';
import type { EvidenceLevel } from '@/lib/gdmt/types';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';

export const metadata: Metadata = {
  title: 'GDMT Optimization Pathway | HEARTLAND Protocol',
};

function EvidenceLegend() {
  const levels: EvidenceLevel[] = ['established', 'emerging', 'pragmatic'];
  return (
    <div className="rounded-lg border p-4 print:hidden">
      <h3 className="text-sm font-semibold mb-2">Evidence Levels</h3>
      <div className="flex flex-wrap gap-4">
        {levels.map((level) => {
          const config = EVIDENCE_LEVEL_CONFIG[level];
          return (
            <div key={level} className="flex items-center gap-2">
              <Badge variant="outline" className={config.className}>
                {config.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {config.description}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function GdmtPathwayPage() {
  return (
    <div className="space-y-8 print:space-y-4">
      {/* Screen header */}
      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          GDMT Optimization Pathway
        </h1>
        <p className="text-muted-foreground mt-1">
          Guideline-Directed Medical Therapy for Heart Failure -- Module 2
        </p>
      </div>

      {/* Evidence label legend (screen only) */}
      <EvidenceLegend />

      {/* HFrEF / HFpEF tabs (hidden in print) */}
      <div className="print:hidden">
        <GdmtTabs />
      </div>

      {/* Print-only: comprehensive output with both pathways */}
      <PrintSection />

      {/* Finerenone vs Spironolactone guide (screen + print) */}
      <section aria-labelledby="finerenone-heading" className="print:hidden">
        <h2 id="finerenone-heading" className="text-xl font-semibold mb-4">
          Finerenone vs. Spironolactone Decision Guide
        </h2>
        <FinerenoneGuide />
      </section>

      {/* Titration Safety Gates */}
      <section aria-labelledby="safety-gates-heading" className="print:hidden">
        <h2 id="safety-gates-heading" className="text-xl font-semibold mb-4">
          Titration Safety Gates
        </h2>
        <SafetyGateCard />
      </section>

      {/* Non-Pharmacological Management */}
      <section aria-labelledby="non-pharm-heading" className="print:hidden">
        <h2 id="non-pharm-heading" className="text-xl font-semibold mb-4">
          Non-Pharmacological Management
        </h2>
        <NonPharmacological />
      </section>

      {/* Generic Bridge */}
      <section aria-labelledby="generic-bridge-heading" className="print:hidden">
        <h2 id="generic-bridge-heading" className="text-xl font-semibold mb-4">
          Generic Bridge (~$15/month)
        </h2>
        <GenericBridge />
      </section>

      <ProviderPageDisclaimer />
    </div>
  );
}
