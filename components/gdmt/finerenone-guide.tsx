import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  FINERENONE_FDA_LABEL_URL,
  FINERENONE_SCENARIOS,
  FINERENONE_DOSING,
  FINERENONE_CONTRAINDICATIONS,
  FINERENONE_INTERACTIONS,
  FINERENONE_MONITORING,
} from '@/lib/gdmt/constants';

export function FinerenoneGuide() {
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Navigation aid only. Verify the current FDA label and applicable HF guideline; no row is an individual treatment recommendation.{' '}
        <a href={FINERENONE_FDA_LABEL_URL} target="_blank" rel="noreferrer" className="underline">FDA label (July 2025)</a>
      </p>

      {/* Dose by eGFR at initiation (KERENDIA label 2.3 and Table 1) */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Dose in heart failure with LVEF &ge;40%, by eGFR at initiation
        </h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>eGFR at initiation</TableHead>
                <TableHead>Starting dose</TableHead>
                <TableHead>Target dose</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FINERENONE_DOSING.bands.map((band) => (
                <TableRow key={band.label}>
                  <TableCell className="font-medium whitespace-normal">{band.label}</TableCell>
                  <TableCell className="whitespace-normal">{band.startingDose}</TableCell>
                  <TableCell className="whitespace-normal">{band.targetDose}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">{FINERENONE_DOSING.belowThresholdAction}</p>
        <p className="text-sm text-muted-foreground">{FINERENONE_DOSING.titrationRule}</p>
      </section>

      {/* Contraindications and interactions (KERENDIA label 4, 7.1, 8.6) */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Contraindications</h3>
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {FINERENONE_CONTRAINDICATIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Interactions and hepatic impairment</h3>
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {FINERENONE_INTERACTIONS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Laboratory monitoring (label minimum + protocol schedule) */}
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Potassium and eGFR monitoring</h3>
        <p className="text-sm text-muted-foreground">{FINERENONE_MONITORING.labelMinimum}</p>
        <p className="text-sm text-muted-foreground">{FINERENONE_MONITORING.protocolAddition}</p>
      </section>

      <h3 className="text-sm font-semibold">Agent selection scenarios</h3>
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Clinical Scenario</TableHead>
            <TableHead>Suggested Approach</TableHead>
            <TableHead>Rationale</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {FINERENONE_SCENARIOS.map((scenario) => (
            <TableRow key={scenario.clinicalScenario}>
              <TableCell className="font-medium whitespace-normal">
                {scenario.clinicalScenario}
              </TableCell>
              <TableCell className="whitespace-normal">
                {scenario.suggestedApproach}
              </TableCell>
              <TableCell className="whitespace-normal">
                {scenario.rationale}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
