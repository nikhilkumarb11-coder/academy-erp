import { ArrowLeft, Download, MessageCircle, Printer, Share2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, Card, Spinner } from '../../components/ui';
import { useCoreData } from '../../data/useCoreData';
import { receiptHtml } from '../../lib/receipt';
import { useReceiptActions } from './feeShared';

/** A receipt in the app, drawn from cached data: opens at once, also offline. */
export function ReceiptPage() {
  const { paymentId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isPending } = useCoreData();
  const receipt = useReceiptActions();
  const frame = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const payment = data?.tables.Payments.find((p) => p.id === paymentId);
  const html = useMemo(() => (data && payment ? receiptHtml(data.tables, data.settings, payment) : ''), [data, payment]);

  const back = payment ? `/fees/${payment.parent_id}` : '/payments';
  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  if (!data && isPending) return <Spinner label="Preparing receipt…" />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back))} className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-primary">
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
        {payment && !payment._pending && (
          <div className="flex flex-wrap gap-2">
            {payment.status === 'Recorded' && (
              <Button variant="secondary" loading={busy === 'wa'} onClick={run('wa', () => receipt.sendWhatsApp(payment))}>
                <MessageCircle className="size-4" aria-hidden /> Send link
              </Button>
            )}
            <Button variant="secondary" loading={busy === 'share'} onClick={run('share', () => receipt.share(payment))}>
              <Share2 className="size-4" aria-hidden /> Share PDF
            </Button>
            <Button variant="secondary" loading={busy === 'pdf'} onClick={run('pdf', () => receipt.download(payment))}>
              <Download className="size-4" aria-hidden /> Download
            </Button>
            <Button variant="secondary" onClick={() => frame.current?.contentWindow?.print()}>
              <Printer className="size-4" aria-hidden /> Print
            </Button>
          </div>
        )}
      </div>

      {!payment ? (
        <Card className="space-y-3">
          <Alert>Receipt not found. It may still be syncing; try again in a moment.</Alert>
          <Link to={back} className="text-sm font-medium text-primary">Go back</Link>
        </Card>
      ) : payment._pending ? (
        <Spinner label="Saving the payment… the receipt appears in a moment" />
      ) : (
        <Card className="overflow-hidden p-0 sm:p-0">
          <iframe ref={frame} title={`Receipt ${payment.receipt_no}`} srcDoc={html} className="h-[75vh] w-full bg-white" />
        </Card>
      )}
    </div>
  );
}
