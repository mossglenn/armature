/**
 * The seven pages (docs/desktop-program-plan.md §4) in Chromium against the fake core, which answers
 * with the real core's shapes and refusal codes (src/lib/fakeCore.ts). `?scenario=` picks where the
 * program starts. Each test is a path a person takes, with the refusals they meet along it.
 */
import { expect, test, type Page } from '@playwright/test';

const HEADER_REMOTE = 'http://hub.example.test:3100';
const OIDC_REMOTE = 'https://api.armature.example.edu';
const open = (page: Page, scenario: string) => page.goto(`/?scenario=${scenario}`);
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name, exact: true });

test.describe('connecting', () => {
  test('a fresh program connects to a remote under header, with the warning, then asks who you are', async ({ page }) => {
    await open(page, 'fresh');
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByText('Not connected yet')).toBeVisible();

    await page.getByLabel("The instance's address").fill('https://nowhere.example.edu');
    await page.getByRole('button', { name: 'Read' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be reached');
    await expect(page.getByRole('alert')).toContainText('502 remote_unreachable');

    await page.getByLabel("The instance's address").fill(`${HEADER_REMOTE}/`);
    await page.getByRole('button', { name: 'Read' }).click();
    const instance = page.getByLabel('The instance', { exact: true });
    await expect(instance).toContainText('hub.example.test');
    await expect(instance).toContainText('No sign-in: you say who you are');
    await expect(instance).toContainText('Compatible');
    await expect(instance).toContainText('development arrangement');
    await page.getByRole('button', { name: 'Connect to hub.example.test' }).click();

    await expect(page.getByRole('heading', { name: 'Who are you on this remote?' })).toBeVisible();
    await page.getByLabel('Your identifier on the remote').fill('demo-designer@example.edu');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByText('The hub is running')).toBeVisible();
  });

  test('a remote that signs people in is shown with its issuer, then the sign-in page', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByLabel("The instance's address").fill(OIDC_REMOTE);
    await page.getByRole('button', { name: 'Read' }).click();
    await expect(page.getByLabel('The instance', { exact: true })).toContainText('https://login.example.edu/realms/armature');
    await page.getByRole('button', { name: 'Connect to Armature at Example University' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('a link fills the address and connects nothing until the person reads and confirms', async ({ page }) => {
    await open(page, 'header');
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await page.evaluate((remote) => (window as unknown as { __fakeCore: { link: (r: string) => void } }).__fakeCore.link(remote), OIDC_REMOTE);
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByLabel("The instance's address")).toHaveValue(OIDC_REMOTE);
    await expect(page.getByText('A link asked to connect here')).toBeVisible();
    // The program keeps its remote while workspaces name it.
    await page.getByRole('button', { name: 'Read' }).click();
    await page.getByRole('button', { name: 'Connect to Armature at Example University' }).click();
    await expect(page.getByRole('alert')).toContainText('409 workspaces_exist');
  });
});

test.describe('signing in', () => {
  test('in the browser, then who the remote says you are', async ({ page }) => {
    await open(page, 'oidc');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Continue in your browser')).toBeVisible();
    await expect(page.getByText('If no browser opened, go to')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText('someone@example.edu')).toBeVisible();
    await page.getByRole('button', { name: 'Go to your workspaces' }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
  });

  test('a provider that refuses offline_access is answered with signing in without staying signed in', async ({ page }) => {
    await open(page, 'oidc-scope');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('sign_in_refused · invalid_scope');
    await page.getByRole('button', { name: 'Sign in without staying signed in' }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText('You will sign in again when this sign-in expires')).toBeVisible();
  });

  test('a person the remote does not know is told whom to ask', async ({ page }) => {
    await open(page, 'oidc-unregistered');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('403 not_registered');
    await expect(page.getByRole('alert')).toContainText('from the remote');
    await expect(page.getByText('Ask your instance’s administrator to register you')).toBeVisible();
  });

  test('signed out, a workspace cannot be made, and signing in makes it possible', async ({ page }) => {
    await open(page, 'oidc');
    await nav(page, 'Workspaces').click();
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-5');
    await page.getByRole('button', { name: 'Make the workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('401 signed_out');
    await nav(page, 'Sign in').click();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Go to your workspaces' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-5');
    await page.getByRole('button', { name: 'Make the workspace' }).click();
    await expect(page.getByRole('list', { name: 'Your workspaces' })).toContainText('someone_unit-5');
  });
});

test.describe('the workspaces', () => {
  test('push, bring in and deliver, with each refusal met on the way', async ({ page }) => {
    await open(page, 'header');
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await expect(list).toContainText('demo-designer_unit-3');
    await expect(list.getByRole('button', { name: /demo-designer_unit-3/ })).toContainText('2 unpushed');
    await expect(list.getByRole('button', { name: /demo-designer_unit-3/ })).toContainText('The remote moved');
    await list.getByRole('button', { name: /demo-designer_unit-3/ }).click();

    await expect(page.getByLabel('Unpushed commits')).toContainText('2 commits not yet on the remote');
    await expect(page.getByLabel('Unpushed commits')).toContainText('Rewrite the stem of item 4');

    await page.getByRole('button', { name: 'Bring in main' }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 2 commits.');
    await expect(page.getByLabel('Unpushed commits')).toContainText('Everything here is on the remote');

    await page.getByLabel('Why (required)').fill('Unit 3, reviewed');
    await page.getByRole('button', { name: 'Deliver', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 bring_in_first');

    await page.getByLabel('Message (optional)').fill('Catch up with main');
    await page.getByRole('button', { name: 'Bring in main' }).click();
    await expect(page.getByRole('status')).toContainText('Brought main in: 3 records changed.');

    await page.getByLabel('Why (required)').fill('Unit 3, reviewed');
    await page.getByLabel('Delete the workspace afterwards').check();
    await page.getByRole('button', { name: 'Deliver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(list).not.toContainText('demo-designer_unit-3');
  });

  test('a tool’s write shows as unpushed, and a conflicting bring-in lists its conflicts field by field', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => {
      const fake = (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void; conflictOn: (b: string) => void } }).__fakeCore;
      fake.writeAsTool('demo-designer_glossary', 'Define "anchoring"\n\nArmature-Workspace-Commit: abc');
    });
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ }).click();
    // The message's first line, without the hub's trailer.
    await expect(page.getByLabel('Unpushed commits')).toContainText('Define "anchoring"');
    await expect(page.getByLabel('Unpushed commits')).not.toContainText('Armature-Workspace-Commit');
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await page.evaluate(() => (window as unknown as { __fakeCore: { conflictOn: (b: string) => void } }).__fakeCore.conflictOn('demo-designer_glossary'));
    await page.getByRole('button', { name: 'Bring in main' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('409 merge_conflict');
    await expect(alert).toContainText('1 conflict: open the tool you edit these records in');
    await expect(alert).toContainText('AssessmentItem/item-4 · stem');
    await expect(alert).toContainText('Which of these biases…');
  });

  test('a workspace is made from main, and a branch someone else owns is cloned with the remote’s warning', async ({ page }) => {
    await open(page, 'header');
    // Names are kept as typed: the system may not capitalize or correct them (the Keycloak rehearsal, 2026-11-08).
    for (const field of ['Name', 'From', 'Branch']) {
      const box = page.getByRole('textbox', { name: field, exact: true });
      await expect(box).toHaveAttribute('autocapitalize', 'off');
      await expect(box).toHaveAttribute('spellcheck', 'false');
    }
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-6');
    await page.getByRole('button', { name: 'Make the workspace' }).click();
    await expect(page.getByRole('list', { name: 'Your workspaces' })).toContainText('demo-designer_unit-6');
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-6');
    await page.getByRole('button', { name: 'Make the workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('409 workspace_exists');

    await page.getByRole('textbox', { name: 'Branch' }).fill('someone_unit-2');
    await page.getByRole('button', { name: 'Clone it' }).click();
    await expect(page.getByRole('status')).toContainText('may not: write someone_unit-2');
    await expect(page.getByRole('list', { name: 'Your workspaces' })).toContainText('someone_unit-2');
  });
});

test.describe('removing a workspace', () => {
  test('refused with anything unpushed, confirmed first, and the remote keeps the branch until main has its work', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void } }).__fakeCore.writeAsTool('demo-designer_glossary', 'Define "framing"'));
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    const remove = page.getByLabel('Remove', { exact: true });
    await remove.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await remove.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'demo-designer_glossary' })).toBeVisible();
    await remove.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('The remote keeps the branch, since it has work main does not');
    await expect(list).not.toContainText('demo-designer_glossary');
  });

  test('a workspace delivered without deleting it is removed from the remote too', async ({ page }) => {
    await open(page, 'header');
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_unit-3/ }).click();
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await page.getByRole('button', { name: 'Bring in main' }).click();
    await expect(page.getByRole('status')).toContainText('Brought main in');
    await page.getByLabel('Why (required)').fill('Unit 3, reviewed');
    await page.getByRole('button', { name: 'Deliver', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Delivered into main as');
    await page.getByLabel('Remove', { exact: true }).getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('removed from this machine and from the remote');
  });
});

