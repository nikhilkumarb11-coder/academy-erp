import { ChevronRight, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Card, PageHeader } from '../components/ui';
import { visibleNav } from '../layout/nav';
import { useTenant } from '../tenant/TenantContext';

/** Mobile overflow menu: every screen that is not a bottom tab. */
export function MorePage() {
  const tenant = useTenant();
  const { logout } = useAuth();
  const items = visibleNav(tenant.modules).filter((i) => !i.mobileTab);

  return (
    <>
      <PageHeader title="More" />
      <Card className="divide-y divide-line p-0 sm:p-0">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex min-h-14 items-center gap-3 px-4 hover:bg-primary-soft">
            <Icon className="size-5 text-primary" aria-hidden />
            <span className="flex-1 text-sm font-medium">{label(tenant.labels)}</span>
            <ChevronRight className="size-4 text-muted" aria-hidden />
          </Link>
        ))}
        <button type="button" onClick={() => logout()} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-danger hover:bg-danger/5">
          <LogOut className="size-5" aria-hidden />
          <span className="text-sm font-medium">Log out</span>
        </button>
      </Card>
    </>
  );
}
