'use client';

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { TITRATION_DECISIONS } from '@/lib/titration/constants';
import type { VitalSigns } from '@/lib/titration/types';
import { cn } from '@/lib/utils';

interface TitrationDecisionTableProps {
  highlightVitals?: VitalSigns;
}

/**
 * Determines which decision row index matches the given vitals.
 * Returns -1 if no highlight should apply.
 */
function getHighlightedRow(vitals?: VitalSigns): number {
  if (!vitals) return -1;

  // Check SBP ranges first
  if (vitals.sbp < 90) return 2; // SBP <90
  if (vitals.sbp < 100) return 1; // SBP 90-99
  if (vitals.sbp >= 100) {
    // Check other parameters before defaulting to row 0
    if (vitals.hr < 50) return 3;
    if (vitals.potassium > 5.5) return 5;
    if (vitals.potassium >= 5.0) return 4;
    if (
      vitals.creatinineBaseline &&
      vitals.creatinineBaseline > 0 &&
      ((vitals.creatinine - vitals.creatinineBaseline) / vitals.creatinineBaseline) * 100 > 30
    ) {
      return 6;
    }
    return 0; // SBP >= 100 AND asymptomatic
  }

  return -1;
}

export function TitrationDecisionTable({ highlightVitals }: TitrationDecisionTableProps) {
  const highlightedRow = getHighlightedRow(highlightVitals);

  return (
    <div data-testid="titration-decision-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Parameter</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TITRATION_DECISIONS.map((decision, index) => (
            <TableRow
              key={decision.parameter}
              className={cn(index === highlightedRow && 'bg-yellow-50 dark:bg-yellow-950/20')}
            >
              <TableCell className="font-medium">{decision.parameter}</TableCell>
              <TableCell>{decision.action}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        Source: HEARTLAND Protocol v3.3, Module 3, Section 3.3
      </p>
    </div>
  );
}
