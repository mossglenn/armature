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

test('the Focus page draws the trace from a metric: the walk lit, the root outlined, states and history read', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph/LearningMetric/mod3-bias-type-difficulty');
  await expect(page.getByRole('heading', { level: 1, name: /Item difficulty: bias type item/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Design Graph');
  await expect(page.getByText('The lifecycle walk from this record')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(15);
  await expect(page.locator('.gnode-root')).toHaveCount(1);
  await expect(page.locator('.gedge-lit')).not.toHaveCount(0);
  const panel = page.getByRole('complementary', { name: 'Record details' });
  await expect(panel).toContainText('LearningMetric/mod3-bias-type-difficulty');
  await expect(panel.getByRole('link', { name: /View as of/ })).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(panel.locator('ol li')).not.toHaveCount(0);
  await page.getByRole('button', { name: /^AssessmentItem, Identifying training data bias/ }).click();
  await page.getByRole('tab', { name: /About it/ }).click();
  await expect(panel).toContainText('Current');
  expect(errors).toEqual([]);
});

test('a record the trace read does not walk from gets its neighborhood', async ({ page }) => {
  await page.goto('/graph/DesignNote/item6-authoring-rationale');
  await expect(page.getByText('What this record references and what references it')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
});

test('the Trace relation on the Graph lights the walk from a selected record', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph?select=AssessmentItem%2Fbias-type-mc&related=trace');
  await expect(page.getByRole('button', { name: 'Trace', exact: true })).toHaveAttribute('class', /bg-zinc-800|bg-zinc-200/);
  await expect(page.locator('.gnode-dim')).not.toHaveCount(0);
  expect(await page.locator('.gnode:not(.gnode-dim)').count()).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('the Coverage View links its module, objectives, items and results to their Focus pages', async ({ page }) => {
  await page.goto('/coverage/risks-and-ethics');
  await expect(page.getByRole('link', { name: 'Distinguish Bias Types' })).toHaveAttribute('href', '/graph/LearningObjective/distinguish-bias-types');
  const result = page.getByRole('link', { name: 'trace this result' }).first();
  await expect(result).toHaveAttribute('href', /^\/graph\/LearningMetric\//);
  await page.goto((await result.getAttribute('href'))!);
  await expect(page.locator('.gnode-root')).toHaveCount(1);
});
