import { NextResponse } from 'next/server';
import { topUp } from '@/server/billing';
import { getDb } from '@/server/db';
import { getStripe } from '@/server/stripe';

export const dynamic = 'force-dynamic';

/** The largest amount one session may credit, in cents: a guard on metadata, not a limit on anyone. */
const MAX_CENTS = 100_000;

/**
 * Stripe telling us a payment happened. No session cookie reaches this; the signature over the raw
 * body is the proof, checked against `STRIPE_WEBHOOK_SECRET` before anything is read from it.
 *
 * A card payment arrives as `checkout.session.completed` with `payment_status: paid`; a method that
 * settles later arrives paid on `checkout.session.async_payment_succeeded`. Either credits, once:
 * the ledger is keyed by the session id, and Stripe retries deliveries.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ error: 'webhooks are not set up' }, { status: 503 });

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  const payload = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const metadata = session.metadata ?? {};
    const cents = Number(metadata.amountCents);
    const workspaceId = metadata.workspaceId;
    if (
      session.payment_status === 'paid' &&
      metadata.purpose === 'studio-topup' &&
      workspaceId &&
      Number.isInteger(cents) &&
      cents > 0 &&
      cents <= MAX_CENTS
    ) {
      const credited = await topUp(await getDb(), {
        workspaceId,
        sessionId: session.id,
        amountMicros: cents * 10_000,
      });
      if (credited) console.log(`[studio] credited $${(cents / 100).toFixed(2)} to ${workspaceId}`);
    }
  }

  return NextResponse.json({ received: true });
}
