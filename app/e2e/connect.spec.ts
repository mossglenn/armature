/**
 * "Work from your own machine" in a browser (docs/desktop-program-plan.md §8):
 * reached from the navigation, naming the instance from the hub's profile, with
 * the link the program registers for. The hub here runs on the machine under
 * `header`, so it publishes no address and the page offers the one a browser
 * reaches it at.
 */
import { expect, test } from '@playwright/test';

test('offers the link to the program, from the hub\'s profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Your own machine' }).click();
  await expect(page.getByRole('heading', { name: 'Work from your own machine' })).toBeVisible();
  await expect(page.getByText('localhost', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in the desktop program' })).toHaveAttribute('href', 'armature://connect?remote=http%3A%2F%2Flocalhost%3A3100');
  await expect(page.getByRole('link', { name: 'Get the program' })).toHaveAttribute('href', /\/releases$/);
  expect(errors).toEqual([]);
});
