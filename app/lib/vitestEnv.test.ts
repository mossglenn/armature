import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { envLocal } from '../vitest.env';

// `TERMINUS_DB=<scratch> npm test` must reach the scratch database. While the
// file won, a run asked for one looked isolated and wrote to `armature` anyway,
// and the untouched scratch database read as a clean result (2026-11-06).
describe('the tests’ environment', () => {
  const folder = mkdtempSync(join(tmpdir(), 'armature-env-'));
  const file = join(folder, '.env.local');
  writeFileSync(file, '# a comment\nTERMINUS_DB=armature\n\nTERMINUS_URL=http://localhost:6363\n');
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('takes a variable from the file when the shell does not set it', () => {
    expect(envLocal(file, {})).toEqual({ TERMINUS_DB: 'armature', TERMINUS_URL: 'http://localhost:6363' });
  });

  it('lets the shell win, as loadEnvLocal does for the hub and the operator tools', () => {
    expect(envLocal(file, { TERMINUS_DB: 'armature_test' }).TERMINUS_DB).toBe('armature_test');
  });

  it('leaves out what the file does not name', () => {
    expect(envLocal(file, { UNRELATED: 'x' })).not.toHaveProperty('UNRELATED');
  });

  it('gives nothing when there is no file, as in CI', () => {
    expect(envLocal(join(folder, 'absent'), { TERMINUS_DB: 'armature' })).toEqual({});
  });
});
