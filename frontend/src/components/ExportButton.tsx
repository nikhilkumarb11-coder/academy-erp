import { Download } from 'lucide-react';
import { useCoreData } from '../data/useCoreData';
import { todayIso } from '../lib/dates';
import { exportList } from '../lib/exports';
import { Button } from './ui';

/** "CSV" button for a list page; exports the whole list (not just the filtered view). */
export function ExportButton({ list }: { list: string }) {
  const { data } = useCoreData();
  return (
    <Button variant="ghost" disabled={!data} title="Download as CSV (opens in Excel)"
      onClick={() => data && exportList(list, data.tables, data.settings, todayIso())}>
      <Download className="size-4" aria-hidden /> CSV
    </Button>
  );
}
