import { env } from 'lua-cli';
import { MockBambooAdapter } from './mock.adapter.js';
import type { HRISClient } from './types.js';

/**
 * HRIS_MODE=mock|live selects the adapter at runtime. Default is mock so a
 * clean clone works with zero BambooHR credentials — see README for why the
 * live adapter (BambooHRAdapter) isn't wired in by default.
 */
function createHRISClient(): HRISClient {
  const mode = env('HRIS_MODE') ?? 'mock';

  if (mode === 'live') {
    throw new Error(
      'HRIS_MODE=live is not implemented in this build — the BambooHRAdapter was deprioritized under the ' +
        'time-box (see README, "what I would do with more time"). Set HRIS_MODE=mock to use the seeded adapter.',
    );
  }

  return new MockBambooAdapter();
}

export const hris: HRISClient = createHRISClient();
