import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { EPLERENONE_GUIDE, SPIRONOLACTONE_RENAL_DOSE_RULE } from '@/lib/gdmt/constants';

export function MraReference() {
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        Label reference for prescribers. Verify the current FDA label before any
        prescribing decision; no row is an individual treatment recommendation.
      </p>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Spironolactone — renal dosing</h3>
        <p className="text-sm text-muted-foreground">{SPIRONOLACTONE_RENAL_DOSE_RULE}</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{EPLERENONE_GUIDE.agent}</h3>
        <p className="text-sm text-muted-foreground">{EPLERENONE_GUIDE.whyListed}</p>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium">Starting dose</dt>
          <dd>{EPLERENONE_GUIDE.startingDose}</dd>
          <dt className="font-medium">Target dose</dt>
          <dd>{EPLERENONE_GUIDE.targetDose}</dd>
          <dt className="font-medium">Dose cap</dt>
          <dd>{EPLERENONE_GUIDE.doseCap}</dd>
          <dt className="font-medium">Monitoring</dt>
          <dd>{EPLERENONE_GUIDE.monitoring}</dd>
        </dl>
        <div>
          <h4 className="text-sm font-medium">Contraindications</h4>
          <ul className="ml-4 list-disc text-sm text-muted-foreground">
            {EPLERENONE_GUIDE.contraindications.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs italic text-muted-foreground">{EPLERENONE_GUIDE.unitCaution}</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serum potassium (mEq/L)</TableHead>
                <TableHead>Eplerenone action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EPLERENONE_GUIDE.potassiumBands.map((band) => (
                <TableRow key={band.range}>
                  <TableCell className="font-medium whitespace-normal">{band.range}</TableCell>
                  <TableCell className="whitespace-normal">{band.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
