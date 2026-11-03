import type { StoreConfig } from '../store';
import { memoryFiles } from './files';
import { openFileStore } from './store';

/**
 * The local store a workspace suite runs over: a file-backed store in memory,
 * the one local store (ADR-0066 decision 4, 2026-11-02). Until that decision
 * the suites ran twice, over a scratch TerminusDB database as well, the test
 * bed of decision 3; the two-store contract test (`contract.test.ts`) is what
 * still holds the folder to the remote's store.
 */
export function localStoreConfig(): StoreConfig {
  return { files: openFileStore(memoryFiles()) };
}
