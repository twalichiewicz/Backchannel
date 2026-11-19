import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const source = await readFile(process.env.BC_SCRIPT || new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
const installedVersion = /^\/\/ @version\s+(\S+)/m.exec(source)?.[1];
assert(installedVersion, 'the fixture runs with the actual installed script version');
const newerVersion = `${Number(installedVersion.split('.')[0]) + 1}.0.0`;
const updateKey = 'HNewhere:update_check';
const releasesAPI = 'https://api.github.com/repos/twalichiewicz/Backchannel/releases';
const installURL = 'https://raw.githubusercontent.com/twalichiewicz/Backchannel/main/HNewhere.user.js';
const releaseURL = `https://github.com/twalichiewicz/Backchannel/releases/tag/v${newerVersion}`;
const releaseBody = `# v${newerVersion}\n\n## Fixes\n\n- The available release has useful changes.`;
const available = {version: newerVersion, body: releaseBody, url: releaseURL};
const releaseResponse = {tag_name: `v${newerVersion}`, body: releaseBody, html_url: releaseURL, draft: false, prerelease: false};
const escapedVersion = installedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openUpdates({reader = true, width = 1440, found = false, responses = []} = {}) {
  const app = await launchApp({
    source,
    version: installedVersion,
    handler: 'Userscripts',
    sharedStore: true,
    viewport: {width, height: 900},
    ...(reader ? {} : {appHost: new URL(STORIES[0].url).hostname}),
    settings: {sources: {hn: true}, frontPageMode: 'sources', autoOpenSidebar: !reader, updateCheck: false},
    values: {[updateKey]: {checkedAt: Date.now(), tipShown: found ? newerVersion : '', releases: found ? [available] : []}},
    responses,
  });
  try {
    await app.page.goto(reader ? 'https://backchnnl.app/' : STORIES[0].url);
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('[data-settings-section="general"]').click();
    await app.page.locator('.settings-updates').waitFor({timeout: 3000});
    return app;
  } catch (error) {
    await app.browser.close();
    throw error;
  }
}

async function expectStatus(app, found) {
  const group = app.page.locator('.settings-updates');
  const text = found ? 'Update available for Backchannel' : 'Backchannel is up-to-date';
  const status = group.getByText(text, {exact: true});
  assert(await waitFor(() => status.isVisible(), 2500), `the card headline reports ${text}`);
  const action = group.getByRole('button', {name: found ? 'Update' : 'Check for updates', exact: true});
  assert.equal(await action.isVisible(), true, 'the status has its matching action');
  assert.equal(await group.getByRole('button', {name: /^(?:Check for updates|Update)$/}).count(), 1, 'the card exposes one update action');
  const installed = group.getByText(new RegExp(escapedVersion)).first();
  assert.equal(await installed.isVisible(), true, 'the installed version remains visible');
  assert.doesNotMatch(await group.innerText(), /Userscripts|Safari/, 'the card has no manager instructions');
  assert.equal(await group.getByRole('region', {name: 'Release notes'}).isVisible(), found, 'release notes follow update availability');
  return {group, status, installed, action};
}

for (const [name, reader, width, found] of [
  ['Reader', true, 1440, false],
  ['phone Reader', true, 390, true],
  ['Sidebar', false, 1440, true],
]) test(`${name} Updates card places its status and installed version left of one action`, {timeout: 15000}, async () => {
  const app = await openUpdates({reader, width, found});
  try {
    const {group, status, installed, action} = await expectStatus(app, found);
    const [card, headline, hint, button] = await Promise.all([group.locator('.settings-installed').evaluate(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return{innerRight:r.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth)}}), status.boundingBox(), installed.boundingBox(), action.boundingBox()]);
    assert(hint.y >= headline.y + headline.height - 1, 'the installed version sits below the headline');
    assert(Math.abs(hint.x - headline.x) <= 2, 'the installed version aligns with the headline');
    assert(headline.x + headline.width + 6 <= button.x, 'the headline and action have a visible horizontal gap');
    assert(hint.x + hint.width + 6 <= button.x, 'the installed version stays in the left column');
    assert(Math.abs(card.innerRight - button.x - button.width) <= 2, 'the action aligns with the inner right edge of the styled card');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('phone Reader opens the Settings modal on the first tap while section data is slow', {timeout: 12000}, async () => {
  const app = await launchApp({
    sharedStore: true,
    hasTouch: true,
    viewport: {width:390,height:844},
    slowGets: {key:'HNewhere:hidden_stories',ms:1800,armed:true},
  });
  try {
    app.page.setDefaultTimeout(4500);
    await app.page.goto('https://backchnnl.app/');
    const gear = app.page.locator('#settings-toggle');
    await gear.waitFor();
    await app.page.waitForFunction(() => typeof document.querySelector('[data-hnewhere-app]')?.shadowRoot.getElementById('settings-toggle')?.onclick === 'function');
    await gear.tap();
    const dialog = app.page.getByRole('dialog',{name:'Settings',exact:true});
    assert(await dialog.isVisible(), 'the first tap opens the modal');
    assert.equal(await dialog.locator('#settings-panel').count(),1);
    assert.equal(await app.page.locator('#app-settings-arrow, #settings-crumb-root').count(),0);
    await dialog.getByRole('button',{name:'Sources',exact:true}).tap();
    await dialog.locator('#setting-source-refresh-label').waitFor();
    await dialog.getByRole('button',{name:'Close settings',exact:true}).tap();
    assert.equal(await dialog.isVisible(),false);
    assert.equal(await gear.getAttribute('aria-expanded'),'false');
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('a manual check replaces Check for updates with the available update action', {timeout: 15000}, async () => {
  const app = await openUpdates({responses: [{match: url => url.startsWith(releasesAPI), delay: 600, json: [releaseResponse]}]});
  try {
    const {group, action} = await expectStatus(app, false);
    await action.focus();
    await action.press('Enter');
    assert(await waitFor(() => group.getByRole('button', {name: /Checking/}).isVisible(), 1500), 'the manual check reports progress');
    assert(await waitFor(() => group.getByRole('button', {name: 'Update', exact: true}).isVisible(), 6000), 'the available release becomes the card action');
    await expectStatus(app, true);
    assert.equal(await group.getByRole('button', {name: 'Update', exact: true}).evaluate(button => button.getRootNode().activeElement === button), true, 'keyboard focus transfers to the replacement action');
    assert.equal(app.requests.filter(request => request.url.startsWith(releasesAPI)).length, 1, 'the user check makes one release request');
    assert.equal(app.store.get(updateKey)?.releases?.[0]?.version, newerVersion, 'the result is retained for the next settings view');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('Userscripts Update opens the install-script fallback from the available card', {timeout: 15000}, async () => {
  const app = await openUpdates({found: true});
  try {
    const {action} = await expectStatus(app, true);
    await app.context.route(installURL, route => route.fulfill({status: 200, contentType: 'text/plain', body: 'Fixture install-script destination'}));
    const opened = app.context.waitForEvent('page');
    await action.click();
    const destination = await opened;
    await destination.waitForURL(installURL, {timeout: 3000});
    assert.equal(destination.url(), installURL, 'Update opens the install-script destination');
    assert.equal(await destination.evaluate(() => window.opener === null), true, 'the install-script destination has no opener');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});
