import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import type { PingResult } from '../data/types';
import { useTenant } from '../tenant/TenantContext';

/** Warns when this frontend build and the tenant's backend disagree on API version (docs/04 §Versioning). */
export function VersionBanner() {
  const tenant = useTenant();
  const { api } = useAuth();
  const { data } = useQuery({
    queryKey: ['ping', tenant.slug],
    queryFn: () => api<PingResult>('system.ping'),
    staleTime: 10 * 60_000,
  });

  if (!data || data.apiVersion === tenant.expectedApiVersion) return null;

  const appIsOlder = data.apiVersion > tenant.expectedApiVersion;
  return (
    <div className="border-t border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm text-warning">
      {appIsOlder ? (
        <>
          An update is available.{' '}
          <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>
            Refresh now
          </button>
        </>
      ) : (
        'The server is being updated. Some features may be unavailable for a few minutes.'
      )}
    </div>
  );
}
