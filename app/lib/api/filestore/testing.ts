import { storeConfigFromEnv, type StoreConfig } from '../store';
import { memoryFiles } from './files';
import { openFileStore } from './store';

/**
 * The local store a workspace suite runs over (ADR-0066 decision 3): a
 * scratch TerminusDB database of the given name, the test bed, or a
 * file-backed store in memory. The workspace and cycle suites run once over
 * each, so the clone, the push, the snapshots, the bring-in and the delivery
 * are held to both stores.
 */
export function localStoreConfig(local: 'terminusdb' | 'files', db: string): StoreConfig {
  return local === 'files' ? { files: openFileStore(memoryFiles()) } : { ...storeConfigFromEnv(), db };
}
