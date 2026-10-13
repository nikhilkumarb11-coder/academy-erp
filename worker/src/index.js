/**
 * Razorpay webhook relay: POST /rzp/<tenant>
 *
 * Apps Script cannot read request headers (so it cannot verify Razorpay's signature) and
 * answers POSTs with a 302, which Razorpay counts as a failed delivery. This Worker verifies
 * X-Razorpay-Signature, replies 200 at once, and forwards the event to the tenant's Apps Script.
 * The Apps Script side must still confirm the payment via the Razorpay API before recording it.
 *
 * Config:
 *   vars    TENANTS = {"rays":{"appsScriptUrl":"https://script.google.com/macros/s/.../exec"}}
 *   secrets RZP_WEBHOOK_SECRET_<SLUG>, FORWARD_TOKEN_<SLUG>   (slug upper-cased, '-' -> '_')
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/rzp\/([a-z0-9-]+)\/?$/);
    if (request.method !== 'POST' || !match) return new Response('Not found', { status: 404 });

    const slug = match[1];
    const tenants = JSON.parse(env.TENANTS || '{}');
    const tenant = tenants[slug];
    const key = slug.toUpperCase().replace(/-/g, '_');
    const webhookSecret = env[`RZP_WEBHOOK_SECRET_${key}`];
    const forwardToken = env[`FORWARD_TOKEN_${key}`];
    if (!tenant || !webhookSecret || !forwardToken) return new Response('Unknown tenant', { status: 404 });

    const rawBody = await request.text();
    const signature = request.headers.get('X-Razorpay-Signature') || '';
    if (!(await verifySignature(rawBody, signature, webhookSecret))) {
      return new Response('Invalid signature', { status: 401 });
    }

    ctx.waitUntil(forward(tenant.appsScriptUrl, forwardToken, rawBody, request.headers.get('X-Razorpay-Event-Id')));
    return new Response('ok', { status: 200 });
  },
};

async function verifySignature(body, signature, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Apps Script runs doPost before answering with a 302, so the POST itself delivers the event.
 * redirect: 'manual' stops fetch from re-issuing it as a GET.
 */
async function forward(appsScriptUrl, forwardToken, rawBody, eventId) {
  const body = JSON.stringify({
    action: 'payments.webhook',
    payload: { forwardToken, eventId, event: JSON.parse(rawBody) },
  });
  const res = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    redirect: 'manual',
  });
  if (res.status !== 200 && res.status !== 302) {
    console.error('Forward failed', res.status, eventId);
  }
}
