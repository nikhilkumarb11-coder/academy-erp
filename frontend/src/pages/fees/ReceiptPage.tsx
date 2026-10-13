import { ArrowLeft, Download, Printer, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { errorMessage } from '../../api/errors';
import { Alert, Button, Card, Spinner } from '../../components/ui';
import type { CoreData } from '../../data/types';
import { applyChanges, type Changes } from '../../data/merge';
import { coreKey, useCoreTables } from '../../data/useCoreData';
import { useTenant } from '../../tenant/TenantContext';
import { useReceiptActions } from './feeShared';

type Loaded = { kind: 'html'; html: string } | { kind: 'drive'; url: string; fileId: string };

/** A receipt in the app: the stored PDF (Drive preview) or, in the demo, its HTML. */
export function ReceiptPage() {
  const { paymentId = '' } = useParams();
  const tenant = useTenant();
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const t = useCoreTables();
  const receipt = useReceiptActions();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const payment = t?.Payments.find((p) => p.id === paymentId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ changes: Changes; url: string }>('receipts.get', { payment_id: paymentId });
        if (res.changes) queryClient.setQueryData<CoreData>(coreKey(tenant.slug), (old) => (old ? applyChanges(old, res.changes) : old));
        if (cancelled) return;
        if (tenant.apiUrl === 'mock') {
          const { demoReceiptHtml } = await import('../../api/mock');
          const html = demoReceiptHtml(tenant.slug, res.url);
          if (!cancelled) html ? setLoaded({ kind: 'html', html }) : setError('Receipt not found');
          return;
        }
        const fileId = res.url.match(/\/d\/([\w-]+)/)?.[1] ?? '';
        setLoaded({ kind: 'drive', url: res.url, fileId });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; };
    // Payment status is a dependency so a cancelled receipt reloads with its stamp.
  }, [api, paymentId, tenant.apiUrl, tenant.slug, queryClient, payment?.status]);

  const back = payment ? `/fees/${payment.parent_id}` : '/payments';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back))} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
        <div className="flex gap-2">
          {payment && payment.status === 'Recorded' && (
            <Button variant="secondary" loading={sharing} onClick={async () => { setSharing(true); await receipt.share(payment); setSharing(false); }}>
              <Share2 className="size-4" aria-hidden /> Share
            </Button>
          )}
          {loaded?.kind === 'html' && (
            <Button variant="secondary" onClick={() => frame.current?.contentWindow?.print()}><Printer className="size-4" aria-hidden /> Print</Button>
          )}
          {loaded?.kind === 'drive' && (
            <a href={loaded.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-primary hover:bg-primary-soft">
              <Download className="size-4" aria-hidden /> Open PDF
            </a>
          )}
        </div>
      </div>

      {error ? (
        <Card className="space-y-3">
          <Alert>{error}</Alert>
          <Link to={back} className="text-sm font-medium text-primary">Go back</Link>
        </Card>
      ) : !loaded ? (
        <Spinner label="Preparing receipt…" />
      ) : (
        <Card className="overflow-hidden p-0 sm:p-0">
          {loaded.kind === 'html' ? (
            <iframe ref={frame} title="Receipt" srcDoc={loaded.html} className="h-[75vh] w-full bg-white" />
          ) : (
            <iframe title="Receipt" src={`https://drive.google.com/file/d/${loaded.fileId}/preview`} className="h-[75vh] w-full bg-white" allow="autoplay" />
          )}
        </Card>
      )}
      {tenant.apiUrl === 'mock' && <p className="mt-2 text-center text-xs text-muted">Demo: real academies get a PDF saved in their Google Drive.</p>}
    </div>
  );
}
