import { createContext, useContext } from 'react';
import type { ModuleKey, TenantConfig, TenantLabels } from './types';

export const TenantContext = createContext<TenantConfig | null>(null);

export function useTenant(): TenantConfig {
  const tenant = useContext(TenantContext);
  if (!tenant) throw new Error('useTenant must be used inside TenantContext');
  return tenant;
}

export function useLabels(): TenantLabels {
  return useTenant().labels;
}

export function useModuleEnabled(module: ModuleKey | undefined): boolean {
  const tenant = useTenant();
  return !module || tenant.modules[module] !== false;
}
