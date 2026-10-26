import { expect, test } from 'vitest';
import { check } from './hub';

test('the client imports, reads and reports a refusal under Vitest', async () => {
  expect(await check()).toMatch(/^ok: 1 objective at c1/);
});
