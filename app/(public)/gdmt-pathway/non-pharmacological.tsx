import { Card, CardContent } from '@/components/ui/card';
import { NON_PHARMACOLOGICAL } from '@/lib/gdmt/constants';

const items = [
  NON_PHARMACOLOGICAL.sodium,
  NON_PHARMACOLOGICAL.activity,
  NON_PHARMACOLOGICAL.cardiacRehab,
];

export function NonPharmacological() {
  return (
    <Card>
      <CardContent className="pt-4">
        <dl className="space-y-4">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-sm font-medium">{item.label}</dt>
              <dd className="text-sm text-muted-foreground">{item.target}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
