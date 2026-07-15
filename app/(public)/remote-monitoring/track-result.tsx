import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { TrackRecommendation, TrackType } from '@/lib/remote-monitoring/types';

const trackTheme: Record<TrackType, { badge: string; accent: string; label: string }> = {
  'track-a': {
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    accent: 'border-blue-500',
    label: 'Digital',
  },
  'track-b': {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    accent: 'border-amber-500',
    label: 'Analog',
  },
  hybrid: {
    badge: 'bg-purple-100 text-purple-800 border-purple-300',
    accent: 'border-purple-500',
    label: 'Mixed',
  },
};

interface TrackResultProps {
  recommendation: TrackRecommendation;
  patientName?: string;
}

export function TrackResult({ recommendation, patientName }: TrackResultProps) {
  const theme = trackTheme[recommendation.track];

  return (
    <Card className={`border-l-4 ${theme.accent}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span>Track Recommendation</span>
          <Badge variant="outline" className={theme.badge}>
            {recommendation.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {patientName && (
          <p className="mb-2 text-sm text-muted-foreground">
            Recommended for: <span className="font-medium text-foreground">{patientName}</span>
          </p>
        )}
        <p className="text-sm leading-relaxed">{recommendation.rationale}</p>
      </CardContent>
    </Card>
  );
}
