/**
 * RpmTracker -- RPM Billing Tracker (server component)
 *
 * Shows patients eligible for CPT 99454 (>=16 vitals days/month),
 * estimated monthly revenue, and GDMT optimization rate.
 *
 * Requirements: METR-03 (RPM eligibility), METR-05 (billing estimates), METR-02 (GDMT rate)
 */

import { createClient } from '@/lib/supabase/server';
import {
  getRpmEligiblePatients,
  computeBillingSummary,
  getProviderMetrics,
} from '@/lib/dashboard/metrics-queries';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface RpmTrackerProps {
  providerId: string;
}

export async function RpmTracker({ providerId }: RpmTrackerProps) {
  const supabase = await createClient();

  // Fetch linked patient IDs
  const { data: links } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  const patientIds = (links ?? []).map((l) => l.patient_id);

  // Get RPM eligible patients and billing summary
  const eligible = await getRpmEligiblePatients(supabase, patientIds);
  const billing = computeBillingSummary(eligible.length);

  // Get GDMT optimization rate from provider metrics
  const metrics = await getProviderMetrics(supabase, providerId);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>RPM Billing Tracker — CPT 99454</CardTitle>
        <CardDescription>
          Patients with {'\u2265'}16 vitals days this month
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No patients have reached 16 days of data this month yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient Name</TableHead>
                <TableHead className="text-right">Days Logged</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eligible.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">
                    {patient.full_name}
                  </TableCell>
                  <TableCell className="text-right">
                    {patient.vitals_days_this_month}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="default" className="bg-green-600">
                      Eligible
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Billing estimate */}
        {eligible.length > 0 && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="font-medium text-foreground">
              Estimated monthly revenue: ~${billing.lowEstimate.toLocaleString()}
              &ndash;${billing.highEstimate.toLocaleString()} ({eligible.length}{' '}
              patient{eligible.length !== 1 ? 's' : ''})
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Estimated ~$150&ndash;200/eligible patient/month (G0511, rural).
          Actual reimbursement varies by payer.
        </p>

        {/* GDMT Optimization Rate */}
        <div className="border-t pt-3">
          <p className="text-sm font-medium text-foreground">
            GDMT Optimization Rate
          </p>
          {metrics.gdmtOptRate === 0 && metrics.totalPatients > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              N/A — no HFrEF patients classified
            </p>
          ) : metrics.totalPatients === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              N/A — no linked patients
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              {metrics.gdmtOptRate}% of HFrEF patients on {'\u2265'}3 of 4 drug
              classes
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
