import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ScoreBreakdown as ScoreBreakdownType } from '@/lib/risk-score/types';

interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownType[];
}

/**
 * Breakdown table showing each variable's contribution to the total score.
 * Visible on both screen and print.
 */
export function ScoreBreakdown({ breakdown }: ScoreBreakdownProps) {
  const total = breakdown.reduce((sum, b) => sum + b.points, 0);

  return (
    <div data-testid="score-breakdown">
      <h3 className="mb-2 text-sm font-semibold">Score Breakdown</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Variable</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Points</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.map((item) => (
            <TableRow key={item.variable}>
              <TableCell
                className={item.present ? 'font-medium' : 'text-muted-foreground'}
              >
                {item.variable}
              </TableCell>
              <TableCell
                className={item.present ? 'font-medium' : 'text-muted-foreground'}
              >
                {item.present ? 'Present' : 'Absent'}
              </TableCell>
              <TableCell
                className={`text-right ${item.present ? 'font-medium' : 'text-muted-foreground'}`}
              >
                {item.present ? item.points : '0'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell>Total</TableCell>
            <TableCell />
            <TableCell className="text-right">{total}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
