import { NextResponse } from 'next/server';
import { getStorage, isStorageKey } from '@/server/storage';

export const dynamic = 'force-dynamic';

/** `bytes=0-1023`, `bytes=512-` or `bytes=-1024`, resolved against a known size. */
function parseRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  // A range with no start is a suffix: the last N bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/**
 * Local storage's front door. Content-addressed, so the answer never changes: cache forever.
 *
 * It serves ranges because it serves video. A reader seeking in a clip asks for a window of it,
 * and a server that can only answer with the whole file makes the browser fetch the whole file to
 * play a second of it — and holds all of it in memory to do so.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isStorageKey(key)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const file = await getStorage().open(key);
  if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const headers: Record<string, string> = {
    'Content-Type': file.mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  };

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const range = parseRange(rangeHeader, file.size);
    if (range === 'unsatisfiable') {
      return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } });
    }
    if (range) {
      return new NextResponse(file.body(range.start, range.end), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }
  }

  return new NextResponse(file.body(), {
    headers: { ...headers, 'Content-Length': String(file.size) },
  });
}