test.describe('pairing, settings and the log', () => {
  test('the pairing value is shown and copied, and a reset is confirmed first', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'header');
    await nav(page, 'Pairing').click();
    const value = page.getByLabel('The pairing value');
    const before = await value.inputValue();
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(before);
    // Beside it, what a tool sends as Armature-User: under header, the identifier set for the remote.
    await expect(page.getByLabel('Your identifier for tools')).toHaveValue('demo-designer@example.edu');
    await page.getByRole('button', { name: 'Copy your identifier' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('demo-designer@example.edu');

    await page.getByRole('button', { name: 'Reset…' }).click();
    await page.getByRole('group', { name: 'Confirm the reset' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(value).toHaveValue(before);
    await page.getByRole('button', { name: 'Reset…' }).click();
    await page.getByRole('button', { name: 'Reset the pairing' }).click();
    await expect(value).not.toHaveValue(before);
    await expect(value).toHaveValue(/^[0-9a-f]{64}$/);
  });

  test('under oidc the identifier for tools is the one the remote resolves, shown once signed in', async ({ page }) => {
    await open(page, 'oidc');
    await nav(page, 'Pairing').click();
    await expect(page.getByLabel('The pairing value')).toHaveValue(/^[0-9a-f]{64}$/);
    await expect(page.getByLabel('Your identifier for tools')).toHaveCount(0);
    await nav(page, 'Sign in').click();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await nav(page, 'Pairing').click();
    await expect(page.getByLabel('Your identifier for tools')).toHaveValue('someone@example.edu');
  });

  test('settings: a synced folder is warned of, a change the hub needs a restart for offers one, a bad port is refused', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    await expect(page.getByLabel('The remote', { exact: true })).toContainText(HEADER_REMOTE);
    await expect(page.getByLabel('Versions')).toContainText('0.1.0');
    await expect(page.getByLabel('Versions')).toContainText('2026-11-06');

    await page.getByLabel('Workspaces folder').fill('/Users/someone/Dropbox/Armature');
    await page.getByLabel('Port').fill('3102');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('looks like a folder a sync client keeps in sync')).toBeVisible();
    await page.getByRole('button', { name: 'Restart the hub' }).click();
    await expect(page.getByRole('button', { name: 'Restart the hub' })).toBeHidden();
    await expect(page.getByLabel('The hub')).toContainText('http://127.0.0.1:3102');

    await page.getByLabel('Port').fill('70000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('400 bad_settings');
    await expect(page.getByText('Start at login (comes with the release)')).toBeVisible();
  });

  test('the log keeps the earlier lines and follows the hub, paused and resumed from the sidebar', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Log').click();
    const lines = page.getByLabel('Log lines');
    await expect(lines).toContainText('listening at http://127.0.0.1:3101/api/v1');
    await page.getByRole('button', { name: 'Pause the hub' }).click();
    await expect(page.getByText('The hub is paused')).toBeVisible();
    await expect(lines).toContainText('Armature hub stopped');
    await page.getByRole('button', { name: 'Resume the hub' }).click();
    await expect(page.getByText('The hub is running')).toBeVisible();
  });
});
