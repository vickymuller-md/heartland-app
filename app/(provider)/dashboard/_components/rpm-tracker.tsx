/**
 * RpmTracker -- remote-monitoring data completeness (server component)
 *
 * Shows app-entry consistency and GDMT optimization rate. It does not decide
 * billing eligibility because entries may be manually reported.
 *
 * Requirements: METR-03 (RPM eligibility), METR-05 (billing estimates), METR-02 (GDMT rate)
 */

import { createClient } from '@/lib/supabase/server';
import {
  getRpmDataCompletenessPatients,
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

  const complete = await getRpmDataCompletenessPatients(supabase, patientIds);

  // Get GDMT optimization rate from provider metrics
  const metrics = await getProviderMetrics(supabase, providerId);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Remote Monitoring Data Completeness</CardTitle>
        <CardDescription>
          Patients with {'\u2265'}16 distinct HEARTLAND entry days this month
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {complete.length === 0 ? (
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
              {complete.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">
                    {patient.full_name}
                  </TableCell>
                  <TableCell className="text-right">
                    {patient.vitals_days_this_month}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      16+ entry days
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          This count is a workflow signal, not RPM billing eligibility. Manual app entries do not prove a qualifying connected device or automatic transmission. Verify current CMS and payer requirements independently.
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
