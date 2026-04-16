import { Card, CardContent } from '@/components/ui/card';
import { SAFETY_GATE_RULES } from '@/lib/gdmt/constants';

export function SafetyGateCard() {
  const uptitrate = SAFETY_GATE_RULES.filter((r) => r.action === 'uptitrate');
  const hold = SAFETY_GATE_RULES.filter((r) => r.action === 'hold');

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* UPTITRATE IF column */}
      <Card className="border-green-300">
        <CardContent className="pt-4">
          <h3 className="text-lg font-bold text-green-700 mb-3">
            UPTITRATE IF
          </h3>
          <ul className="space-y-2">
            {uptitrate.map((rule) => (
              <li key={rule.condition} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-green-500"
                />
                <span className="text-sm">{rule.condition}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* HOLD IF column */}
      <Card className="border-red-300">
        <CardContent className="pt-4">
          <h3 className="text-lg font-bold text-red-700 mb-3">HOLD IF</h3>
          <ul className="space-y-2">
            {hold.map((rule) => (
              <li key={rule.condition} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500"
                />
                <span className="text-sm">{rule.condition}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
