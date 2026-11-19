import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES} from './harness.mjs';

const source = await readFile(process.env.BC_SCRIPT || new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
const installedVersion = /^\/\/ @version\s+(\S+)/m.exec(source)?.[1];
assert(installedVersion, 'the fixture uses the script version from the installed build');
const newerVersion = `${Number(installedVersion.split('.')[0]) + 1}.0.0`;
const release = {
  version: newerVersion,
  body: `# v${newerVersion}\n\n## Fixes\n\n- A release with useful changes.`,
  url: `https://github.com/twalichiewicz/Backchannel/releases/tag/v${newerVersion}`,
};

const cases = [
  {name: 'light Reader', reader: true, width: 1440, theme: 'light', found: false},
  {name: 'light phone Reader', reader: true, width: 390, theme: 'light', found: false},
  {name: 'dark phone Reader', reader: true, width: 390, theme: 'dark', found: true},
  {name: 'dark Sidebar', reader: false, width: 1440, theme: 'dark', found: true},
];

async function openGeneral({reader, width, theme, found}) {
  const app = await launchApp({
    source,
    version: installedVersion,
    handler: 'Userscripts',
    sharedStore: true,
    viewport: {width, height: 900},
    ...(reader ? {} : {appHost: new URL(STORIES[0].url).hostname}),
    settings: {sources: {hn: true}, frontPageMode: 'sources', theme, autoOpenSidebar: !reader, updateCheck: false},
    values: {'HNewhere:update_check': {checkedAt: Date.now(), tipShown: found ? newerVersion : '', releases: found ? [release] : []}},
  });
  app.consoleErrors = [];
  app.page.on('console', message => {
    if (message.type() === 'error') app.consoleErrors.push(message.text());
  });
  try {
    await app.page.goto(reader ? 'https://backchnnl.app/' : STORIES[0].url);
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('[data-settings-section="general"]').click();
    await app.page.locator('#settings-cache-clear').waitFor({timeout: 3000});
    return app;
  } catch (error) {
    await app.browser.close();
    throw error;
  }
}

for (const fixture of cases) {
  test(`${fixture.name} retains the Updates card around the status and right-hand action`, {timeout: 15000}, async () => {
    const app = await openGeneral(fixture);
    try {
      const group = app.page.locator('.settings-updates');
      const status = fixture.found ? 'Update available for Backchannel' : 'Backchannel is up-to-date';
      await group.getByText(status, {exact: true}).waitFor({timeout: 3000});
      assert.equal(await group.getByRole('button', {name: /^(?:Check for updates|Update)$/}).count(), 1);
      assert.equal(await group.getByRole('button', {name: fixture.found ? 'Update' : 'Check for updates', exact: true}).isVisible(), true);
      const layout = await group.evaluate(updates => {
        const card = updates.querySelector('.settings-installed');
        const headline = card.querySelector('#settings-update-status');
        const version = card.querySelector('.appearance-row-hint');
        const action = [...card.querySelectorAll('#settings-update-check, #settings-update-install')].find(node => !node.hidden);
        const reference = updates.getRootNode().querySelector('.manage-table:not(.settings-installed)');
        const box = node => {
          const rect = node.getBoundingClientRect();
          return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        };
        const style = node => {
          const computed = getComputedStyle(node);
          return {
            background: computed.backgroundColor,
            borders: ['Top', 'Right', 'Bottom', 'Left'].map(side => ({
              width: computed[`border${side}Width`],
              style: computed[`border${side}Style`],
              color: computed[`border${side}Color`],
            })),
            radius: computed.borderRadius,
            paddingLeft: parseFloat(computed.paddingLeft),
            paddingRight: parseFloat(computed.paddingRight),
          };
        };
        const cardStyle = style(card);
        const textFits = node => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().width <= node.getBoundingClientRect().width + 1;
        };
        return {
          card: box(card), headline: box(headline), version: box(version), action: box(action),
          cardStyle, referenceStyle: style(reference),
          versionText: version.textContent.trim(),
          textFits: textFits(headline) && textFits(version),
        };
      });
      assert.notEqual(layout.cardStyle.background, 'rgba(0, 0, 0, 0)', 'the update status has a visible card fill');
      assert.equal(layout.cardStyle.background, layout.referenceStyle.background, 'the card keeps the existing settings card theme fill');
      assert.deepEqual(layout.cardStyle.borders, layout.referenceStyle.borders, 'the card keeps the existing settings card border on every edge');
      assert(layout.cardStyle.borders.every(border => border.width === '1px' && border.style === 'solid'));
      assert.equal(layout.cardStyle.radius, layout.referenceStyle.radius, 'the card keeps the existing rounded corners');
      assert.equal(layout.cardStyle.radius, '6px');
      const innerLeft = layout.card.left + 1 + layout.cardStyle.paddingLeft;
      const innerRight = layout.card.right - 1 - layout.cardStyle.paddingRight;
      assert(layout.cardStyle.paddingLeft >= 8 && layout.cardStyle.paddingRight >= 8, 'status and action have padding inside the border');
      assert(Math.abs(layout.headline.left - innerLeft) <= 2, 'the status aligns with the card content edge');
      assert(Math.abs(layout.action.right - innerRight) <= 2, 'the action aligns with the card content edge');
      assert(Math.abs(layout.version.left - layout.headline.left) <= 2, 'the version aligns with the status');
      assert(layout.version.top >= layout.headline.bottom - 1, 'the version stays below the status');
      assert.equal(layout.versionText, `v${installedVersion}`);
      assert(layout.headline.right + 8 <= layout.action.left, 'the status stays in the column left of the action');
      assert(layout.version.right + 8 <= layout.action.left, 'the version stays in the column left of the action');
      assert(layout.headline.top < layout.action.bottom && layout.action.top < layout.headline.bottom, 'status and action share a row');
      assert(layout.action.bottom <= layout.card.bottom - 1, 'the action stays inside the card');
      assert.equal(layout.textFits, true, 'the status and version fit their left column without horizontal clipping');
      assert.deepEqual(app.errors, []);
      assert.deepEqual(app.consoleErrors, []);
    } finally { await app.browser.close(); }
  });

  test(`${fixture.name} separates Cached data from Updates while retaining its right-hand action`, {timeout: 15000}, async () => {
    const app = await openGeneral(fixture);
    try {
      const layout = await app.page.locator('#settings-cache-clear').evaluate(action => {
        const group = action.closest('.settings-group');
        const updates = group.getRootNode().querySelector('.settings-updates');
        const labels = [...group.querySelectorAll('*')].filter(node => !node.childElementCount && node.textContent.trim() === 'Cached data' && node.getClientRects().length);
        const label = labels[0];
        const row = action.closest('.appearance-row');
        const box = node => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
        };
        let divider = label;
        while (divider && group.contains(divider) && parseFloat(getComputedStyle(divider).borderTopWidth) === 0) {
          if (divider === group) { divider = null; break; }
          divider = divider.parentElement;
        }
        const dividerStyle = divider && getComputedStyle(divider);
        const probe = document.createElement('span');
        probe.style.color = 'var(--surface-divider)';
        group.append(probe);
        const themeDivider = getComputedStyle(probe).color;
        probe.remove();
        return {
          ownGroup: group !== updates && !updates.contains(group),
          followsUpdates: Boolean(updates.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING),
          labelCount: labels.length,
          labelWeight: label && Number(getComputedStyle(label).fontWeight),
          sameRow: Boolean(row && label && row.contains(label)),
          group: box(group), updates: box(updates), label: box(label), action: box(action), divider: box(divider),
          dividerStyle: dividerStyle && {width: dividerStyle.borderTopWidth, style: dividerStyle.borderTopStyle, color: dividerStyle.borderTopColor},
          themeDivider,
        };
      });
      assert.equal(layout.ownGroup, true, 'Cached data has its own settings subsection');
      assert.equal(layout.followsUpdates, true, 'Cached data follows the complete Updates subsection');
      assert.equal(layout.labelCount, 1, 'the subsection has one visible Cached data heading');
      assert(layout.labelWeight >= 600, 'Cached data keeps the subsection heading weight');
      assert(layout.divider, 'Cached data has a visible subsection divider above its heading');
      assert.deepEqual(layout.dividerStyle, {width: '1px', style: 'solid', color: layout.themeDivider}, 'the divider uses the existing theme separator');
      assert(Math.abs(layout.divider.left - layout.group.left) <= 1 && Math.abs(layout.divider.right - layout.group.right) <= 1, 'the divider spans the subsection width');
      assert(layout.divider.top >= layout.updates.bottom + 8, 'space separates the divider from Updates');
      assert(layout.label.top >= layout.divider.top + 9, 'the heading has space below its divider');
      assert.equal(layout.sameRow, true, 'Cached data and Clear cache share one action row');
      assert(layout.label.right + 8 <= layout.action.left, 'the heading stays left of Clear cache');
      assert(Math.abs(layout.action.right - layout.group.right) <= 2, 'Clear cache aligns with the right edge of its subsection');
      assert(layout.label.top < layout.action.bottom && layout.action.top < layout.label.bottom, 'heading and action share a row on phone and desktop');
      assert.deepEqual(app.errors, []);
      assert.deepEqual(app.consoleErrors, []);
    } finally { await app.browser.close(); }
  });
}

for (const fixture of cases.slice(0, 2).concat(cases.at(-1))) {
  test(`${fixture.name} can switch between Sources, Account sync, and General settings`, {timeout: 15000}, async () => {
    const app = await openGeneral(fixture);
    try {
      const modal = app.page.locator('#app-settings-modal');
      const tab = modal.getByRole('button', {name: 'Account', exact: true});
      const account = modal.locator('#settings-account-sync');
      assert.equal(await account.isVisible(), false);
      await modal.getByRole('button', {name: 'Sources', exact: true}).click();
      await modal.locator('#setting-source-refresh').waitFor();
      await tab.click();
      await account.waitFor();
      assert.equal(await tab.getAttribute('aria-current'), 'page');
      assert.equal(await modal.locator('#app-settings-heading').innerText(), 'Account');
      assert.match(await account.innerText(), /settings, Collection, and reading queue.*across devices/i);
      assert.equal(await modal.locator('#setting-source-refresh').isVisible(), false);
      await modal.getByRole('button', {name: 'General', exact: true}).click();
      await modal.locator('#settings-cache-clear').waitFor();
      assert.equal(await account.isVisible(), false);
      assert.deepEqual(app.errors, []);
    } finally {
      await app.browser.close();
    }
  });
}
