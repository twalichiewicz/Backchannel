import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const STORY = STORIES[0];

function articleHTML(dark) {
  const background = dark ? '#172b3a' : '#f8ead3';
  const color = dark ? '#e5f4ff' : '#352818';
  const prose = '<p>This article has enough readable content to exercise the real article frame, Discussion header, and composer controls while checking their displayed theme.</p>'.repeat(24);
  return `<!doctype html><html style="background:${background}"><head><title>Article theme</title></head><body style="background:${background};color:${color}"><main><article><h1>Article theme</h1>${prose}</article></main></body></html>`;
}

async function chrome(app) {
  return app.page.locator('#app').evaluate(app => {
    const root = app.getRootNode();
    const surface = selector => {
      const style = getComputedStyle(root.querySelector(selector));
      return {background:style.backgroundColor, color:style.color};
    };
    return {hostDark:root.host.classList.contains('hnewhere-dark'), rail:surface('#app-rail'), list:surface('#app-list')};
  });
}

async function activeIcon(app, selector) {
  const button = app.page.locator(selector);
  await button.click();
  assert.equal(await button.getAttribute('aria-expanded'), 'true', 'the actual header action opens');
  const result = await button.evaluate(button => {
    const style = getComputedStyle(button);
    const glyph = selector => {
      const element = button.querySelector(selector);
      return element ? getComputedStyle(element).display : null;
    };
    return {
      color:style.color,
      background:style.backgroundColor,
      iconOn:style.getPropertyValue('--icon-on').trim(),
      iconKnock:style.getPropertyValue('--icon-knock').trim(),
      pressedSolid:style.getPropertyValue('--pressed-solid').trim(),
      pressedHollow:style.getPropertyValue('--pressed-hollow').trim(),
      solidGlyph:glyph('.app-icon-on'),
      hollowGlyph:glyph('.app-icon-off'),
    };
  });
  await button.click();
  assert.equal(await button.getAttribute('aria-expanded'), 'false', 'the actual header action closes');
  return result;
}

async function sample({articleDark, colorScheme, accentColor}) {
  const app = await launchApp({
    sharedStore:true,
    colorScheme,
    pages:{[STORY.url]:{html:articleHTML(articleDark)}},
    settings:{sources:{hn:true}, frontPageMode:'sources', theme:'auto', updateCheck:false, ...(accentColor ? {accentColor} : {})},
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    const before = await chrome(app);
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    assert(await waitFor(async () => await app.page.locator('#app-article-body').getAttribute('data-mode') === 'frame-agent', 10000));
    assert(await waitFor(async () => await app.page.locator('#panel').evaluate((panel, dark) => panel.classList.contains('hnewhere-dark') === dark, articleDark), 3000));
    const panel = await app.page.locator('#panel').evaluate(panel => {
      const style = getComputedStyle(panel);
      return {background:style.backgroundColor, accent:style.getPropertyValue('--accent').trim(), accentInk:style.getPropertyValue('--accent-ink').trim()};
    });
    const footer = app.page.locator('#app-discussion-compose');
    assert.equal(await app.page.locator('#panel > header #comment-toggle').count(),0,'the header has no composer toggle');
    const composer = await footer.evaluate(node=>{
      const panel=node.parentElement.getBoundingClientRect();
      const bar=node.getBoundingClientRect();
      const field=node.querySelector('.compose-field');
      const style=getComputedStyle(field);
      return {attached:Math.abs(panel.bottom-bar.bottom)<2,background:style.backgroundColor,border:style.borderColor,color:getComputedStyle(node.querySelector('.compose-send-comment')).color};
    });
    assert(composer.attached,'the composer sits at the bottom of the Discussion panel');
    const sources = await activeIcon(app, '#app-discussion-meta .page-header-disclosure');
    assert.deepEqual(await chrome(app), before, 'Discussion actions preserve the app chrome theme');
    assert.deepEqual(app.errors, []);
    return {panel, composer, sources};
  } finally {
    await app.browser.close();
  }
}

for (const articleDark of [false, true]) {
  for (const accentColor of [null, '#8444cc']) {
    test(`active Discussion icons follow a ${articleDark ? 'dark' : 'light'} article on an opposing app theme${accentColor ? ' with a custom accent' : ''}`, {timeout:25000}, async () => {
      const expected = await sample({articleDark, colorScheme:articleDark ? 'dark' : 'light', accentColor});
      const actual = await sample({articleDark, colorScheme:articleDark ? 'light' : 'dark', accentColor});
      assert.deepEqual(actual, expected, 'composer and Sources icons use their local Discussion palette');
    });
  }
}
