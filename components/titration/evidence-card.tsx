import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { HOZHO_TRIAL } from '@/lib/titration/constants';

export function EvidenceCard() {
  return (
    <Card data-testid="hozho-evidence-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>
            {HOZHO_TRIAL.name} ({HOZHO_TRIAL.year})
          </CardTitle>
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-700"
            aria-label="Evidence level: Established"
            title="Randomized controlled trial validating telephone-based titration"
          >
            Established
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {HOZHO_TRIAL.parameters.map((param) => {
              const isKeyFinding =
                param.parameter === 'Absolute Increase' ||
                param.parameter === 'Telehealth Completion';

              return (
                <TableRow key={param.parameter}>
                  <TableCell className="font-medium">{param.parameter}</TableCell>
                  <TableCell className={isKeyFinding ? 'font-semibold text-emerald-700' : ''}>
                    {param.result}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Source: HEARTLAND Protocol v3.3, Module 3, Section 3.1
        </p>
      </CardContent>
    </Card>
  );
}
