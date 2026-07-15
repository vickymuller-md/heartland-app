import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RedFlagCard } from '@/components/remote-monitoring/red-flag-card';
import { BillingCodesTable } from '@/components/remote-monitoring/billing-codes-table';
import { TIM_HF2_EVIDENCE } from '@/lib/remote-monitoring/constants';

function TimHf2Card() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          TIM-HF2 Evidence ({TIM_HF2_EVIDENCE.year})
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
            Established
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {TIM_HF2_EVIDENCE.outcomes.map((o, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-lg border p-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {o.outcome}
              </span>
              <span className="text-sm font-medium">{o.result}</span>
            </div>
          ))}
        </div>

        {/* Key highlights */}
        <div className="mt-4 space-y-2">
          <div className="rounded-lg bg-blue-50 p-3 text-sm">
            <span className="font-semibold text-blue-800">Key:</span>{' '}
            <span className="text-blue-700">
              30% mortality reduction with remote monitoring (HR 0.70, 95% CI 0.50-0.96)
            </span>
          </div>
          <div className="rounded-lg bg-amber-50 p-3 text-sm">
            <span className="font-semibold text-amber-800">Rural relevance:</span>{' '}
            <span className="text-amber-700">
              Patients living farther from cardiologists benefit most from remote monitoring
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ReferenceCards() {
  return (
    <div className="space-y-6">
      {/* 2-column grid on desktop */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RedFlagCard />
        <BillingCodesTable />
      </div>

      {/* TIM-HF2 evidence full width */}
      <TimHf2Card />
    </div>
  );
}
