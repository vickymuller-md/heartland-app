import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { FINERENONE_FDA_LABEL_URL, FINERENONE_SCENARIOS } from '@/lib/gdmt/constants';

export function FinerenoneGuide() {
  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Navigation aid only. Verify the current FDA label and applicable HF guideline; no row is an individual treatment recommendation.{' '}
        <a href={FINERENONE_FDA_LABEL_URL} target="_blank" rel="noreferrer" className="underline">FDA label (July 2025)</a>
      </p>
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
