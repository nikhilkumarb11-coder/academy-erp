import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { isStandalone } from '../lib/install';
import { tenantBasePath } from '../tenant/loadTenant';
import { useTenant } from '../tenant/TenantContext';

const LAUNCHED = 'erp:launched';
/** Back in the installed app after this long away: start again from the dashboard, like a fresh open. */
const RESUME_TO_DASHBOARD_MS = 15 * 60_000;

/**
 * App-like behaviour for the installed app: every launch opens the dashboard, and the dashboard URL
 * keeps its trailing slash so it never falls outside the app's scope (which shows the browser bar).
 */
export function useAppLaunch() {
  const tenant = useTenant();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const base = tenantBasePath(tenant.slug);
    if (window.location.pathname === base) {
      window.history.replaceState(window.history.state, '', `${base}/${window.location.search}${window.location.hash}`);
    }
  }, [location, tenant.slug]);

  useEffect(() => {
    if (!isStandalone()) return;
    if (!sessionStorage.getItem(LAUNCHED)) {
      sessionStorage.setItem(LAUNCHED, '1');
      if (window.location.pathname.replace(/\/$/, '') !== tenantBasePath(tenant.slug)) navigate('/', { replace: true });
    }
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RESUME_TO_DASHBOARD_MS) navigate('/', { replace: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [navigate, tenant.slug]);
}
