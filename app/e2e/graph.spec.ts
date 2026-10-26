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
  await expect(page.getByText('67 records')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(39);
  await expect(page.locator('.react-flow__edge.gedge-junction')).toHaveCount(27);
  // The header in full, or in its short form with the name as its title when the fit is narrow.
  await expect(page.getByText('Assessments and lessons').or(page.getByTitle('Assessments and lessons'))).toBeVisible();
  await expect(page.getByLabel('AssessmentItem', { exact: false }).first()).toBeVisible();
  // Edges attach at ports: an objective with several items and activities has a source handle for each.
  expect(await page.locator('.react-flow__node', { hasText: 'Identify AI Limitations' }).locator('.react-flow__handle.source').count()).toBeGreaterThan(1);
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
  await expect(page.locator('.react-flow__node')).toHaveCount(35);
  await expect(page.getByRole('complementary', { name: 'Record details' })).toContainText('Identifying training data bias');
  await expect(page.getByRole('button', { name: 'Upstream' })).toHaveAttribute('class', /bg-zinc-800|bg-zinc-200/);
  await expect(page.getByLabel('Depth')).toHaveValue('all');
  await expect(page.getByLabel('DesignNote')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('relationships can be drawn as nodes', async ({ page }) => {
  await page.goto('/graph?edges=nodes');
  await expect(page.locator('.react-flow__node')).toHaveCount(67);
  await expect(page.locator('.react-flow__edge.gedge-junction')).toHaveCount(0);
});

test('the Focus page draws the trace from a metric: the walk lit, the root outlined, states and history read', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph/LearningMetric/mod3-bias-type-difficulty');
  await expect(page.getByRole('heading', { level: 1, name: /Item difficulty: bias type item/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Design Graph');
  await expect(page.getByText('The lifecycle walk from this record')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(16);
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
  await expect(result).toHaveAttribute('href', /^\/graph\/LearningMetric\/.*walk=1$/);
  await page.goto((await result.getAttribute('href'))!);
  await expect(page.locator('.gnode-root')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Walkthrough' })).toContainText('step 1 of');
});

test('the Walkthrough walks Narrative 1 from the result to the evidence', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph/LearningMetric/mod3-bias-type-difficulty?walk=1');
  const walk = page.getByRole('complementary', { name: 'Walkthrough' });
  await expect(walk).toContainText('step 1 of 10');
  await expect(walk).toContainText('0.38 proportion correct on Identifying training data bias');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
  await expect(walk).toContainText('step 3 of 10');
  await expect(walk).toContainText(/1 was placed after the cohort's commit \([0-9a-z]{10}\), so the cohort met 3/);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await expect(walk).toContainText('step 7 of 10');
  await expect(walk).toContainText('Adequate when?');
  await expect(walk).toContainText(/was partially assessed in Risks and Ethical Use: 1 eligible item/);
  await expect(walk).toContainText('Today it is fully assessed: 2 eligible items');
  await expect(walk.getByRole('link', { name: /Coverage View as of/ })).toHaveAttribute('href', /^\/coverage\/risks-and-ethics\?ref=/);
  await expect(page).toHaveURL(/walk=7/);
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(walk).toContainText('Then and now');
  await expect(walk).toContainText(/records added \(/);
  await expect(page.locator('.gnode-added')).not.toHaveCount(0);
  await walk.getByRole('button', { name: '10', exact: true }).click();
  await expect(walk).toContainText('The loop closes');
  await expect(walk).toContainText('ID Conference Survey');
  expect(await page.locator('.gnode:not(.gnode-dim)').count()).toBeGreaterThanOrEqual(7);
  await page.keyboard.press('Escape');
  await expect(walk).toHaveCount(0);
  await expect(page).not.toHaveURL(/walk=/);
  expect(errors).toEqual([]);
});

test('the coverage lens tints each objective by its verdict and its legend carries the read\'s counts', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph?lens=coverage');
  const legend = page.getByLabel('Legend');
  await expect(legend).toContainText('Uncovered3');
  await expect(legend).toContainText('Partially assessed2');
  await expect(legend).toContainText('Fully assessed2');
  await expect(page.locator('.gnode-lens-fill')).toHaveCount(7);
  await expect(page.getByRole('button', { name: /^LearningObjective, Distinguish Bias Types, Fully assessed/ })).toBeVisible();
  await page.getByLabel('Projected', { exact: true }).check();
  await expect(page).toHaveURL(/projected=1/);
  await expect(legend).toContainText('Uncovered1');
  expect(errors).toEqual([]);
});

test('the other lenses answer from their reads: alignment, attestations, outcomes, changes since a commit', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph?lens=alignment');
  await expect(page.getByLabel('Legend')).toContainText('Item assessing no objective1');
  await expect(page.getByRole('button', { name: /^AssessmentItem, The step after a prediction, No objective/ })).toBeVisible();
  expect(await page.locator('.gnode-dim').count()).toBeGreaterThan(10);

  await page.getByLabel('Attestations', { exact: true }).check();
  await expect(page).toHaveURL(/lens=attestations/);
  await expect(page.getByLabel('Legend')).toContainText('Current1');
  await expect(page.getByRole('button', { name: /^AssessmentItem, Identifying training data bias, Current/ })).toBeVisible();

  await page.getByLabel('Outcomes', { exact: true }).check();
  await expect(page.getByLabel('Legend')).toContainText('Well below the median1');
  await expect(page.getByRole('button', { name: /^AssessmentItem, Identifying training data bias, 0.38 proportion correct/ })).toBeVisible();

  // Two commits are named: the results the finding judged, and the design the pilot met.
  await page.getByLabel('Changes since', { exact: true }).check();
  const since = page.getByLabel('Since a commit the graph names');
  const option = async (text: string) => (await since.locator('option', { hasText: text }).getAttribute('value'))!;
  await since.selectOption(await option('One item carries the bias objective'));
  await expect(page).toHaveURL(/lens=changes&since=/);
  await expect(page.getByLabel('Legend')).toContainText('Added since3');
  await expect(page.getByRole('button', { name: /^AssessmentItem, Telling output bias from training data bias, Added since/ })).toBeVisible();
  await since.selectOption(await option('Module 3 capstone, spring 2026 pilot'));
  await expect(page.getByLabel('Legend')).toContainText('Added since8');
  await expect(page.getByRole('button', { name: /^LearningDataset, Module 3 capstone, spring 2026 pilot, Added since/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('figure mode stamps the view and exports it as a PNG', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph?lens=coverage&figure=1&legend=1');
  await expect(page.getByLabel('Figure stamp')).toHaveText(/^Armature · main @ [a-z0-9]{8} · \/graph\?lens=coverage · \d{4}-\d{2}-\d{2}$/);
  await expect(page.getByLabel('Figure legend')).toContainText('Lens · coverage');
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^armature-graph-main-[a-z0-9]{8}\.png$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(bytes.length).toBeGreaterThan(50_000);
  await page.getByRole('button', { name: 'Exit figure mode' }).click();
  await expect(page).not.toHaveURL(/figure=/);
  expect(errors).toEqual([]);
});

test('the dot grid changes scale with the zoom: the finest layer at the maximum, the coarsest at the minimum', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const layers = page.locator('.react-flow__background');
  await expect(layers).toHaveCount(3);
  const opacities = () => layers.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).style.opacity)));
  expect(await opacities()).toContain(1);
  // Where each layer's dots fall along x, modulo the finest layer's spacing: the
  // tile starts at the pattern's x, is moved by its patternTransform, and holds
  // the dot at cx. Coarser dots land on finer ones.
  const { fine, phases } = await layers.evaluateAll((els) => {
    const fine = Number(els[0].querySelector('pattern')!.getAttribute('width'));
    const phases = els.map((e) => {
      const pattern = e.querySelector('pattern')!;
      const shift = Number(/translate\((-?[\d.]+),/.exec(pattern.getAttribute('patternTransform') ?? '')?.[1] ?? 0);
      const cx = Number(e.querySelector('circle')!.getAttribute('cx'));
      const x = Number(pattern.getAttribute('x')) + shift + cx;
      return ((x % fine) + fine) % fine;
    });
    return { fine, phases };
  });
  for (const phase of phases.slice(1)) {
    const apart = Math.abs(phase - phases[0]);
    expect(Math.min(apart, fine - apart)).toBeLessThan(0.01);
  }
  const zoomIn = page.getByRole('button', { name: 'Zoom In' });
  const zoomOut = page.getByRole('button', { name: 'Zoom Out' });
  for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i++) await zoomIn.click();
  await expect.poll(opacities).toEqual([1, 0, 0]);
  for (let i = 0; i < 40 && (await zoomOut.isEnabled()); i++) await zoomOut.click();
  await expect.poll(async () => (await opacities()).map((o) => (o === 1 ? 1 : o === 0 ? 0 : 'between'))).toEqual([0, 'between', 1]);
  await page.goto('/graph?figure=1');
  await expect(page.getByLabel('Figure stamp')).toBeVisible();
  await expect(layers).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('column headers shorten as the columns narrow, and return in full', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const zoomIn = page.getByRole('button', { name: 'Zoom In' });
  const zoomOut = page.getByRole('button', { name: 'Zoom Out' });
  for (let i = 0; i < 5; i++) await zoomIn.click();
  await expect(page.getByText('Assessments and lessons')).toBeVisible();
  await expect(page.getByText('Notes and findings')).toBeVisible();
  for (let i = 0; i < 40 && (await zoomOut.isEnabled()); i++) await zoomOut.click();
  await expect(page.getByText('Assess. lessons', { exact: true })).toBeVisible();
  await expect(page.getByText('Notes', { exact: true })).toBeVisible();
  await expect(page.getByText('Assessments and lessons')).toHaveCount(0);
  await expect(page.getByTitle('Assessments and lessons')).toBeVisible();
  for (let i = 0; i < 12; i++) await zoomIn.click();
  await expect(page.getByText('Assessments and lessons')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the branch picker names the branch on every page, with its head', async ({ page }) => {
  await page.goto('/graph?lens=coverage');
  const picker = page.getByLabel('Branch');
  await expect(picker).toHaveValue('main');
  await expect(picker.locator('option').first()).toHaveText(/^main · [a-z0-9]{8}$/);
  await page.goto('/coverage/risks-and-ethics');
  await expect(page.getByLabel('Branch')).toHaveValue('main');
});

test('moving around (§5.2): hover keeps a neighborhood and recedes the rest, a hovered edge shows its label, arrows pan, z frames the selection', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/graph');
  const transform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform);
  const item = page.getByRole('button', { name: /^AssessmentItem, Identifying training data bias/ });
  await item.hover();
  await expect(page.locator('.gnode-hover-dim')).not.toHaveCount(0);
  await expect(page.locator('.gedge-hover-lit')).not.toHaveCount(0);
  await expect(page.locator('.gedge-hover-lit .react-flow__edge-text').first()).toHaveText(/assesses|subject/);
  await page.getByRole('heading', { name: 'Design Graph' }).hover();
  await expect(page.locator('.gnode-hover-dim')).toHaveCount(0);
  // React Flow's edge hover is a mouseenter on the edge's group; a bezier's bounding-box center is rarely on its stroke, so the event is sent.
  await page.locator('.react-flow__edge.gedge-reference').first().locator('path').first().dispatchEvent('mouseover');
  await expect(page.locator('.gedge-hover')).toHaveCount(1);
  await expect(page.locator('.gedge-hover .react-flow__edge-text')).toBeVisible();
  const before = await transform();
  await page.keyboard.press('ArrowRight');
  await expect.poll(transform).not.toBe(before);
  await item.click();
  const selected = await transform();
  await page.keyboard.press('z');
  await expect.poll(transform).not.toBe(selected);
  await page.getByRole('button', { name: 'Frame' }).click();
  expect(errors).toEqual([]);
});
