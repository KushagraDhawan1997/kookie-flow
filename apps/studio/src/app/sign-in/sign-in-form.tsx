'use client';

import * as React from 'react';
import {
  Box,
  Button,
  Card,
  Field,
  FieldLabel,
  Flex,
  Heading,
  Link,
  Notice,
  Stack,
  Text,
  TextField,
} from '@kushagradhawan/kookie-ui-react';

import { authClient } from '../auth-client';
import { Wordmark } from '../wordmark';

/**
 * One screen for both ways in. Who may create an account, and which account inherits what was made
 * before sign-in existed, are the server's rules (`server/auth.ts`); a refused sign-up comes back
 * with its reason and shows here like any other problem.
 */
export function SignInForm({ next }: { next: string }) {
  const [mode, setMode] = React.useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const signingUp = mode === 'sign-up';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const result = signingUp
      ? await authClient.signUp.email({ name: name.trim() || email, email, password })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setBusy(false);
      setProblem(result.error.message ?? 'That did not work. Check the details and try again.');
      return;
    }
    // A full load rather than a client navigation, so the server renders with the new session.
    location.assign(next);
  };

  return (
    <Flex justify="center" align="center" style={{ minHeight: '100dvh' }}>
      <Box p="6" width="min(420px, 100%)">
        {/* The mark leads the card rather than floating above it: one object, not a label on a box. */}
        <Card size="3">
          <form onSubmit={submit}>
            <Stack gap="4">
              {/* Its own row, set apart from the heading so the two do not read as one line of type. */}
              <Box pb="4">
                <Wordmark />
              </Box>
              <Heading size="5">{signingUp ? 'Create an account' : 'Sign in'}</Heading>

              {problem && <Notice tone="destructive">{problem}</Notice>}

              {signingUp && (
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <TextField value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </Field>
              )}
              <Field>
                <FieldLabel>Email</FieldLabel>
                <TextField
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
              <Field>
                <FieldLabel>Password</FieldLabel>
                <TextField
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={signingUp ? 'new-password' : 'current-password'}
                />
              </Field>

              <Button type="submit" emphasis="loud" tone="accent" loading={busy}>
                {signingUp ? 'Create account' : 'Sign in'}
              </Button>

              <Text size="2" emphasis="medium">
                {signingUp ? 'Have an account? ' : 'No account? '}
                {/* A button, since it changes the form rather than going anywhere, without the
                    platform's button box: the link's own ink and underline are the whole look. */}
                <Link
                  render={
                    <button
                      type="button"
                      style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}
                    />
                  }
                  onClick={() => {
                    setMode(signingUp ? 'sign-in' : 'sign-up');
                    setProblem(null);
                  }}
                >
                  {signingUp ? 'Sign in' : 'Create one'}
                </Link>
              </Text>
            </Stack>
          </form>
        </Card>
      </Box>
    </Flex>
  );
}
