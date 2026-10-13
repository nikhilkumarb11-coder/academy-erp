import clsx from 'clsx';
import { assetUrl } from '../tenant/loadTenant';
import { useTenant } from '../tenant/TenantContext';

/** The academy's square logo, or its initial on the brand colours when it has none. */
export function AppLogo({ className, tile }: { className: string; tile?: boolean }) {
  const tenant = useTenant();
  if (tenant.logo) {
    return (
      <span className={clsx('flex shrink-0 items-center justify-center overflow-hidden', tile && 'bg-white shadow-sm', className)}>
        <img src={assetUrl(tenant.logo)} alt="" className={clsx('block object-contain', tile ? 'size-[84%]' : 'size-full')} />
      </span>
    );
  }
  return (
    <span className={clsx('grid shrink-0 place-items-center bg-accent font-heading font-bold text-primary', className)} aria-hidden>
      {tenant.shortName.charAt(0)}
    </span>
  );
}
