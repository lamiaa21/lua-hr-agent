import { env } from 'lua-cli';
import { MockBambooAdapter } from './mock.adapter.js';
import { BambooHRAdapter } from './bamboohr.adapter.js';
import type { HRISClient } from './types.js';

/**
 * HRIS_MODE=mock|live selects the adapter at runtime. Default is mock so a
 * clean clone works with zero BambooHR credentials — see README for why the
 * live adapter (BambooHRAdapter) isn't wired in by default, and for the
 * caveats on BambooHRAdapter itself (untested against a live tenant).
 */
function createHRISClient(): HRISClient {
  const mode = env('HRIS_MODE') ?? 'mock';

  if (mode === 'live') {
    return new BambooHRAdapter();
  }

  return new MockBambooAdapter();
}

export const hris: HRISClient = createHRISClient();
