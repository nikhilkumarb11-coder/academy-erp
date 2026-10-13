import { Hammer } from 'lucide-react';
import { useLocation } from 'react-router';
import { Card, PageHeader } from '../components/ui';
import { NAV_ITEMS } from '../layout/nav';
import { useLabels } from '../tenant/TenantContext';

/** Placeholder for screens scheduled in later phases. */
export function ComingSoonPage() {
  const { pathname } = useLocation();
  const labels = useLabels();
  const item = NAV_ITEMS.find((i) => i.to !== '/' && pathname.startsWith(i.to));
  const title = item ? item.label(labels) : 'Coming soon';

  return (
    <>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-primary">
          <Hammer className="size-6" aria-hidden />
        </div>
        <p className="font-medium">This screen is being built.</p>
        {item && <p className="text-sm text-muted">Scheduled for phase {item.phase}.</p>}
      </Card>
    </>
  );
}
