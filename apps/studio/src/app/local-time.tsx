'use client';

import * as React from 'react';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function relative(iso: string): string {
  const delta = Date.parse(iso) - Date.now();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return format.format(Math.round(delta / ms), unit);
  }
  return 'just now';
}

interface LocalTimeProps {
  iso: string;
  /** "2 hours ago", for lists scanned by recency. */
  relative?: boolean;
  /** "Sep 15, 1:36 PM": the year only when it is not this one, for columns of dates. */
  short?: boolean;
}

/**
 * The stored time, shown in the reader's own locale.
 *
 * The server and the reader are rarely in the same zone, and the server cannot know the reader's.
 * So the first paint carries the plain stored time and the browser replaces it once it is running
 * — which is also why this is not a hydration mismatch waiting to happen. The full time stays in
 * the tooltip whichever form is shown.
 */
export function LocalTime({ iso, relative: asRelative = false, short = false }: LocalTimeProps) {
  const [shown, setShown] = React.useState(iso.slice(0, 16).replace('T', ' '));
  const [full, setFull] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    const absolute = new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const date = new Date(iso);
    const brief = date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    });
    setShown(asRelative ? relative(iso) : short ? brief : absolute);
    setFull(absolute);
  }, [iso, asRelative, short]);
  return (
    <time dateTime={iso} title={full}>
      {shown}
    </time>
  );
}
