import { NextResponse } from 'next/server';
import { z } from 'zod';
import { MARKUP } from 'studio-core';
import { TOP_UP_DOLLARS } from '@/shared/billing';
import { billingEnabled } from '@/server/billing';
import { currentUser, signInRequired } from '@/server/session';
import { getStripe } from '@/server/stripe';

export const dynamic = 'force-dynamic';

const Body = z.object({
  dollars: z
    .number()
    .int()
    .refine((d) => TOP_UP_DOLLARS.some((offered) => offered === d), 'not an offered amount'),
});

/**
 * Start a top-up: a Stripe Checkout session for one of the offered amounts, answered with the URL
 * to send the browser to. Nothing is credited here. The balance moves only when Stripe's webhook
 * says the payment went through (`/api/billing/webhook`), so closing the tab or a declined card
 * leaves nothing behind.
 *
 * The credited amount travels in the session's metadata and is the amount chosen, never the total
 * charged: tax that Stripe adds at checkout is tax, not balance.
 *
 * MANAGED PAYMENTS (Stripe as merchant of record) is stated on every session rather than left to the
 * account's default, so what a session does is readable here: on unless `STRIPE_MANAGED_PAYMENTS=off`.
 * It requires an eligible product tax code; `txcd_10105001` is "Artificial Intelligence as a Service
 * - Cloud Based - Personal Use" from Stripe's eligible list, overridable with `STRIPE_TAX_CODE`.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return signInRequired();
  const stripe = getStripe();
  if (!billingEnabled() || !stripe) {
    return NextResponse.json({ error: 'Payments are not set up on this server.' }, { status: 503 });
  }
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.message }, { status: 400 });

  const { dollars } = body.data;
  const cents = dollars * 100;
  // Back to the address the app is served at, where the session cookie lives. `request.url` can
  // name a different host for the same server (localhost for 127.0.0.1), and a cookie set on one is
  // not sent to the other, so a return there lands on sign-in.
  const origin = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '') || new URL(request.url).origin;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: cents,
            product_data: {
              name: `Studio balance: $${dollars}`,
              description: `Adds $${dollars} to your Studio balance. Each run is charged at the model's price plus a ${Math.round(MARKUP * 100)}% fee.`,
              tax_code: process.env.STRIPE_TAX_CODE || 'txcd_10105001',
            },
          },
        },
      ],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { purpose: 'studio-topup', workspaceId: user.id, amountCents: String(cents) },
      success_url: `${origin}/billing?topup=done`,
      cancel_url: `${origin}/billing?topup=cancelled`,
      managed_payments: { enabled: process.env.STRIPE_MANAGED_PAYMENTS !== 'off' },
    });
    if (!session.url) throw new Error('Stripe gave no checkout URL');
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('[studio] checkout failed', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
