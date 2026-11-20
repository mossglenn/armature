/**
 * The seven pages (docs/desktop-program-plan.md §4) in Chromium against the fake core, which answers
 * with the real core's shapes and refusal codes (src/lib/fakeCore.ts). `?scenario=` picks where the
 * program starts. Each test is a path a person takes, with the refusals they meet along it.
 */
import { expect, test, type Page } from '@playwright/test';

const HEADER_REMOTE = 'http://hub.example.test:3100';
const OIDC_REMOTE = 'https://api.armature.example.edu';
const HOSTILE_REMOTE = 'https://api.armature-x.example.net';
const open = (page: Page, scenario: string) => page.goto(`/?scenario=${scenario}`);
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name, exact: true });

test.describe('connecting', () => {
  test('a fresh program connects to a remote under header, with the warning, then asks who you are', async ({ page }) => {
    await open(page, 'fresh');
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByText('Not connected')).toBeVisible();

    await page.getByLabel("The instance's address").fill('https://nowhere.example.edu');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByRole('alert')).toContainText('cannot be reached');
    await expect(page.getByRole('alert')).toContainText('502 remote_unreachable');

    await page.getByLabel("The instance's address").fill(`${HEADER_REMOTE}/`);
    await page.getByRole('button', { name: 'Look up' }).click();
    const instance = page.getByLabel('Instance details', { exact: true });
    await expect(instance).toContainText('hub.example.test');
    await expect(instance).toContainText('No sign-in (for testing only)');
    await expect(instance).toContainText('Compatible');
    await expect(instance).toContainText('development arrangement');
    await page.getByRole('button', { name: 'Connect to hub.example.test' }).click();

    await expect(page.getByRole('heading', { name: 'Who are you on hub.example.test?' })).toBeVisible();
    await page.getByLabel('Your ID on hub.example.test').fill('demo-designer@example.edu');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByText('The hub is running')).toBeVisible();
  });

  test('an identifier the remote does not know is said, where it was kept and nothing shown; it is corrected there or on Settings (0.1.4)', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByLabel("The instance's address").fill(HEADER_REMOTE);
    await page.getByRole('button', { name: 'Look up' }).click();
    await page.getByRole('button', { name: 'Connect to hub.example.test' }).click();
    await page.getByLabel('Your ID on hub.example.test').fill('nobody@example.edu');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Still on the step, with the remote's answer in the person's terms and the way on.
    await expect(page.getByRole('heading', { name: 'Who are you on hub.example.test?' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('hub.example.test does not know nobody@example.edu');
    await expect(page.getByRole('alert')).toContainText('ask an administrator of hub.example.test to register you');
    // Typing again takes the sentence away, since it was about the identifier before.
    await page.getByLabel('Your ID on hub.example.test').fill('nobody2@example.edu');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('hub.example.test does not know nobody2@example.edu');

    // Going on keeps it as typed: the Settings page says the same of it, and says who a known one is once saved.
    await page.getByRole('button', { name: 'Go on with it' }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await nav(page, 'Settings').click();
    const machine = page.getByRole('form', { name: 'This computer' });
    await expect(machine.getByLabel('Your ID on hub.example.test')).toHaveValue('nobody2@example.edu');
    await expect(machine.getByRole('alert')).toContainText('hub.example.test does not know nobody2@example.edu');
    await machine.getByLabel('Your ID on hub.example.test').fill('demo-designer@example.edu');
    await machine.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(machine).toContainText('hub.example.test knows demo-designer@example.edu as Demo Designer.');
    await expect(machine).not.toContainText('does not know');
  });

  test('a remote that signs people in is shown with its issuer, then the sign-in page', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByLabel("The instance's address").fill(OIDC_REMOTE);
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByLabel('Instance details', { exact: true })).toContainText('https://login.example.edu/realms/armature');
    await page.getByRole('button', { name: 'Connect to Armature at Example University' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // The sign-in page names the provider the browser will open at, as the card did.
    await expect(page.getByRole('main')).toContainText('at https://login.example.edu/realms/armature');
  });

  test('a hub that claims another instance’s address is shown at the address dialed, with the warning, and the card goes when the address changes', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByLabel("The instance's address").fill(HOSTILE_REMOTE);
    await page.getByRole('button', { name: 'Look up' }).click();
    const instance = page.getByLabel('Instance details', { exact: true });
    // The hub declares the real instance's name and address; the card shows the address dialed and says what the hub claimed.
    await expect(instance).toContainText('Armature at Example University');
    await expect(instance.locator('dd').first()).toHaveText(HOSTILE_REMOTE);
    await expect(instance).toContainText(`says its address is ${OIDC_REMOTE}`);
    await expect(instance).toContainText('Connect only if');
    // Editing the address withdraws the card, so a confirmation never outlives what it was read for.
    await page.getByLabel("The instance's address").fill(OIDC_REMOTE);
    await expect(instance).toHaveCount(0);
  });

  test('connect carries the profile confirmed, and a hub that then answers differently is refused', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByLabel("The instance's address").fill(OIDC_REMOTE);
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByLabel('Instance details', { exact: true })).toContainText('Compatible');
    // The fake's remote changes its provider between the two reads, as a hostile hub could.
    await page.evaluate((issuer) => (window as unknown as { __fakeCore: { changeIssuer: (i: string) => void } }).__fakeCore.changeIssuer(issuer), 'https://login.attacker.example/realms/armature');
    await page.getByRole('button', { name: 'Connect to Armature at Example University' }).click();
    await expect(page.getByRole('alert')).toContainText('409 profile_changed');
    await expect(page.getByRole('alert')).toContainText("The instance's details changed since you looked them up");
  });

  test('a link fills the address and connects nothing until the person reads and confirms', async ({ page }) => {
    await open(page, 'header');
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await page.evaluate((remote) => (window as unknown as { __fakeCore: { link: (r: string) => void } }).__fakeCore.link(remote), OIDC_REMOTE);
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByLabel("The instance's address")).toHaveValue(OIDC_REMOTE);
    await expect(page.getByText('A link asked to connect here')).toBeVisible();
    // The program keeps its remote while workspaces name it.
    await page.getByRole('button', { name: 'Look up' }).click();
    await page.getByRole('button', { name: 'Connect to Armature at Example University' }).click();
    await expect(page.getByRole('alert')).toContainText('409 workspaces_exist');

    // The same link opened again is a new arrival: the page opens again, the field filled (the 2026-11-09 review's P12).
    await nav(page, 'Workspaces').click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await page.evaluate((remote) => (window as unknown as { __fakeCore: { link: (r: string) => void } }).__fakeCore.link(remote), OIDC_REMOTE);
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByLabel("The instance's address")).toHaveValue(OIDC_REMOTE);
    // And a link is for the visit it opened: left, the connect page starts from the address in use.
    await nav(page, 'Settings').click();
    await page.getByRole('button', { name: 'Connect elsewhere' }).click();
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toBeVisible();
    await expect(page.getByLabel("The instance's address")).toHaveValue(HEADER_REMOTE);
    await expect(page.getByText('A link asked to connect here')).toHaveCount(0);
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
    await expect(page.getByRole('alert')).toContainText('by Armature at Example University');
    await expect(page.getByText('is kept. Ask an administrator of Armature at Example University to register you')).toBeVisible();
    // The sign-in itself is kept, and the instance can be asked again without a new one (the 2026-11-09 review's C16).
    await expect(page.getByText('you will not need to sign in again')).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('alert')).toContainText('403 not_registered');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a waiting sign-in is cancelled from its page, found again after leaving it, and a signed-in person is told who they are (the 2026-11-09 review’s P8)', async ({ page }) => {
    await page.goto('/?scenario=oidc&signin=waits');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Continue in your browser')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel the sign-in' }).click();
    // Cancelled by the person: the button again, and no refusal.
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Begun, then the page left: on return the sign-in is still waiting, and the page says so with the way out.
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Continue in your browser')).toBeVisible();
    await nav(page, 'Pairing').click();
    await nav(page, 'Sign in').click();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('A sign-in is already waiting in your browser');
    await page.getByRole('button', { name: 'Cancel the sign-in' }).click();
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    // Signed in, the page left and opened again: it says who, and does not offer to sign in.
    await open(page, 'oidc');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await nav(page, 'Pairing').click();
    await nav(page, 'Sign in').click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await expect(page.getByText('someone@example.edu')).toBeVisible();
  });

  test('signed out, a workspace cannot be made, and signing in makes it possible', async ({ page }) => {
    await open(page, 'oidc');
    await nav(page, 'Workspaces').click();
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-5');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('401 signed_out');
    await nav(page, 'Sign in').click();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Go to your workspaces' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-5');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('list', { name: 'Your workspaces' })).toContainText('someone_unit-5');
  });
});

