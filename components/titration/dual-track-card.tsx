import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { DUAL_TRACKS } from '@/lib/titration/constants';
import { Smartphone, Phone } from 'lucide-react';

export function DualTrackCard() {
  return (
    <Card data-testid="dual-track-card">
      <CardHeader>
        <CardTitle>Dual-Track Execution Reference</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Track A */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
            <div className="mb-3 flex items-center gap-2">
              <Smartphone className="size-5 text-blue-600" aria-hidden="true" />
              <h3 className="font-semibold text-blue-900 dark:text-blue-200">
                {DUAL_TRACKS.trackA.name}
              </h3>
            </div>
            <ul className="space-y-1.5">
              {DUAL_TRACKS.trackA.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Track B */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="mb-3 flex items-center gap-2">
              <Phone className="size-5 text-amber-600" aria-hidden="true" />
              <h3 className="font-semibold text-amber-900 dark:text-amber-200">
                {DUAL_TRACKS.trackB.name}
              </h3>
            </div>
            <ul className="space-y-1.5">
              {DUAL_TRACKS.trackB.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground italic">{DUAL_TRACKS.note}</p>
      </CardFooter>
    </Card>
  );
}
