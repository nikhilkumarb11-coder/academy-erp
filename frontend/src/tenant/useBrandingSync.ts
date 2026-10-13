import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { CoreData, Settings } from '../data/types';
import { coreKey, useCoreData } from '../data/useCoreData';
import { absoluteAssetUrl } from './loadTenant';
import { useTenant } from './TenantContext';

/**
 * Receipts are rendered on the server, which only knows the sheet's settings. This copies the
 * tenant's logo and colours (from tenants/<slug>.json) into those settings when they differ.
 */
export function useBrandingSync() {
  const tenant = useTenant();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useCoreData();
  const done = useRef(false);

  useEffect(() => {
    if (!data || done.current) return;
    done.current = true;
    const wanted: Settings = { brand_primary: tenant.theme.primary, brand_accent: tenant.theme.accent };
    // The server fetches the logo, so only a public https address is useful (not a local dev server).
    if (window.location.protocol === 'https:' || tenant.apiUrl === 'mock') {
      wanted.logo_url = tenant.logo ? absoluteAssetUrl(tenant.logo) : '';
    }
    // Profile values in the tenant file seed empty settings; after that the academy edits them in Settings.
    const seed: Record<string, string> = { ...(tenant.tagline ? { academy_tagline: tenant.tagline } : {}), ...tenant.profile };
    Object.entries(seed).forEach(([k, v]) => { if (v && !data.settings[k]) wanted[k] = v; });
    const changes = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => (data.settings[k] ?? '') !== v));
    if (!Object.keys(changes).length) return;
    api<Settings>('settings.update', changes)
      .then((settings) => queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? { ...old, settings } : old)))
      .catch(() => { done.current = false; });
  }, [data, tenant, api, queryClient]);
}
