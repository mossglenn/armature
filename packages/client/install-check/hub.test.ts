import { expect, test } from 'vitest';
import { check, words } from './hub';

test('the client imports, reads and reports a refusal under Vitest', async () => {
  expect(await check()).toMatch(/^ok: 1 objective at c1/);
});

test('the vocabulary imports, with its JSON, and answers under Vitest', () => {
  expect(words()).toBe('ok: "Push"; say "commit", not "Saved"; Draft is held for objective-state and item-status');
});
