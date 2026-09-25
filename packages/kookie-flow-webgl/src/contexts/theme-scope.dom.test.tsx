import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';
import { themeRoot } from '../utils/theme-root';

function Reader({ name }: { name: string }) {
  const tokens = useTheme();
  return <output data-testid={name}>{tokens.appearance}</output>;
}
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-appearance');
});

describe('editor theme ownership', () => {
  it('reads each editor under its own theme', () => {
    render(
      <>
        <div className="kui-theme" data-appearance="light">
          <ThemeProvider>
            <Reader name="a" />
          </ThemeProvider>
        </div>
        <div className="kui-theme" data-appearance="dark">
          <ThemeProvider>
            <Reader name="b" />
          </ThemeProvider>
        </div>
      </>
    );
    expect(screen.getByTestId('a').textContent).toBe('light');
    expect(screen.getByTestId('b').textContent).toBe('dark');
  });

  it('updates inherited appearance without disturbing an explicit sibling theme', async () => {
    document.documentElement.setAttribute('data-appearance', 'light');
    render(
      <>
        <div className="kui-theme" data-appearance="inherit">
          <ThemeProvider>
            <Reader name="inherited" />
          </ThemeProvider>
        </div>
        <div className="kui-theme" data-appearance="light">
          <ThemeProvider>
            <Reader name="fixed" />
          </ThemeProvider>
        </div>
      </>
    );
    expect(screen.getByTestId('inherited').textContent).toBe('light');
    await act(async () => {
      document.documentElement.setAttribute('data-appearance', 'dark');
    });
    await waitFor(() => expect(screen.getByTestId('inherited').textContent).toBe('dark'));
    expect(screen.getByTestId('fixed').textContent).toBe('light');
  });

  it('does not select the first unrelated theme as a global fallback', () => {
    render(<div className="kui-theme" data-appearance="dark" />);
    expect(themeRoot()).toBe(document.documentElement);
  });
});
