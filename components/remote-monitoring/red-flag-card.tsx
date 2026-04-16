import { AlertTriangle, Phone, Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { RED_FLAG_ALERTS } from '@/lib/remote-monitoring/constants';
import type { SeverityLevel } from '@/lib/remote-monitoring/types';

const severityConfig: Record<
  SeverityLevel,
  { bg: string; border: string; badge: string; icon: typeof AlertTriangle }
> = {
  emergency: {
    bg: 'bg-red-50',
    border: 'border-l-4 border-red-500',
    badge: 'bg-red-600 text-white',
    icon: AlertTriangle,
  },
  urgent: {
    bg: 'bg-orange-50',
    border: 'border-l-4 border-orange-400',
    badge: 'bg-orange-500 text-white',
    icon: Phone,
  },
  'same-day': {
    bg: 'bg-yellow-50',
    border: 'border-l-4 border-yellow-400',
    badge: 'bg-yellow-500 text-white',
    icon: Clock,
  },
};

export function RedFlagCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Red Flag Alert Criteria</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {RED_FLAG_ALERTS.map((alert) => {
            const config = severityConfig[alert.severity];
            const Icon = config.icon;
            const isEmergency = alert.severity === 'emergency';

            return (
              <div
                key={alert.id}
                className={`rounded-lg p-3 ${config.bg} ${config.border} ${
                  isEmergency ? 'ring-2 ring-red-300' : ''
                }`}
                role={isEmergency ? 'alert' : undefined}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-2">
                    <Icon
                      className={`mt-0.5 size-4 shrink-0 ${
                        isEmergency ? 'text-red-600' : 'text-muted-foreground'
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-sm ${
                        isEmergency ? 'text-lg font-bold text-red-900' : 'font-medium'
                      }`}
                    >
                      {alert.finding}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    {isEmergency && (
                      <span className="inline-flex items-center rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                        EMERGENCY
                      </span>
                    )}
                    <span
                      className={`text-sm ${
                        isEmergency ? 'font-bold text-red-800' : 'text-muted-foreground'
                      }`}
                    >
                      {alert.action}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
