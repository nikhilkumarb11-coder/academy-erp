import clsx from 'clsx';
import { LogOut, MoreHorizontal } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { AppLogo } from '../components/AppLogo';
import { Spinner } from '../components/ui';
import { useTenant } from '../tenant/TenantContext';
import { useBrandingSync } from '../tenant/useBrandingSync';
import { GlobalSearch } from './GlobalSearch';
import { SyncStatus } from './SyncStatus';
import { VersionBanner } from './VersionBanner';
import { visibleNav } from './nav';

function Brand({ inverted }: { inverted?: boolean }) {
  const tenant = useTenant();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AppLogo className="size-10 rounded-xl text-lg" tile />
      <span className={clsx('truncate font-heading text-lg font-semibold', inverted ? 'text-white' : 'text-primary')}>{tenant.name}</span>
    </div>
  );
}

function Sidebar() {
  const tenant = useTenant();
  const { logout } = useAuth();
  const items = visibleNav(tenant.modules);
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-primary px-3 py-5 lg:flex print:hidden">
      <div className="px-2 pb-6">
        <Brand inverted />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto" aria-label="Main">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
                isActive ? 'bg-white/10 text-accent' : 'text-white/80 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="size-[18px]" aria-hidden />
            {label(tenant.labels)}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => logout()}
        className="mt-4 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
      >
        <LogOut className="size-[18px]" aria-hidden />
        Log out
      </button>
    </aside>
  );
}

function BottomTabs() {
  const tenant = useTenant();
  const location = useLocation();
  const tabs = visibleNav(tenant.modules).filter((i) => i.mobileTab);
  const moreActive = !tabs.some((t) => (t.to === '/' ? location.pathname === '/' : location.pathname.startsWith(t.to)));

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden print:hidden"
    >
      <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx('flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('grid h-7 w-12 place-items-center rounded-full transition', isActive && 'bg-accent-soft')}>
                  <Icon className="size-5" aria-hidden />
                </span>
                {to === '/fees' ? 'Fees' : label(tenant.labels)}
              </>
            )}
          </NavLink>
        ))}
        <NavLink
          to="/more"
          className={clsx('flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', moreActive ? 'text-primary' : 'text-muted')}
        >
          <span className={clsx('grid h-7 w-12 place-items-center rounded-full transition', moreActive && 'bg-accent-soft')}>
            <MoreHorizontal className="size-5" aria-hidden />
          </span>
          More
        </NavLink>
      </div>
    </nav>
  );
}

export function AppShell() {
  useBrandingSync();
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur print:hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 lg:px-8">
            <div className="lg:hidden">
              <BrandCompact />
            </div>
            <GlobalSearch />
            <div className="ml-auto">
              <span className="hidden sm:inline">
                <SyncStatus />
              </span>
              <span className="sm:hidden">
                <SyncStatus compact />
              </span>
            </div>
          </div>
          <VersionBanner />
        </header>
        <main className="flex-1 px-4 pb-28 pt-5 lg:px-8 lg:pb-10 print:p-0">
          <div className="mx-auto max-w-6xl">
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}

function BrandCompact() {
  const tenant = useTenant();
  return (
    <span title={tenant.name}>
      <AppLogo className="size-9 rounded-lg text-lg" tile={!!tenant.logo} />
    </span>
  );
}
