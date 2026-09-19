/**
 * `pnpm dev`: Next, and the Stripe listener beside it.
 *
 * Stripe cannot reach 127.0.0.1, so a local top-up is credited only while `stripe listen` is
 * forwarding events to the webhook route. It used to be a second terminal someone had to remember,
 * and when nobody did the payment went through at Stripe and the balance never moved, with the
 * billing page waiting on a webhook that was never coming.
 *
 * The listener is a convenience, never a requirement: no CLI or no key means Next starts alone and
 * says why. Arguments pass through to `next dev`, so `dev:lan` shares this file.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PORT = 3002;
const WEBHOOK = `http://127.0.0.1:${PORT}/api/billing/webhook`;

const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

function hasStripeKey() {
  if (process.env.STRIPE_SECRET_KEY) return true;
  try {
    return /^STRIPE_SECRET_KEY=.+/m.test(readFileSync('.env.local', 'utf8'));
  } catch {
    // No .env.local is an ordinary state: billing is simply not set up here.
    return false;
  }
}

function startListener() {
  if (!hasStripeKey()) return;
  if (spawnSync('stripe', ['--version'], { stdio: 'ignore' }).error) {
    console.warn('[studio] Stripe CLI not found: top-ups will not be credited locally.');
    return;
  }
  const listener = spawn('stripe', ['listen', '--forward-to', WEBHOOK], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(listener);
  // The CLI prints the signing secret when it connects. It does not belong in a terminal log.
  const relay = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) console.log(`[stripe] ${line.replace(/whsec_\w+/g, 'whsec_…')}`);
    }
  };
  listener.stdout.on('data', relay);
  listener.stderr.on('data', relay);
  listener.on('exit', (code) => {
    if (!stopping) console.warn(`[studio] Stripe listener stopped (${code}): top-ups will not be credited.`);
  });
}

const next = spawn('next', ['dev', '-p', String(PORT), ...process.argv.slice(2)], { stdio: 'inherit' });
children.push(next);
next.on('exit', (code) => stop(code ?? 0));

startListener();

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
