/**
 * The provider that costs nothing.
 *
 * It answers every request with the same two real files (see `fixtures.ts`), and it does so
 * SLOWLY ON PURPOSE. A mock that answered inside the request would exercise none of the path a
 * real provider needs — the row, the poll, a refresh in the middle, the tab coming back to a job
 * that finished while it was gone. So a mock job takes `STUDIO_MOCK_DELAY_MS` (default two
 * seconds) from the moment its row was written, spends the first quarter of that "in the queue",
 * and is done after — measured from the row itself, so a server restart mid-job changes nothing.
 */

import { mockFixture } from './fixtures';
import type { OutputKind, ProducedFile, Provider } from './provider';

/** The tasks are the models (see `fal-tasks.ts`); the mock answers each with the same files. */
const OUTPUTS: Record<string, Array<{ name: string; kind: OutputKind }>> = {
  'gpt-image-2.5': [{ name: 'image', kind: 'image' }],
  'clarity-upscaler': [{ name: 'image', kind: 'image' }],
  birefnet: [
    { name: 'image', kind: 'image' },
    { name: 'mask', kind: 'mask' },
  ],
  'wan-i2v': [{ name: 'video', kind: 'video' }],
};

function delayMs(): number {
  const stated = Number(process.env.STUDIO_MOCK_DELAY_MS);
  return Number.isFinite(stated) && stated >= 0 ? stated : 2000;
}

export const mockProvider: Provider = {
  id: 'mock',

  model: (task) => (OUTPUTS[task] ? `mock/${task}` : undefined),

  async submit(job) {
    return { providerId: `mock-${job.id}` };
  },

  async status(job) {
    const total = delayMs();
    const elapsed = Date.now() - job.createdAt.getTime();
    if (elapsed >= total) return { kind: 'done' };
    if (elapsed < total / 4) return { kind: 'queued', position: 1 };
    return { kind: 'running', progress: elapsed / total };
  },

  async result(job) {
    const files: ProducedFile[] = [];
    for (const out of OUTPUTS[job.task] ?? []) {
      // A clip for anything that moves, the photograph for everything else.
      const fixture = await mockFixture(out.kind === 'video' ? 'video' : 'image');
      files.push({
        name: out.name,
        kind: out.kind,
        bytes: fixture.bytes,
        mime: fixture.mime,
        width: fixture.width,
        height: fixture.height,
        duration: fixture.duration,
        fps: fixture.fps,
      });
    }
    return { files, cost: 0 };
  },

  async cancel() {
    // Nothing is running anywhere; the row's status is the whole of it.
  },
};