test.describe('the workspaces', () => {
  test('push, update and a merge request, with each refusal met on the way', async ({ page }) => {
    await open(page, 'header');
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await expect(list).toContainText('demo-designer_unit-3');
    await expect(list.getByRole('button', { name: /demo-designer_unit-3/ })).toContainText('2 to push');
    await expect(list.getByRole('button', { name: /demo-designer_unit-3/ })).toContainText('Changed elsewhere');
    await list.getByRole('button', { name: /demo-designer_unit-3/ }).click();

    await expect(page.getByLabel('Commits to push')).toContainText('2 commits to push');
    await expect(page.getByLabel('Commits to push')).toContainText('Rewrite the stem of item 4');

    await page.getByRole('button', { name: 'Update from main' }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');
    // A request is about what the instance holds, so it is opened with nothing left to push.
    await page.getByLabel('Message (required)').fill('Unit 3, reviewed');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 2 commits.');
    await expect(page.getByLabel('Commits to push')).toContainText('Everything here is on hub.example.test');

    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('A merge request into main is open.');
    const request = page.getByRole('region', { name: 'Merge request' });
    await expect(request).toContainText('Merge request into main');
    await expect(request).toContainText('Unit 3, reviewed');
    await expect(request.getByRole('group', { name: "The merge request's health" })).toContainText('Ready to merge');
    // One request at a time: the form to open one is gone while it is open.
    await expect(page.getByRole('button', { name: 'Open merge request', exact: true })).toHaveCount(0);

    await page.getByLabel('Message (optional)').fill('Catch up with main');
    await page.getByRole('button', { name: 'Update from main' }).click();
    await expect(page.getByRole('status')).toContainText('Updated from main: 3 records.');

    await request.getByLabel('Remove from this computer afterwards').check();
    await request.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('demo-designer_unit-3 is merged into main and removed from this computer');
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
    await expect(page.getByLabel('Commits to push')).toContainText('Define "anchoring"');
    await expect(page.getByLabel('Commits to push')).not.toContainText('Armature-Workspace-Commit');
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await page.evaluate(() => (window as unknown as { __fakeCore: { conflictOn: (b: string) => void } }).__fakeCore.conflictOn('demo-designer_glossary'));
    await page.getByRole('button', { name: 'Update from main' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('409 merge_conflict');
    await expect(alert).toContainText('1 conflict: open the tool you edit these records in');
    await expect(alert).toContainText('AssessmentItem/item-4 · stem');
    await expect(alert).toContainText('Which of these biases…');
  });

  test('push is offered only with something to push, and the update only when the parent has something new, which the page hears of', async ({ page }) => {
    await open(page, 'header');
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ }).click();
    const push = page.getByRole('button', { name: 'Push', exact: true });
    const update = page.getByRole('button', { name: 'Update from main' });
    await expect(page.getByText('Nothing to push.')).toBeVisible();
    await expect(push).toBeDisabled();
    await expect(page.getByText('Up to date with main.')).toBeVisible();
    await expect(update).toBeDisabled();
    // A tool commits: there is something to push. The window is come back to, as after working in the tool.
    await page.evaluate(() => (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void } }).__fakeCore.writeAsTool('demo-designer_glossary', 'Define "anchoring"'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(push).toBeEnabled();
    await push.click();
    await expect(push).toBeDisabled();
    // Main moves on the instance: nobody asks, and the page says so and offers the update.
    await page.evaluate(() => (window as unknown as { __fakeCore: { conflictOn: (b: string) => void } }).__fakeCore.conflictOn('demo-designer_glossary'));
    await expect(page.getByText('Main has 3 records this workspace does not; 1 would conflict.')).toBeVisible();
    await expect(update).toBeEnabled();
  });

  test('a refusal shows what the hub sent with it: how far a push got and what moved, the rules a merge would break, and words for the person (the 2026-11-09 review’s P6, P7)', async ({ page }) => {
    await open(page, 'header');
    const fake = (name: string) => page.evaluate((hook) => (window as unknown as { __fakeCore: Record<string, () => void> }).__fakeCore[hook]!(), name);
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_unit-3/ }).click();
    await expect(page.getByLabel('Commits to push')).toContainText('2 commits to push');

    // A push stopped after its first commit: the progress, where it stopped, what changed on the remote.
    await fake('pushMeetsAMove');
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('412 precondition_failed');
    await expect(alert).toContainText('1 commit was pushed before this and is on hub.example.test.');
    await expect(alert).toContainText('It stopped at commit');
    await expect(alert.getByRole('list', { name: 'Changed on hub.example.test' })).toContainText('AssessmentItem/item-4');
    // The page read the workspace again after the refusal: one commit is left, not the two it showed before (P7).
    await expect(page.getByLabel('Commits to push')).toContainText('1 commit to push');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 1 commit.');
    await fake('bringInBreaksARule');
    await page.getByRole('button', { name: 'Update from main' }).click();
    await expect(alert).toContainText('422 invariant_violation');
    await expect(alert).toContainText('1 rule broken: open the tool you edit these records in');
    await expect(alert.getByRole('list', { name: 'Broken rules' })).toContainText('ModuleActivityLink/a1b2 · sequence · duplicate_sequence: Sequence 2 is taken');

    // A message written for the shell is said for the person: with the hub paused, not "send start".
    await page.getByLabel('The hub').getByRole('button', { name: 'Pause the hub' }).click();
    // Everything is pushed, so Push has nothing to send and is not offered; the update still is.
    await expect(page.getByRole('button', { name: 'Push', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Update from main' }).click();
    await expect(alert).toContainText('The hub is not running. Resume it from the sidebar, then try again.');
    await expect(alert).not.toContainText('send start');
    await expect(alert).toContainText('409 not_started');
  });

  test('nothing is said about the remote until the status is read, and an unreachable remote is said as such (the 2026-11-09 review’s P1)', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => (window as unknown as { __fakeCore: { remoteUnreachable: () => void } }).__fakeCore.remoteUnreachable());
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ }).click();
    await expect(page.getByLabel('Commits to push')).toContainText('hub.example.test cannot be reached, so whether this branch was changed elsewhere is not known.');
    await page.getByRole('button', { name: '← Workspaces' }).click();
    await expect(page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ })).toContainText('Offline');
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ }).click();
    await expect(page.getByLabel('Commits to push')).not.toContainText('Everything here is on hub.example.test');
    await page.getByRole('button', { name: '← Workspaces' }).click();
    // With commits waiting and the remote away, the count is still said.
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_unit-3/ }).click();
    await expect(page.getByLabel('Commits to push')).toContainText('2 commits to push');

    // A status that cannot be read at all: the page says it does not know, under the refusal.
    await page.evaluate(() => (window as unknown as { __fakeCore: { statusUnreadable: () => void } }).__fakeCore.statusUnreadable());
    await page.getByRole('button', { name: '← Workspaces' }).click();
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_glossary/ }).click();
    await expect(page.getByRole('alert')).toContainText('500 store_unreadable');
    await expect(page.getByLabel('Commits to push')).toContainText('what is waiting to be pushed is not known');
    await expect(page.getByLabel('Commits to push')).not.toContainText('Everything here is on hub.example.test');
  });

  test('a workspace is made from a branch; one of yours linked to no computer is linked here; one linked to another is unlinked from it first, its cost said', async ({ page }) => {
    await open(page, 'header');
    // Names are kept as typed: the system may not capitalize or correct them (the Keycloak rehearsal, 2026-11-08).
    for (const field of ['Name', 'From']) {
      const box = page.getByRole('textbox', { name: field, exact: true });
      await expect(box).toHaveAttribute('autocapitalize', 'off');
      await expect(box).toHaveAttribute('spellcheck', 'false');
    }
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-6');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(list).toContainText('demo-designer_unit-6');
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-6');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('409 workspace_exists');
    // A workspace's parent is a branch: nothing is made from a workspace.
    await page.getByRole('textbox', { name: 'Name' }).fill('unit-7');
    await page.getByRole('textbox', { name: 'From' }).fill('demo-designer_glossary');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('409 parent_is_workspace');
    // No branch is cloned any more: a workspace is linked, and someone else's is read on the instance.
    await expect(page.getByText('Clone a branch')).toHaveCount(0);

    const unlinked = page.getByRole('region', { name: 'Your unlinked workspaces' });
    const elsewhere = page.getByRole('region', { name: 'Linked to another computer' });
    await expect(unlinked).toContainText('demo-designer_unit-2');
    await expect(elsewhere).toContainText('demo-designer_rubrics');
    await expect(elsewhere).toContainText('linked to “Office iMac” since');
    // Linking never takes a workspace over: one linked elsewhere offers only to be unlinked from there.
    await expect(elsewhere.getByRole('button', { name: /Link to this computer/ })).toHaveCount(0);
    await elsewhere.getByRole('button', { name: 'Unlink from the other computer: demo-designer_rubrics' }).click();
    const confirm = page.getByRole('group', { name: 'Confirm the unlinking' });
    await expect(confirm).toContainText('Commits on that computer that were not pushed can no longer be pushed. Unlink demo-designer_rubrics?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(elsewhere).toContainText('demo-designer_rubrics');
    await elsewhere.getByRole('button', { name: 'Unlink from the other computer: demo-designer_rubrics' }).click();
    await confirm.getByRole('button', { name: 'Unlink', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('demo-designer_rubrics is unlinked from the other computer. It can now be linked to this one.');
    await expect(elsewhere).toHaveCount(0);
    await expect(unlinked).toContainText('demo-designer_rubrics');

    await unlinked.getByRole('button', { name: 'Link to this computer: demo-designer_rubrics' }).click();
    await expect(page.getByRole('status')).toContainText('demo-designer_rubrics is linked to this computer.');
    await expect(list).toContainText('demo-designer_rubrics');
    await expect(unlinked).not.toContainText('demo-designer_rubrics');
    await expect(unlinked).toContainText('demo-designer_unit-2');
  });

  test('a workspace is unlinked from this computer once everything is pushed, stays on the instance, and is linked again', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void } }).__fakeCore.writeAsTool('demo-designer_glossary', 'Define "framing"'));
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    const unlink = page.getByRole('region', { name: 'Unlink' });
    await expect(unlink).toContainText('Unlink from this computer');
    await unlink.getByRole('button', { name: 'Unlink…' }).click();
    const confirm = page.getByRole('group', { name: 'Confirm the unlinking' });
    await expect(confirm).toContainText('Unlink demo-designer_glossary from this computer?');
    await confirm.getByRole('button', { name: 'Unlink', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await unlink.getByRole('button', { name: 'Unlink…' }).click();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'demo-designer_glossary' })).toBeVisible();
    await unlink.getByRole('button', { name: 'Unlink…' }).click();
    await confirm.getByRole('button', { name: 'Unlink', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('demo-designer_glossary is unlinked from this computer. It is on hub.example.test, and can be linked again here or on another computer.');
    await expect(list).not.toContainText('demo-designer_glossary');
    const unlinked = page.getByRole('region', { name: 'Your unlinked workspaces' });
    await unlinked.getByRole('button', { name: 'Link to this computer: demo-designer_glossary' }).click();
    await expect(list).toContainText('demo-designer_glossary');
  });

  test('a workspace the instance links to another computer, or to none, says so before a push meets the refusal, with the way on', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => {
      const fake = (window as unknown as { __fakeCore: { linkElsewhere: (b: string, l?: string) => void; unlinkFromElsewhere: (b: string) => void } }).__fakeCore;
      fake.linkElsewhere('demo-designer_unit-3', 'Office iMac');
      fake.unlinkFromElsewhere('demo-designer_glossary');
    });
    // Read again as the page is come back to.
    await nav(page, 'Settings').click();
    await nav(page, 'Workspaces').click();
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await expect(list.getByRole('button', { name: /demo-designer_unit-3/ })).toContainText('Linked to another computer');
    await expect(list.getByRole('button', { name: /demo-designer_glossary/ })).toContainText('Not linked to this computer');

    await list.getByRole('button', { name: /demo-designer_unit-3/ }).click();
    const where = page.getByRole('status', { name: 'Where this workspace is linked' });
    await expect(where).toContainText('Linked to another computer: this workspace is linked to “Office iMac” since');
    // With commits that were never pushed, the message is the vocabulary's own, and names the way on.
    await expect(where).toContainText('This workspace was changed elsewhere, and this computer\'s unpushed commits can no longer be pushed. You can discard them and link the workspace again.');
    // Nothing of this computer's is offered on it, with commits waiting or without (the rehearsal of 2026-11-20).
    for (const name of ['Push', 'Update from main', 'Open merge request']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();

    await page.getByRole('button', { name: '← Workspaces' }).click();
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    await expect(where).toContainText('Not linked to this computer: this workspace was unlinked, and is linked to no computer.');
    await expect(where).toContainText('Remove it from this computer; it can then be linked again from the Workspaces page.');
    for (const name of ['Push', 'Update from main', 'Open merge request']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  });
});

