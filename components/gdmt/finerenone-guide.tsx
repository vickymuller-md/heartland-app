import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { FINERENONE_SCENARIOS } from '@/lib/gdmt/constants';

export function FinerenoneGuide() {
  return (
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
  );
}
