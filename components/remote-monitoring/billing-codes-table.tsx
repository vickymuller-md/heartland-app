import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { BILLING_CODES, REVENUE_POTENTIAL } from '@/lib/remote-monitoring/constants';

export function BillingCodesTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>RPM Billing Code Reference (2025)</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Approximate Reimbursement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BILLING_CODES.map((code) => (
              <TableRow key={code.code}>
                <TableCell className="font-mono font-medium">
                  {code.code}
                </TableCell>
                <TableCell>{code.description}</TableCell>
                <TableCell>{code.reimbursement}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Revenue potential callout */}
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-800">
            Revenue Potential: {REVENUE_POTENTIAL}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
