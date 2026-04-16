import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { COMPARISON_TABLE_DATA } from '@/lib/risk-score/constants';

/**
 * Comparison table (Table 6): HEARTLAND vs MAGGIC, GWTG-HF, SHFM.
 * Highlights the HEARTLAND column and emphasizes unique differentiators
 * (distance to care, social support, rurality).
 *
 * Hidden in print by default (reference material, not patient-specific).
 */
export function ComparisonTable() {
  return (
    <div className="print:hidden" data-testid="comparison-table-wrapper">
      <h3 className="mb-3 text-lg font-semibold">
        Comparison with Existing Risk Scores
      </h3>

      <div className="overflow-x-auto rounded-lg border" data-testid="comparison-table-scroll">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Characteristic</TableHead>
              <TableHead>MAGGIC</TableHead>
              <TableHead>GWTG-HF</TableHead>
              <TableHead>SHFM</TableHead>
              <TableHead className="bg-blue-50 font-bold">HEARTLAND</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COMPARISON_TABLE_DATA.map((row) => {
              const isHeartlandYes =
                row.heartland === 'Yes' &&
                row.maggic === 'No' &&
                row.gwtgHf === 'No' &&
                row.shfm === 'No';

              return (
                <TableRow key={row.characteristic}>
                  <TableCell className="font-medium">
                    {row.characteristic}
                  </TableCell>
                  <TableCell>{row.maggic}</TableCell>
                  <TableCell>{row.gwtgHf}</TableCell>
                  <TableCell>{row.shfm}</TableCell>
                  <TableCell
                    className={`bg-blue-50 ${isHeartlandYes ? 'font-semibold text-green-700' : ''}`}
                  >
                    {row.heartland}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        The HEARTLAND framework uniquely incorporates geographic and social
        determinants that are absent from traditional prognostic scores.
      </p>
    </div>
  );
}
