import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  GENERIC_BRIDGE_ITEMS,
  GENERIC_BRIDGE_PRINCIPLE,
} from '@/lib/gdmt/constants';

export function GenericBridge() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generic Bridge (~$15/month)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Drug Class</TableHead>
              <TableHead>Generic Agent</TableHead>
              <TableHead>Monthly Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {GENERIC_BRIDGE_ITEMS.map((item) => (
              <TableRow key={item.agent}>
                <TableCell className="whitespace-normal">
                  {item.drugClass}
                  {item.note && (
                    <span className="italic text-muted-foreground">
                      {' '}
                      ({item.note})
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">{item.agent}</TableCell>
                <TableCell>{item.monthlyCost}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-bold">
                Total
              </TableCell>
              <TableCell className="font-bold">~$15-16/month</TableCell>
            </TableRow>
          </TableFooter>
        </Table>

        <div className="rounded-md bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {GENERIC_BRIDGE_PRINCIPLE}
        </div>
      </CardContent>
    </Card>
  );
}