interface ChecksHooks {
  writeAsTool: (branch: string, message: string) => void;
  mayNotMerge: () => void;
  mergedElsewhere: (branch: string) => void;
  parentMoves: (branch: string) => void;
  reportRun: (branch: string, check: string, conclusion: string, summary?: string, detailsUrl?: string) => void;
  remoteRequires: (check: string, locked?: boolean) => void;
  remoteReports: (branch: string, check: string, conclusion: string, summary?: string) => void;
  breakChecksFile: () => void;
}
const hooks = <T extends unknown[]>(page: Page, work: (fake: ChecksHooks, ...args: T) => void, ...args: T) =>
  page.evaluate(([source, given]) => new Function('fake', '...args', `return (${source})(fake, ...args)`)((window as unknown as { __fakeCore: ChecksHooks }).__fakeCore, ...(given as unknown[])), [work.toString(), args] as const);

test.describe('required checks', () => {
  const UNIT3 = 'demo-designer_unit-3';
  const GLOSSARY = 'demo-designer_glossary';
  const openWorkspace = (page: Page, branch: string) => page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: new RegExp(branch) }).click();
  const checks = (page: Page) => page.getByLabel('Checks', { exact: true });

  test('a check of your own is added in Settings, stops a push until its tool reports, and a failing one is set aside with a reason', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    const mine = page.getByRole('form', { name: 'Personal checks' });
    await expect(mine).toContainText('No checks: every push goes straight to hub.example.test.');
    await expect(mine).toContainText('workspaces/checks.json');

    await mine.getByRole('button', { name: 'Add a check' }).click();
    // A check left without a name is said by the form, and nothing is sent (seen in the 0.1.3 rehearsal,
    // where the field's example read as a value already typed and the core's refusal spoke of a broken file).
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine.getByRole('alert')).toContainText('Check 1 has no name');
    await expect(mine).not.toContainText('personal_checks_invalid');
    await mine.getByLabel('Check', { exact: true }).fill('lint/mine');
    await mine.getByLabel('The tool’s settings (JSON)').fill('{"strict": true');
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine.getByRole('alert')).toContainText('The settings of lint/mine are not JSON');
    await mine.getByLabel('The tool’s settings (JSON)').fill('{"strict": true}');
    await mine.getByLabel('Why (optional)').fill('Before anything leaves this machine');
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine).toContainText('Saved. The next push reads them.');
    // Kept as the core wrote it: the settings in the hub's order of reading, the check in force.
    await expect(mine.getByLabel('The tool’s settings (JSON)')).toHaveValue('{"strict":true}');
    await expect(mine.getByLabel('On', { exact: true })).toBeChecked();

    await nav(page, 'Workspaces').click();
    await openWorkspace(page, UNIT3);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 checks_pending');
    await expect(page.getByRole('alert')).toContainText('by this computer');
    await expect(checks(page)).toContainText('Your personal checks');
    await expect(checks(page).getByRole('listitem', { name: 'lint/mine' })).toContainText('Waiting for a report');
    await expect(page.getByLabel('Commits to push')).toContainText('2 commits to push');

    await hooks(page, (fake, branch) => fake.reportRun(branch, 'lint/mine', 'fail', '2 errors, 1 warning', 'http://127.0.0.1:4100/runs/7'), UNIT3);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('422 checks_failed');
    await expect(checks(page).getByRole('listitem', { name: 'lint/mine' })).toContainText('Failed');
    await expect(checks(page)).toContainText('2 errors, 1 warning');
    await expect(checks(page)).toContainText('http://127.0.0.1:4100/runs/7');

    // An override needs its reason; then the push goes, and the page shows what it relied on.
    await expect(page.getByRole('button', { name: 'Push anyway' })).toBeDisabled();
    await page.getByLabel('Reason for overriding lint/mine').fill('Known and harmless');
    await page.getByRole('button', { name: 'Push anyway' }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 2 commits.');
    await expect(checks(page)).toContainText('Overridden: Known and harmless');
    await expect(page.getByRole('button', { name: 'Push anyway' })).toBeHidden();
    await expect(page.getByLabel('Commits to push')).toContainText('Everything here is on hub.example.test');
  });

  test('a check removed, added or changed and not saved is said as unsaved, and the file is as it was until Save checks (0.1.4)', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    const mine = page.getByRole('form', { name: 'Personal checks' });
    const unsaved = mine.getByRole('status');
    await expect(unsaved).toHaveCount(0);
    await mine.getByRole('button', { name: 'Add a check' }).click();
    await expect(unsaved).toContainText('Not saved yet: 1 check added.');
    await mine.getByLabel('Check', { exact: true }).fill('lint/mine');
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine).toContainText('Saved. The next push reads them.');
    await expect(unsaved).toHaveCount(0);

    // Removed from the form only: said so, with what it means for a push, and no claim that nothing is required.
    await mine.getByRole('listitem', { name: 'lint/mine' }).getByRole('button', { name: 'Remove' }).click();
    await expect(unsaved).toContainText('Not saved yet: 1 check removed. The file is as it was, and your pushes are still held to it, until you save.');
    await expect(mine).not.toContainText('No checks: every push goes straight to hub.example.test.');
    await expect(mine).not.toContainText('Saved.');
    // Leaving drops the removal, as before: the check is back and the form agrees with the file.
    await nav(page, 'Workspaces').click();
    await nav(page, 'Settings').click();
    await expect(mine.getByRole('listitem', { name: 'lint/mine' })).toBeVisible();
    await expect(unsaved).toHaveCount(0);

    // A change, then the change undone, then a removal beside an addition, each counted.
    await mine.getByLabel('Why (optional)').fill('For now');
    await expect(unsaved).toContainText('Not saved yet: 1 check changed.');
    await mine.getByLabel('Why (optional)').fill('');
    await expect(unsaved).toHaveCount(0);
    await mine.getByRole('listitem', { name: 'lint/mine' }).getByRole('button', { name: 'Remove' }).click();
    await mine.getByRole('button', { name: 'Add a check' }).click();
    await expect(unsaved).toContainText('Not saved yet: 1 check removed, 1 check added.');
    await mine.getByRole('listitem', { name: 'Check 1' }).getByRole('button', { name: 'Remove' }).click();
    await expect(unsaved).toContainText('Not saved yet: 1 check removed.');

    // Saved, the removal is the file's, and stays so.
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine).toContainText('Saved. The next push reads them.');
    await expect(unsaved).toHaveCount(0);
    await nav(page, 'Workspaces').click();
    await nav(page, 'Settings').click();
    await expect(mine).toContainText('No checks: every push goes straight to hub.example.test.');
  });

  test('a passing run lets a push through, an advisory check never stops one, and a check taken out of force gates nothing', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    const mine = page.getByRole('form', { name: 'Personal checks' });
    await mine.getByRole('button', { name: 'Add a check' }).click();
    await mine.getByLabel('Check', { exact: true }).fill('lint/mine');
    await mine.getByLabel('Workspace', { exact: true }).selectOption(UNIT3);
    await mine.getByRole('button', { name: 'Add a check' }).click();
    const advice = mine.getByRole('listitem', { name: 'Check 2' });
    await advice.getByLabel('Check', { exact: true }).fill('style/advice');
    await mine.getByRole('listitem', { name: 'style/advice' }).getByLabel('When it has not passed').selectOption('Advisory');
    // The same check for the same workspaces twice is refused, since an override could not say which it sets aside.
    await mine.getByRole('button', { name: 'Add a check' }).click();
    await mine.getByRole('listitem', { name: 'Check 3' }).getByLabel('Check', { exact: true }).fill('style/advice');
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine.getByRole('alert')).toContainText('400 bad_request');
    await mine.getByRole('listitem', { name: 'style/advice' }).last().getByRole('button', { name: 'Remove' }).click();
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine).toContainText('Saved.');

    await nav(page, 'Workspaces').click();
    await openWorkspace(page, UNIT3);
    await hooks(page, (fake, branch) => fake.reportRun(branch, 'lint/mine', 'pass', 'No problems'), UNIT3);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 2 commits.');
    await expect(checks(page).getByRole('listitem', { name: 'lint/mine' })).toContainText('Passed');
    await expect(checks(page).getByRole('listitem', { name: 'style/advice' })).toContainText('Waiting for a report');
    await expect(checks(page).getByRole('listitem', { name: 'style/advice' })).toContainText('Advisory');

    // Bound to unit-3 alone, the required check asks nothing of the glossary.
    await page.getByRole('button', { name: '← Workspaces' }).click();
    await hooks(page, (fake, branch) => (fake as unknown as { writeAsTool: (b: string, m: string) => void }).writeAsTool(branch, 'Define "anchoring"'), GLOSSARY);
    await openWorkspace(page, GLOSSARY);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 1 commit.');
  });

  test('a checks file the push gate cannot read stops the push, says where, and is replaced from Settings', async ({ page }) => {
    await open(page, 'header');
    await hooks(page, (fake) => fake.breakChecksFile());
    await openWorkspace(page, UNIT3);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('422 personal_checks_invalid');
    await expect(alert).toContainText('requirements[0].check: check is the name of a check');
    await expect(alert).toContainText('Put the file right on the Settings page');

    await nav(page, 'Settings').click();
    const mine = page.getByRole('form', { name: 'Personal checks' });
    await expect(mine.getByRole('alert')).toContainText('The file cannot be read as checks');
    await expect(mine.getByRole('alert')).toContainText('requirements[0].check');
    await mine.getByRole('button', { name: 'Save checks' }).click();
    await expect(mine).toContainText('No checks: every push goes straight to hub.example.test.');

    await nav(page, 'Workspaces').click();
    await openWorkspace(page, UNIT3);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 2 commits.');
  });

  /** A workspace with one commit pushed, and its page open: something for a request to merge. */
  const pushedWork = async (page: Page, branch: string) => {
    await hooks(page, (fake, b) => fake.writeAsTool(b, 'Define "framing"'), branch);
    await openWorkspace(page, branch);
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Pushed 1 commit.');
  };
  const request = (page: Page) => page.getByRole('region', { name: 'Merge request' });

  test('a merge request the instance’s checks stop shows them in its health, is waited for as they report, then overridden with a reason', async ({ page }) => {
    await open(page, 'header');
    await hooks(page, (fake) => fake.remoteRequires('lint/team'));
    await pushedWork(page, GLOSSARY);

    await page.getByLabel('Message (required)').fill('The glossary, reviewed');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    // The open request is the preview: its health says what a merge would meet, with the instance's results.
    await expect(request(page)).toContainText('Waiting for checks');
    await expect(request(page).getByLabel('Checks', { exact: true })).toContainText('Required checks on hub.example.test');
    await expect(request(page).getByRole('listitem', { name: 'lint/team' })).toContainText('Waiting for a report');
    await expect(page.getByRole('button', { name: 'Merge anyway' })).toBeHidden();

    await request(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 checks_pending');
    await expect(page.getByRole('alert')).toContainText('by hub.example.test');

    // The service reports on the instance, and the health follows without the page being asked to look again.
    await hooks(page, (fake, branch) => fake.remoteReports(branch, 'lint/team', 'fail', 'Objective 3 has no practice activity'), GLOSSARY);
    await expect(request(page)).toContainText('Checks failed');
    await request(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('422 checks_failed');
    await expect(checks(page)).toContainText('Objective 3 has no practice activity');
    await page.getByLabel('Reason for overriding lint/team').fill('The activity lands in unit 4, agreed with J.');
    await page.getByRole('button', { name: 'Merge anyway' }).click();
    await expect(page.getByRole('status')).toContainText('Merged into main as');
    await expect(checks(page)).toContainText('Overridden: The activity lands in unit 4, agreed with J.');
    // Merged, the request is decided, and the form to open another is back.
    await expect(request(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open merge request', exact: true })).toBeVisible();
  });

  test('a locked check is said to be the administrator’s, and the remote’s refusal of an override is shown as given', async ({ page }) => {
    await open(page, 'header');
    await hooks(page, (fake) => fake.remoteRequires('policy/accessibility', true));
    await pushedWork(page, GLOSSARY);
    await page.getByLabel('Message (required)').fill('The glossary');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await request(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 checks_pending');
    await expect(checks(page).getByRole('listitem', { name: 'policy/accessibility' })).toContainText('locked');
    await page.getByLabel(/Reason for overriding policy\/accessibility\s+\(locked/).fill('Trying anyway');
    await page.getByRole('button', { name: 'Merge anyway' }).click();
    await expect(page.getByRole('alert')).toContainText('403 forbidden');
    await expect(page.getByRole('alert')).toContainText('by hub.example.test');
  });

  test('someone who may not merge into the parent opens the request, sees its health follow the parent, and sees it merged by whoever may', async ({ page }) => {
    await open(page, 'header');
    await hooks(page, (fake) => fake.mayNotMerge());
    await pushedWork(page, GLOSSARY);
    await page.getByLabel('Message (required)').fill('The glossary, for review');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await expect(request(page)).toContainText('Ready to merge');
    await expect(request(page)).toContainText('Whoever may merge into main merges it, on hub.example.test.');
    await expect(request(page).getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0);
    // main moves against it: the health says so, and where conflicts are resolved.
    await hooks(page, (fake, branch) => fake.parentMoves(branch), GLOSSARY);
    await expect(request(page)).toContainText('Has conflicts');
    await expect(request(page)).toContainText('Update from main, resolve what it reports in your tool, and push.');
    // A maintainer merges it on the instance: the page shows the request gone, with nothing asked of it.
    await hooks(page, (fake, branch) => fake.mergedElsewhere(branch), GLOSSARY);
    await expect(request(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open merge request', exact: true })).toBeVisible();
  });

  test('a request the opener thinks better of is closed, and one with nothing to merge says so', async ({ page }) => {
    await open(page, 'header');
    await openWorkspace(page, GLOSSARY);
    await page.getByLabel('Message (required)').fill('Nothing yet');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await expect(request(page)).toContainText('Nothing to merge');
    await expect(request(page)).toContainText('main already has everything pushed from here.');
    await request(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 nothing_to_merge');
    await request(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('The merge request into main is closed. Nothing was merged.');
    await expect(request(page)).toHaveCount(0);
  });
});

test.describe('removing a workspace', () => {
  test('refused with anything unpushed, confirmed first, and the remote keeps the branch until main has its work', async ({ page }) => {
    await open(page, 'header');
    await page.evaluate(() => (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void } }).__fakeCore.writeAsTool('demo-designer_glossary', 'Define "framing"'));
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    const remove = page.getByLabel('Remove', { exact: true });
    await remove.getByRole('button', { name: 'Remove…', exact: true }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('409 unpushed_commits');

    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await remove.getByRole('button', { name: 'Remove…', exact: true }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'demo-designer_glossary' })).toBeVisible();
    await remove.getByRole('button', { name: 'Remove…', exact: true }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Its branch is kept on hub.example.test, since it has work its parent does not; link it again to go on with it.');
    await expect(list).not.toContainText('demo-designer_glossary');
    // Kept there, it is a workspace linked to no computer (ADR-0072 decision 4).
    await expect(page.getByRole('region', { name: 'Your unlinked workspaces' })).toContainText('demo-designer_glossary');
  });

  test('a workspace whose commits will never be pushed is discarded, the count confirmed first and checked by the hub', async ({ page }) => {
    await open(page, 'header');
    const write = (message: string) =>
      page.evaluate((m) => (window as unknown as { __fakeCore: { writeAsTool: (b: string, m: string) => void } }).__fakeCore.writeAsTool('demo-designer_glossary', m), message);
    const list = page.getByRole('list', { name: 'Your workspaces' });
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    // Nothing unpushed: nothing to discard is offered.
    const discard = page.getByLabel('Discard', { exact: true });
    await expect(discard).toHaveCount(0);

    await write('Define "framing"');
    await page.getByRole('button', { name: '← Workspaces' }).click();
    await list.getByRole('button', { name: /demo-designer_glossary/ }).click();
    await expect(discard).toContainText('1 commit here is not on hub.example.test');
    await discard.getByRole('button', { name: 'Discard 1 commit and remove…' }).click();
    const confirm = page.getByRole('group', { name: 'Confirm the discard' });
    await expect(confirm).toContainText('Give up 1 commit that is not on hub.example.test, and remove demo-designer_glossary from this computer?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'demo-designer_glossary' })).toBeVisible();

    // A tool writes after the count was shown: the hub refuses the stale count, and the page shows the new one.
    await discard.getByRole('button', { name: 'Discard 1 commit and remove…' }).click();
    await write('Define "anchoring"');
    await confirm.getByRole('button', { name: 'Discard and remove' }).click();
    await expect(page.getByRole('alert')).toContainText('409 discard_mismatch');
    await discard.getByRole('button', { name: 'Discard 2 commits and remove…' }).click();
    await expect(confirm).toContainText('Give up 2 commits that are not on hub.example.test');
    await confirm.getByRole('button', { name: 'Discard and remove' }).click();
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('removed from this computer with 2 commits that were not on hub.example.test');
    await expect(page.getByRole('status')).toContainText('under _discarded/demo-designer_glossary.');
    await expect(page.getByRole('status')).toContainText('hub.example.test was not asked');
    await expect(list).not.toContainText('demo-designer_glossary');
  });

  test('a workspace merged without removing it is removed from the instance too', async ({ page }) => {
    await open(page, 'header');
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_unit-3/ }).click();
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await page.getByRole('button', { name: 'Update from main' }).click();
    await expect(page.getByRole('status')).toContainText('Updated from main');
    await page.getByLabel('Message (required)').fill('Unit 3, reviewed');
    await page.getByRole('button', { name: 'Open merge request', exact: true }).click();
    await page.getByRole('region', { name: 'Merge request' }).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Merged into main as');
    await page.getByLabel('Remove', { exact: true }).getByRole('button', { name: 'Remove…', exact: true }).click();
    await page.getByRole('group', { name: 'Confirm the removal' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Its branch was deleted on hub.example.test, since its parent has all of it.');
  });
});

test.describe('pairing, settings and the log', () => {
  test('the pairing key is shown and copied, and a reset is confirmed first', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'header');
    await nav(page, 'Pairing').click();
    // The page's heading takes the focus when the page opens (the 2026-11-09 review's P13).
    await expect(page.getByRole('heading', { name: 'Pairing' })).toBeFocused();
    const value = page.getByLabel('The pairing key');
    const before = await value.inputValue();
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    // Covered until asked for, and copied either way (P14).
    await expect(value).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(value).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(value).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(before);
    // Beside it, what a tool sends as Armature-User: under header, the identifier set for the remote.
    await expect(page.getByLabel('Your ID on hub.example.test')).toHaveValue('demo-designer@example.edu');
    await page.getByRole('button', { name: 'Copy your ID' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('demo-designer@example.edu');

    await page.getByRole('button', { name: 'New pairing key…' }).click();
    await page.getByRole('group', { name: 'Confirm the new key' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(value).toHaveValue(before);
    await page.getByRole('button', { name: 'New pairing key…' }).click();
    await page.getByRole('button', { name: 'New pairing key', exact: true }).click();
    await expect(value).not.toHaveValue(before);
    await expect(value).toHaveValue(/^[0-9a-f]{64}$/);
  });

  test('a keychain that refuses is said on the page: a reset whose value is not kept, a sign-out whose sign-in is not removed', async ({ page }) => {
    // S5 of the 2026-11-09 review: the new value is in force, and the person is told the old one returns at the next start.
    await page.goto('/?scenario=header&keychain=fails');
    await nav(page, 'Pairing').click();
    const before = await page.getByLabel('The pairing key').inputValue();
    await page.getByRole('button', { name: 'New pairing key…' }).click();
    await page.getByRole('button', { name: 'New pairing key', exact: true }).click();
    await expect(page.getByLabel('The pairing key')).not.toHaveValue(before);
    await expect(page.getByRole('alert')).toContainText('could not be kept in the keychain');
    await expect(page.getByRole('alert')).toContainText('the old key returns');

    // S4: "signed out" is not said alone when the keychain still holds the sign-in.
    await page.goto('/?scenario=oidc&keychain=fails');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await nav(page, 'Settings').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('could not be removed');
    await expect(page.getByRole('alert')).toContainText('signed in again at its next start');
    // The warning belongs to that action: it goes when the person goes elsewhere.
    await nav(page, 'Pairing').click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('under oidc the identifier for tools is the one the remote resolves, shown once signed in', async ({ page }) => {
    await open(page, 'oidc');
    await nav(page, 'Pairing').click();
    await expect(page.getByLabel('The pairing key')).toHaveValue(/^[0-9a-f]{64}$/);
    await expect(page.getByLabel('Your ID on Armature at Example University')).toHaveCount(0);
    // Why it is not there is said (P14).
    await expect(page.getByText(/Sign in, and your ID on .+ is shown here\./)).toBeVisible();
    await nav(page, 'Sign in').click();
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Signed in' })).toBeVisible();
    await nav(page, 'Pairing').click();
    await expect(page.getByLabel('Your ID on Armature at Example University')).toHaveValue('someone@example.edu');
  });

  test('settings: a synced folder is warned of, a change the hub needs a restart for offers one, a bad port is refused', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    await expect(page.getByLabel('Your instance', { exact: true })).toContainText(HEADER_REMOTE);
    await expect(page.getByLabel('Versions')).toContainText('0.1.0');
    await expect(page.getByLabel('Versions')).toContainText('2026-11-20');

    await page.getByLabel('Workspaces folder').fill('/Users/someone/Dropbox/Armature');
    await page.getByLabel('Port').fill('3102');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('looks like a folder a cloud storage app copies to the cloud')).toBeVisible();
    // The workspaces do not move with the setting, and the page says so (the 2026-11-09 review's P9).
    await expect(page.getByRole('form', { name: 'This computer' }).getByRole('alert')).toContainText('workspaces stay in the folder used until now');
    await page.getByRole('button', { name: 'Restart the hub' }).click();
    await expect(page.getByRole('button', { name: 'Restart the hub' })).toBeHidden();
    await expect(page.getByLabel('The hub')).toContainText('http://127.0.0.1:3102');

    // A port that is not a number, or out of range, is refused on the page and nothing is sent: `Number('31o1')` is
    // NaN, which travels as null, which the core reads as "restore the default" (the 2026-11-09 review's P2).
    for (const bad of ['31o1', '70000', '']) {
      await page.getByLabel('Port').fill(bad);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('form', { name: 'This computer' }).getByRole('alert')).toContainText('The port is a whole number from 1 to 65535.');
    }
    await page.getByLabel('Port').fill('3102');
    await page.getByLabel('Older commits kept').fill('many');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('form', { name: 'This computer' }).getByRole('alert')).toContainText('whole number, 0 or more');
    await nav(page, 'Pairing').click();
    await nav(page, 'Settings').click();
    await expect(page.getByLabel('Port')).toHaveValue('3102');
    await expect(page.getByLabel('Older commits kept')).toHaveValue('20');

    // What the core refuses is still shown as the core gave it.
    await page.getByLabel('Workspaces folder').fill('relative/path');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('form', { name: 'This computer' }).getByRole('alert')).toContainText('400 bad_settings');
  });

  test('a hub that could not start is started from the window once its port is changed (the 2026-11-09 review’s P4)', async ({ page }) => {
    await page.goto('/?scenario=header&port=busy');
    // The program opens where the port is put right, and the sidebar says why the hub is not running.
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('The hub')).toContainText('Port 3101 is in use by something else on this computer');
    await page.getByLabel('The hub').getByRole('button', { name: 'Start the hub' }).click();
    await expect(page.getByLabel('The hub')).toContainText('Port 3101 is in use');

    await page.getByLabel('Port').fill('3102');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const offer = page.getByRole('form', { name: 'This computer' }).getByRole('status');
    await expect(offer).toContainText('Saved. The hub is not running.');
    await offer.getByRole('button', { name: 'Start the hub' }).click();
    await expect(page.getByLabel('The hub')).toContainText('The hub is running');
    await expect(page.getByLabel('The hub')).toContainText('http://127.0.0.1:3102');
  });

  test('the opening page waits for the core’s start, so a connected person does not open on Connect (the 2026-11-09 review’s P5)', async ({ page }) => {
    await page.goto('/?scenario=header&start=slow');
    await expect(page.getByRole('main')).toContainText('Starting the hub…');
    await expect(page.getByRole('heading', { name: 'Connect to your instance' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Your workspaces' })).toContainText('demo-designer_unit-3');
  });

  test('the log keeps the earlier lines and follows the hub, paused and resumed from the sidebar', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Diagnostics').click();
    const lines = page.getByLabel('Diagnostic lines');
    await expect(lines).toContainText('listening at http://127.0.0.1:3101/api/v1');
    await page.getByRole('button', { name: 'Pause the hub' }).click();
    await expect(page.getByText('The hub is paused')).toBeVisible();
    await expect(lines).toContainText('Armature hub stopped');
    await page.getByRole('button', { name: 'Resume the hub' }).click();
    await expect(page.getByText('The hub is running')).toBeVisible();
  });
});

test.describe('updates and starting at login', () => {
  test('starting at login is off by default, saved as it is ticked, and kept', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    const box = page.getByRole('checkbox', { name: /Start at login/ });
    await expect(box).not.toBeChecked();
    await box.check();
    await expect(box).toBeChecked();
    await nav(page, 'Workspaces').click();
    await nav(page, 'Settings').click();
    await expect(page.getByRole('checkbox', { name: /Start at login/ })).toBeChecked();
  });

  test('an available update is offered on every page and installed only when asked', async ({ page }) => {
    await page.goto('/?scenario=header&update=available');
    const notice = page.getByRole('region', { name: 'New version' });
    await expect(notice).toContainText('Version 0.2.0 is available (this is 0.1.0)');
    await expect(notice).toContainText('Starts at login when asked.');
    await expect(notice).toContainText('The hub stops while it installs');
    await nav(page, 'Pairing').click();
    await expect(notice).toBeVisible();
    await expect(page.getByText('The hub is running')).toBeVisible();

    await notice.getByRole('button', { name: 'Install and restart' }).click();
    await expect(notice).toContainText('Installing version 0.2.0; the app starts again in a moment');
    await expect(notice.getByRole('button')).toHaveCount(0);
  });

  test('an update that fails to install says why, and stays offered to try again', async ({ page }) => {
    await page.goto('/?scenario=header&update=fails');
    const notice = page.getByRole('region', { name: 'New version' });
    await notice.getByRole('button', { name: 'Install and restart' }).click();
    await expect(notice.getByRole('alert')).toContainText('the signature of the downloaded update does not verify');
    await expect(notice.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await nav(page, 'Diagnostics').click();
    await expect(page.getByLabel('Diagnostic lines')).toContainText('The update to 0.2.0 failed');
  });

  test('the install button waits while a push is running, and the shell is told so', async ({ page }) => {
    await page.goto('/?scenario=header&update=available&slow');
    const notice = page.getByRole('region', { name: 'New version' });
    await expect(notice.getByRole('button', { name: 'Install and restart' })).toBeEnabled();
    await page.getByRole('list', { name: 'Your workspaces' }).getByRole('button', { name: /demo-designer_unit-3/ }).click();
    await page.getByRole('button', { name: 'Push', exact: true }).click();
    await expect(notice.getByRole('button', { name: 'Install and restart' })).toBeDisabled();
    await expect(notice).toContainText('Install when the push finishes');
    await expect(page.getByRole('status').filter({ hasText: 'Pushed 2 commits.' })).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Install and restart' })).toBeEnabled();
    await expect(notice).toContainText('The hub stops while it installs');
  });

  test('a start-at-login entry the system refused is said beside the box, which still shows the setting', async ({ page }) => {
    await page.goto('/?scenario=header&login=fails');
    await nav(page, 'Settings').click();
    const box = page.getByRole('checkbox', { name: /Start at login/ });
    await box.check();
    await expect(box).toBeChecked();
    await expect(page.getByRole('alert')).toContainText('Starting at login could not be turned on (the Launch Agent could not be written)');
  });

  test('the settings page checks the release channel on demand', async ({ page }) => {
    await open(page, 'header');
    await nav(page, 'Settings').click();
    await expect(page.getByRole('region', { name: 'New version' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Look for a new version' }).click();
    await expect(page.getByText('You have the latest version.')).toBeVisible();
  });

  test('a channel that answers without a release is not called the latest version', async ({ page }) => {
    await page.goto('/?scenario=header&update=no_release');
    await nav(page, 'Settings').click();
    await page.getByRole('button', { name: 'Look for a new version' }).click();
    await expect(page.getByText('The release channel answered without a release')).toBeVisible();
    await expect(page.getByText('You have the latest version.')).toHaveCount(0);
  });

  test('a system package is not checked and says how it is updated', async ({ page }) => {
    await page.goto('/?scenario=header&update=packaged');
    await nav(page, 'Settings').click();
    await page.getByRole('button', { name: 'Look for a new version' }).click();
    await expect(page.getByText('This install is a system package')).toBeVisible();
    await expect(page.getByText('You have the latest version.')).toHaveCount(0);
  });
});
