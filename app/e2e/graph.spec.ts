/**
 * The Design Graph in a browser (docs/graph-view-plan.md §13, PR 1's
 * acceptance): the seed drawn in its columns, a selection that opens the
 * panel and lights the neighbors, and a view reproduced from its URL alone,
 * with no console error on any page.
 */
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('draws the seed in lifecycle columns', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph');
  await expect(page.getByRole('heading', { name: 'Design Graph' })).toBeVisible();
  await expect(page.getByText('64 records')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(37);
  await expect(page.locator('.react-flow__edge.gedge-junction')).toHaveCount(26);
  await expect(page.getByText('Assessments and lessons')).toBeVisible();
  await expect(page.getByLabel('AssessmentItem', { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('selecting a record opens the panel, lights its neighbors and writes the URL', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph');
  await page.getByRole('button', { name: /^AssessmentItem, Identifying training data bias/ }).click();
  const panel = page.getByRole('complementary', { name: 'Record details' });
  await expect(panel).toContainText('Identifying training data bias');
  await expect(panel).toContainText('AssessmentItem/bias-type-mc');
  await expect(page).toHaveURL(/select=AssessmentItem(%2F|\/)bias-type-mc/);
  expect(await page.locator('.gnode-dim').count()).toBeGreaterThan(0);
  await page.getByRole('tab', { name: /About it/ }).click();
  await expect(panel).toContainText('Attestation');
  await expect(panel).toContainText('Affirmed');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an edge is a relationship document with its data', async ({ page }) => {
  await page.goto('/graph?select=ModuleObjective%2F0739937cf08c6c803296c63c074199b8278c86aed4f0e43ef05dbb04f3c48982');
  const panel = page.getByRole('complementary', { name: 'Edge details' });
  await expect(panel).toContainText('ModuleObjective');
  await expect(panel).toContainText('Primary');
});

test('a view is reproduced from its URL alone', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph?select=AssessmentItem%2Fbias-type-mc&hide=DesignFinding,DesignNote&related=upstream&depth=all');
  await expect(page.locator('.react-flow__node')).toHaveCount(34);
  await expect(page.getByRole('complementary', { name: 'Record details' })).toContainText('Identifying training data bias');
  await expect(page.getByRole('button', { name: 'Upstream' })).toHaveAttribute('class', /bg-zinc-800|bg-zinc-200/);
  await expect(page.getByLabel('Depth')).toHaveValue('all');
  await expect(page.getByLabel('DesignNote')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('relationships can be drawn as nodes', async ({ page }) => {
  await page.goto('/graph?edges=nodes');
  await expect(page.locator('.react-flow__node')).toHaveCount(64);
  await expect(page.locator('.react-flow__edge.gedge-junction')).toHaveCount(0);
});
