import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { BILLING_CODES, CMS_2026_PFS_URL } from '@/lib/remote-monitoring/constants';

export function BillingCodesTable() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Remote Monitoring Billing Navigation</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Verification required</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BILLING_CODES.map((code) => (
              <TableRow key={code.code}>
                <TableCell className="font-mono font-medium">
                  {code.code}
                </TableCell>
                <TableCell>{code.description}</TableCell>
                <TableCell>{code.verification}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Reference only — not a billing eligibility determination.</p>
          <p className="mt-1">
            Patient-entered HEARTLAND data does not by itself establish RPM eligibility. Verify current CMS descriptors,
            connected-device and automatic-transmission requirements, supervision, time, consent, documentation, and payer policy.
          </p>
          <a href={CMS_2026_PFS_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">
            CMS CY 2026 Physician Fee Schedule
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
