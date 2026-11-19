import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const appURL = 'https://backchnnl.app/';
const storage = 'HNewhere:account_sync';
const queueStorage = 'HNewhere:queue';
const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const account = 'test-account';
const session = {account, token: 'test-session', expiresAt: Date.now() + 600000, recoveryKey: key, protocol: 2, revision: 0, base: null};

async function settings(app, url = appURL, {recordPasskeyDetails = false, beforeOpen} = {}) {
  app.page.setDefaultTimeout(4000);
  await app.context.addInitScript(({recordPasskeyDetails}) => {
    // Some headless WebKit builds lack WebAuthn. These UI tests mock the
    // ceremony. The Account Worker suite exercises the real Chromium API.
    if (typeof window.PublicKeyCredential !== 'function') {
      window.PublicKeyCredential = class PublicKeyCredential {};
    }
    if (!navigator.credentials) {
      const cancel = () => { throw new DOMException('Passkey cancelled in fixture', 'NotAllowedError'); };
      const credentials = Object.create({create:cancel, get:cancel});
      Object.defineProperty(navigator, 'credentials', {value:credentials, configurable:true});
    }
    if (recordPasskeyDetails) {
      window.passkeyDetails = [];
      Object.defineProperty(PublicKeyCredential, 'signalCurrentUserDetails', {value: details => {
        window.passkeyDetails.push(details);
        return new Promise(() => {});
      }});
    }
  }, {recordPasskeyDetails});
  await app.page.goto(url);
  await beforeOpen?.();
  await app.page.locator('#settings-toggle').click();
  await app.page.getByRole('button', {name: 'Account', exact: true}).click();
  return app.page.locator('#settings-account-sync');
}

test('Reader source diagnostics require a signed-in account with sharing enabled', {timeout:20000}, async () => {
  const app = await launchApp({sharedStore:true, settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false,sourceRefreshMinutes:0}});
  const reports = [];
  const diagnosticsKey = 'HNewhere:account_diagnostics:' + account;
  try {
    app.page.setDefaultTimeout(4000);
    const remote = {revision:0, ciphertext:null, capabilities:{emailAvailable:true}, email:'birb@example.com'};
    await mockAccount(app, remote).start;
    await app.context.route('https://backchnnl.app/account/diagnostics', route => {
      const request = route.request();
      reports.push({body:request.postDataJSON(), authorization:request.headers().authorization});
      return route.fulfill({status:204});
    });
    const sync = app.page.locator('#app-list-sync');
    const reportCheckbox = app.page.getByRole('checkbox',{name:'Share diagnostics',exact:true});
    const syncFrontPage = async () => {
      const before = app.requests.filter(request => request.url === 'https://news.ycombinator.com/news').length;
      await sync.click();
      assert(await waitFor(() => app.requests.filter(request => request.url === 'https://news.ycombinator.com/news').length > before));
      assert(await waitFor(async () => await sync.getAttribute('aria-busy') === null));
    };
    const openPrivacy = async () => {
      const panel = await settings(app);
      await panel.getByRole('button',{name:'Manage account',exact:true}).click();
      await reportCheckbox.waitFor();
      assert(await waitFor(async () => !(await reportCheckbox.isDisabled())));
    };
    await app.page.goto(appURL);
    await syncFrontPage();
    assert.deepEqual(reports,[]);
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('#settings-privacy').waitFor();
    assert.equal(await app.page.locator('#settings-privacy').getByRole('checkbox',{name:'Share diagnostics',exact:true,includeHidden:true}).count(),0);
    await app.page.locator('#app-settings-close').click();
    app.store.set(diagnosticsKey,Date.now()-1000);
    await syncFrontPage();
    assert.deepEqual(reports,[],'saved consent from a signed-out device does not send reports');
    app.store.delete(diagnosticsKey);
    app.store.set(storage,{...session,base:{}});
    await openPrivacy();
    assert.equal(await reportCheckbox.isChecked(),false);
    assert.equal(await reportCheckbox.getAttribute('aria-describedby'),'account-diagnostics-hint');
    assert.equal(await app.page.locator('#account-diagnostics-hint').textContent(),'Help improve Backchannel by sharing anonymized usage data.');
    await reportCheckbox.check();
    assert(await waitFor(() => app.store.get(diagnosticsKey) > 0));
    await app.page.locator('#app-settings-close').click();
    await syncFrontPage();
    assert(await waitFor(() => reports.some(({body}) => body.operation === 'feed' && body.source === 'hn')));
    assert(reports.every(({body,authorization}) => !authorization && Object.keys(body).sort().join(',') === 'duration,operation,outcome,source,version'));

    await openPrivacy();
    await reportCheckbox.uncheck();
    assert(await waitFor(() => app.store.get(diagnosticsKey) === 0));
    const count = reports.length;
    await app.page.reload();
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await syncFrontPage();
    assert.equal(reports.length,count);
  } finally { await app.browser.close(); }
});

function mockAccount(app, remote) {
  const requests = [];
  const start = app.context.route('https://backchnnl.app/account/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(path);
    if (path === '/account/status') return route.fulfill({json: {available: !remote.offline, ...remote.capabilities}});
    if (remote.offline) return route.abort('failed');
    if (path === '/account/diagnostics') return route.fulfill({status: 204});
    assert.equal(request.headers().authorization, 'Bearer test-session');
    if (path === '/account/email') return route.fulfill({json: {email: remote.email || null}});
    if (path === '/account/email/options') return route.fulfill({json:{
      ceremony:'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      options:{challenge:key,rpId:'backchnnl.app',userVerification:'required',allowCredentials:[{id:key,type:'public-key'}]},
    }});
    if (path === '/account/email/start') {
      if (remote.emailSendError) return route.fulfill({status:500,json:{error:remote.emailSendError}});
      if (remote.beforeEmailSend) await remote.beforeEmailSend;
      remote.pendingEmail = request.postDataJSON().email;
      return route.fulfill({json:{verificationId:'account-email-change',retryAfter:60,remainingResends:3}});
    }
    if (path === '/account/email/verify') {
      const { email, verificationId, code } = request.postDataJSON();
      assert.equal(email,remote.pendingEmail);
      assert.equal(verificationId,'account-email-change');
      if (code !== '123456') return route.fulfill({status:401,json:{error:'invalid-email-code'}});
      remote.email = email.toLowerCase();
      return route.fulfill({json:{email:remote.email}});
    }
    if (path === '/account/delete/options') return route.fulfill({json:{
      ceremony: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
      options:{challenge:key, rpId:'backchnnl.app', userVerification:'required', allowCredentials:[{type:'public-key',id:key}]},
    }});
    if (path === '/account/devices/current') {
      const device = request.postDataJSON();
      assert.match(device.id, /^[\w-]{36}$/);
      return route.fulfill({status:204});
    }
    if (path === '/account/devices') {
      return route.fulfill({json:{devices:[
        {id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', name:'Mac · Safari', current:true, lastSeenAt:Date.now()},
        {id:'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', name:'iPhone · Safari', current:false, lastSeenAt:Date.now()},
      ]}});
    }
    if (path === '/account/snapshot' && request.method() === 'GET') {
      if (remote.beforeGet) await remote.beforeGet();
      return route.fulfill({json: {revision: remote.revision, ciphertext: remote.ciphertext}});
    }
    if (path === '/account/snapshot' && request.method() === 'PUT') {
      const beforePut = remote.beforePut;
      remote.beforePut = null;
      if (beforePut) await beforePut();
      const expected = Number(JSON.parse(request.headers()['if-match']));
      if (expected !== remote.revision) return route.fulfill({status: 409, json: {error: 'revision-conflict', revision: remote.revision}});
      remote.revision++;
      remote.ciphertext = request.postDataJSON().ciphertext;
      return route.fulfill({json: {revision: remote.revision}});
    }
    if (path === '/account/session' && request.method() === 'DELETE') return route.fulfill({status: 204});
    await route.fulfill({status: 404, json: {error: 'not-found'}});
  });
  return {start, requests};
}

test('diagnostics consent follows the signed-in account across devices', {timeout: 24000}, async () => {
  const remote = {revision:0, ciphertext:null, email:'birb@example.com', capabilities:{emailAvailable:true}};
  const first = await launchApp({sharedStore:true, values:{[storage]:session, 'HNewhere:share_diagnostics':Date.now()-1000}});
  const second = await launchApp({sharedStore:true, values:{[storage]:session}, viewport:{width:390,height:844}, hasTouch:true});
  const managePrivacy = async app => {
    const panel = await settings(app);
    await panel.getByRole('button',{name:'Manage account',exact:true}).click();
    return panel.getByRole('checkbox',{name:'Share diagnostics',exact:true});
  };
  try {
    await Promise.all([mockAccount(first,remote).start,mockAccount(second,remote).start]);
    const firstChoice = await managePrivacy(first);
    assert(await waitFor(() => first.store.get(storage)?.revision === 1));
    assert.equal(await firstChoice.isChecked(),false,'alpha consent was limited to the old device');
    await firstChoice.check();
    assert(await waitFor(() => first.store.get(storage)?.revision === 2));
    const secondChoice = await managePrivacy(second);
    assert(await waitFor(() => secondChoice.isChecked()),'the second device receives consent');
    await secondChoice.uncheck();
    assert(await waitFor(() => second.store.get(storage)?.revision === 3));
    await first.page.locator('#account-manage-back').click();
    await first.page.getByRole('button',{name:'Sync now',exact:true}).click();
    assert(await waitFor(() => first.store.get(storage)?.revision === 3));
    await first.page.getByRole('button',{name:'Manage account',exact:true}).click();
    assert.equal(await firstChoice.isChecked(),false,'turning sharing off syncs too');
  } finally { await Promise.all([first.browser.close(),second.browser.close()]); }
});

test('importing a different library preserves the account’s existing reading queue', {timeout: 20000}, async () => {
  const remote = {revision:0, ciphertext:null, email:'birb@example.com'};
  const entry = id => ({id, key:`example.com/${id}`, url:`https://example.com/${id}`, title:id, addedAt:10, readAt:null});
  const original = entry('original');
  const imported = entry('imported');
  const app = await launchApp({sharedStore:true, values:{[storage]:session, [queueStorage]:[original]}});
  try {
    await mockAccount(app, remote).start;
    const panel = await settings(app);
    assert(await waitFor(() => app.store.get(storage)?.revision === 1));
    await panel.getByRole('button',{name:'Sign out',exact:true}).click();
    await panel.locator('#account-entry-email').waitFor();
    assert.equal(app.store.get('HNewhere:account_sync_checkpoint')?.revision,1);

    app.store.set('HNewhere:account_data_owner','other-account');
    app.store.set(queueStorage,[imported]);
    app.store.set(storage,session);
    const reopened = await settings(app);
    await reopened.getByRole('button',{name:'Import and sync',exact:true}).click();
    assert(await waitFor(() => app.store.get(storage)?.revision === 2));
    assert.deepEqual(app.store.get(storage).base.collection.queue.map(item => item.id).sort(), ['imported','original']);
  } finally { await app.browser.close(); }
});

test('Account sync uploads a private snapshot and another local profile can apply it', {timeout: 30000}, async () => {
  const uploadStarted = Promise.withResolvers();
  const releaseUpload = Promise.withResolvers();
  const remote = {
    revision:0, ciphertext:null, capabilities:{emailAvailable:true}, email:'birb@example.com',
    beforePut: () => { uploadStarted.resolve(); return releaseUpload.promise; },
  };
  const saved = [{key: 'hn:42', kind: 'comment', url:'https://example.com/article', text:'Secret fixture comment', page:'example.com/article', addedAt: 15}];
  const collection = [{key:'example.com/article', url:'https://example.com/article', title:'Fixture article', addedAt: 6, unwatched:true, checkedAt:100, marks:{hn:23}}];
  const queue = [{id:'queued', key:'example.org/queued', url:'https://example.org/queued', title:'Queued fixture', addedAt:10, readAt:null}];
  const first = await launchApp({sharedStore: true, settings: {theme:'dark', sourceRefreshMinutes:15}, values: {[storage]: session, [queueStorage]:queue, 'HNewhere:favorites': saved, 'HNewhere:collected': collection}});
  const second = await launchApp({sharedStore: true, values: {[storage]: session}});
  try {
    const firstAccount = mockAccount(first, remote);
    await Promise.all([firstAccount.start, mockAccount(second, remote).start]);
    const firstPanel = await settings(first, appURL, {beforeOpen: () => uploadStarted.promise});
    releaseUpload.resolve();
    assert(await waitFor(() => remote.revision === 1), 'the first profile uploads revision 1');
    assert(await waitFor(() => firstAccount.requests.includes('/account/status')), 'opening Account during startup sync still checks availability');
    await firstPanel.locator('#account-last-sync time[datetime]').waitFor({timeout:4000});
    const nav = first.page.locator('.app-settings-nav button').first();
    assert.equal(await nav.getAttribute('data-settings-section'), 'account');
    await nav.getByText('birb@example.com', {exact:true}).waitFor({timeout:2500});
    assert.equal(await nav.locator('.app-account-tab-title').textContent(), 'birb@example.com');
    assert.equal(await nav.locator('.app-account-tab-subtitle').textContent(), 'Backchannel Account');
    assert.equal(await nav.evaluate(node => getComputedStyle(node).borderTopWidth), '0px');
    await firstPanel.getByText('Mac · Safari · This device', {exact:true}).waitFor();
    await firstPanel.getByRole('button', {name:'Sign out iPhone · Safari'}).waitFor();
    const deletionStyle = await firstPanel.getByRole('button',{name:'Delete account…',exact:true}).evaluate(button => ({
      color: getComputedStyle(button).color,
      background: getComputedStyle(button).backgroundColor,
      actions: [...button.closest('#account-actions').querySelectorAll('button:not([hidden])')].map(item => item.textContent),
    }));
    assert.deepEqual(deletionStyle, {color:'rgb(255, 255, 255)', background:'rgb(193, 43, 36)', actions:['Manage account','Sign out','Delete account…']});
    const profile = firstPanel.locator('#account-profile');
    await profile.getByText('birb@example.com',{exact:true}).waitFor();
    const dividerGaps = await firstPanel.evaluate(panel => {
      const box = selector => panel.querySelector(selector).getBoundingClientRect();
      return [
        [box('#account-stage').top - box('#account-email-value').bottom, box('#account-signed-in .account-setting-row').top - box('#account-stage').top - 1],
        [box('#account-devices-section').top - box('#account-signed-in .account-setting-row').bottom, box('#account-devices-section h3').top - box('#account-devices-section').top - 1],
        [box('#account-delete-section').top - box('#account-device-list li:last-child').bottom, box('#account-actions').top - box('#account-delete-section').top - 1],
      ];
    });
    for (const [above, below] of dividerGaps) assert(Math.abs(above - below) < 1);
    const edit = profile.getByRole('button',{name:'Edit birb',exact:true});
    const overlay = edit.locator('.account-avatar-edit-label');
    assert.equal(await overlay.evaluate(node => getComputedStyle(node).opacity),'0');
    await edit.hover();
    assert(await waitFor(async () => await overlay.evaluate(node => getComputedStyle(node).opacity) === '1'));
    assert.equal(await profile.evaluate(header => {
      const edit = header.querySelector('#account-avatar-edit').getBoundingClientRect();
      const center = header.getBoundingClientRect();
      return Math.abs(edit.left + edit.width / 2 - center.left - center.width / 2) < 2;
    }),true,'the avatar edit control is centered in the profile');
    assert.equal(await firstPanel.getByRole('heading',{name:'Recovery email',exact:true}).count(),0);
    const profileLayout = () => profile.evaluate(element => {
      const {x,y,width,height} = element.getBoundingClientRect();
      const scroller = element.getRootNode().getElementById('app-settings-content');
      return {x,y:y + scroller.scrollTop,width,height};
    });
    const header = await profileLayout();
    await firstPanel.getByRole('button',{name:'Manage account',exact:true}).click();
    assert.deepEqual(await profileLayout(), header);
    assert.equal(await firstPanel.getByRole('button',{name:'Sync now',exact:true}).isVisible(),false);
    const manage = firstPanel.locator('#account-manage-page');
    const address = manage.getByLabel('Email address',{exact:true});
    await address.waitFor({timeout:4000});
    assert.equal(await manage.locator('input[type="email"]').count(),1);
    assert.equal(await address.getAttribute('placeholder'),'birb@example.com');
    assert.equal(await address.isEditable(),true);
    assert.equal(await address.inputValue(),'');
    const emptyWidth = (await address.boundingBox()).width;
    const updateEmail = manage.getByRole('button',{name:'Update',exact:true});
    assert.equal(await updateEmail.isVisible(),false);
    const emailHint = manage.locator('#account-email-hint');
    assert.equal(await emailHint.isVisible(),false);
    await address.fill('n');
    await updateEmail.waitFor();
    assert(await updateEmail.isDisabled());
    assert.equal(await emailHint.isVisible(),false);
    await address.fill('birb@example.com');
    await updateEmail.waitFor({state:'hidden'});
    await address.fill('');
    await address.fill('draft-birb@example.com');
    await updateEmail.waitFor();
    await manage.locator('#account-email-update').evaluate(async node => {
      await Promise.all(node.getAnimations().map(animation => animation.finished));
    });
    const sizing = await manage.evaluate(section => {
      const root = section.getRootNode();
      const rect = id => root.getElementById(id).getBoundingClientRect();
      const address = rect('account-email-input');
      const button = rect('account-send-code');
      const privacy = rect('account-manage-privacy');
      const sharing = rect('account-share-diagnostics');
      const sharingLabel = root.getElementById('account-share-diagnostics').closest('label').getBoundingClientRect();
      const sharingText = rect('account-diagnostics-label');
      const sharingHint = rect('account-diagnostics-hint');
      const headingStyle = element => {
        const {fontSize,fontWeight,lineHeight} = getComputedStyle(element);
        return {fontSize,fontWeight,lineHeight};
      };
      return {
        heights:[address.height,button.height],
        expectedHeight:parseFloat(getComputedStyle(root.getElementById('settings-update-check')).height),
        width:address.width,
        gap:button.left-address.right,
        aligned:Math.abs(button.top-address.top) < .5,
        labelWeight:getComputedStyle(section.querySelector('.settings-field-label')).fontWeight,
        heading:headingStyle(root.getElementById('account-manage-heading')),
        referenceHeading:headingStyle(root.querySelector('#account-devices-section h3')),
        sharingWidth:sharing.width,
        sharingHeight:sharing.height,
        sharingFillsRow:Math.abs(sharingLabel.width - privacy.width) < 1 && Math.abs(sharing.left - privacy.left) < 1,
        sharingTextFollowsCheckbox:sharingText.left > sharing.right,
        sharingHintFollowsLabel:Math.abs(sharingText.left - sharingHint.left) < 1 && sharingHint.top >= sharingText.bottom,
      };
    });
    assert(sizing.heights.every(height => Math.abs(height - sizing.expectedHeight) < 0.5));
    assert(sizing.width < emptyWidth && sizing.gap >= 6 && sizing.gap <= 10 && sizing.aligned,JSON.stringify(sizing));
    assert.equal(sizing.labelWeight,'400');
    assert.deepEqual(sizing.heading,sizing.referenceHeading);
    assert(Math.abs(sizing.sharingWidth - sizing.sharingHeight) < 0.5);
    assert(sizing.sharingFillsRow);
    assert(sizing.sharingTextFollowsCheckbox);
    assert(sizing.sharingHintFollowsLabel);
    await first.page.evaluate(() => {
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials), 'get', {value: async () => ({toJSON: () => ({id:'fixture-passkey'})})});
    });
    await emailHint.waitFor();
    assert.match(await emailHint.textContent(),/confirm your identity with your passkey/);
    await updateEmail.click();
    const codeField = first.page.getByLabel('Verification code',{exact:true});
    await codeField.waitFor();
    assert(Math.abs((await codeField.boundingBox()).height - sizing.expectedHeight) < 0.5);
    await codeField.waitFor();
    await address.waitFor({state:'hidden'});
    await manage.getByRole('button',{name:'Back',exact:true}).click();
    await address.waitFor();
    assert.equal(await address.inputValue(),'draft-birb@example.com');
    await codeField.waitFor({state:'hidden'});
    await address.fill('new-birb@example.com');
    await updateEmail.click();
    await codeField.fill('123456');
    assert(await manage.getByRole('heading',{name:'Manage account'}).isVisible());
    assert.equal(remote.email,'birb@example.com');
    assert.equal(await address.getAttribute('placeholder'),'birb@example.com');
    await manage.getByRole('button',{name:'Verify email',exact:true}).click();
    await first.page.locator('#toast.is-showing').filter({hasText:'Email updated.'}).waitFor();
    await codeField.waitFor({state:'hidden'});
    assert.equal(await address.getAttribute('placeholder'),'new-birb@example.com');
    assert.equal(await address.inputValue(),'');
    assert.equal(await emailHint.isVisible(),false);
    assert.equal(await codeField.isVisible(),false);
    assert.equal(await updateEmail.isVisible(),false);
    assert.deepEqual(await profileLayout(), header);
    await firstPanel.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal(await firstPanel.getByLabel('Recovery key', {exact:true}).isVisible(), false, 'a keyed device does not see the unlock input');
    assert.equal(await firstPanel.getByText('Recovery options', {exact:true}).isVisible(), false);
    assert.equal(await firstPanel.getByRole('button', {name:'Show recovery key'}).isVisible(), false);
    const requestGate = Promise.withResolvers();
    remote.beforeGet = () => requestGate.promise;
    try {
      await firstPanel.getByRole('button',{name:'Sync now',exact:true}).click();
      const progress = firstPanel.getByRole('button',{name:'Syncing…',exact:true});
      await progress.waitFor();
      assert(await progress.isDisabled());
      assert.equal(await progress.locator('span').evaluate(el => getComputedStyle(el).animationName),'settings-update-glimmer');
    } finally {
      requestGate.resolve();
      remote.beforeGet = null;
    }
    await firstPanel.getByRole('button',{name:'Sync now',exact:true}).waitFor();
    assert.equal(await firstPanel.getByText('Synced.',{exact:true}).isVisible(),false);
    assert.match(remote.ciphertext,/^[\w-]+$/);
    assert(!remote.ciphertext.includes('Secret fixture comment'));
    await firstPanel.getByRole('button', {name:'Edit birb', exact:true}).click();
    assert.deepEqual(await profileLayout(), header);
    await firstPanel.getByRole('radio', {name:'Long bill', exact:true}).check();
    assert.equal(await profile.locator('#account-profile-avatar').getAttribute('data-birb-shape'),'long-bill');
    assert(await waitFor(() => first.store.get(`HNewhere:account_avatar:${account}`)?.shape === 'long-bill'), 'the first choice saves immediately');
    await firstPanel.getByRole('radio', {name:'Plum', exact:true}).check();
    await firstPanel.getByRole('radio', {name:'Lilac', exact:true}).check();
    assert.equal(await firstPanel.getByRole('button', {name:'Save birb', exact:true}).count(),0);
    assert(await firstPanel.getByRole('heading',{name:'Edit your birb'}).isVisible());
    assert(await waitFor(() => first.store.get(storage)?.base?.preferences?.avatar?.background === 'lilac'), 'the last choice syncs without leaving the editor');
    assert(!remote.ciphertext.includes('lilac'));
    const secondPanel = await settings(second);
    assert.equal(await secondPanel.getByLabel('Recovery key', {exact:true}).isVisible(), false);
    assert(await waitFor(() => second.store.get(storage)?.revision === remote.revision));
    assert.equal(second.store.get('HNewhere:settings').theme,'dark');
    assert.deepEqual(second.store.get('HNewhere:favorites'), saved);
    assert.deepEqual(second.store.get(queueStorage),queue);
    const folder = second.store.get('HNewhere:collected')[0];
    assert.equal(folder.key,collection[0].key);
    assert.equal(folder.unwatched,true);
    assert.equal(folder.checkedAt ?? 0,0,'folder check state stays on its own device');
    await second.page.getByRole('button', {name:'Appearance', exact:true}).click();
    assert(await waitFor(() => second.page.locator('#settings-panel input[data-setting="theme"][value="dark"]').isChecked()));
    await second.page.getByRole('button', {name:'Account', exact:true}).click();
    await secondPanel.getByRole('button', {name:'Edit birb', exact:true}).click();
    for (const name of ['Long bill', 'Plum', 'Lilac']) assert(await secondPanel.getByRole('radio', {name, exact:true}).isChecked());
    await secondPanel.getByRole('radio', {name:'Mint', exact:true}).check();
    await second.page.getByRole('button', {name:'General', exact:true}).click();
    await second.page.getByRole('button', {name:'Account', exact:true}).click();
    await secondPanel.locator('#account-profile').waitFor();
    assert.equal(await secondPanel.getByRole('heading',{name:'Edit your birb'}).isVisible(),false);
    assert.equal(await secondPanel.getByRole('button', {name:'Show recovery key'}).count(),0);
    await secondPanel.getByRole('button', {name:'Sign out', exact:true}).click();
    assert(await waitFor(() => !second.store.get(storage)));
    await secondPanel.locator('#account-entry-email').waitFor();
    assert.equal(await secondPanel.getByText('Recovery options', {exact:true}).count(),0);
    assert.deepEqual(second.store.get('HNewhere:favorites'),saved);
    assert.deepEqual(first.errors,[]);
    assert.deepEqual(second.errors,[]);
  } finally {
    releaseUpload.resolve();
    await Promise.all([first.browser.close(), second.browser.close()]);
  }
});

test('the Account card sends and verifies enrollment codes before initiating a passkey', {timeout:16000}, async () => {
  const app = await launchApp({sharedStore:true, settings:{theme:'light'}});
  const requests = [];
  try {
    await app.context.route('https://backchnnl.app/account/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      requests.push(path);
      if (path === '/account/status') return route.fulfill({json:{available:true,emailAvailable:true}});
      if (path === '/account/email/register/start') {
        if (request.postDataJSON().email === 'limited@example.com') {
          return route.fulfill({status:429,json:{error:'rate-limited',retryAfter:1200}});
        }
        assert.deepEqual(request.postDataJSON(), {email:'fixture@example.com',codeFormat:'numeric'});
        await new Promise(resolve => setTimeout(resolve, 350));
        return route.fulfill({json:{ok:true,verificationId:'fixture-code-id',retryAfter:60,remainingResends:3}});
      }
      if (path === '/account/register/options') {
        assert.deepEqual(request.postDataJSON(), {email:'fixture@example.com', verificationId:'fixture-code-id', code:'123456', flow:'continue'});
        return route.fulfill({status:401,json:{error:'invalid-email-code'}});
      }
      return route.fulfill({status:404,json:{error:'not-found'}});
    });
    const panel = await settings(app);
    await app.page.clock.install();
    const email = panel.locator('#account-entry-email');
    await email.waitFor();
    const entryWidth = (await email.boundingBox()).width;
    const verify = panel.getByRole('button',{name:'Verify email',exact:true});
    const resend = panel.getByRole('button',{name:'Send another code',exact:true});
    assert.equal(await app.page.locator('#app-settings-heading').isVisible(),false);
    assert(Math.abs((await email.boundingBox()).height - (await panel.getByRole('button',{name:'Continue',exact:true}).boundingBox()).height) < .1);
    const profile = panel.locator('#account-profile');
    const header = await profile.boundingBox();
    const avatar = profile.locator('#account-profile-avatar');
    assert.equal(await avatar.evaluate(node => getComputedStyle(node).borderRadius),'50%');
    assert(await avatar.evaluate(node => getComputedStyle(node).backgroundImage.startsWith('url(')));
    await app.page.evaluate(() => {
      const animate = Element.prototype.animate;
      window.accountSlides = [];
      Element.prototype.animate = function (frames, options) {
        if (this.parentElement?.id === 'account-stage' && frames.some(frame => frame.transform)) {
          window.accountSlides.push({id:this.id, frames});
        }
        return animate.call(this, frames, options);
      };
    });
    assert.deepEqual(requests,['/account/status']);
    const continueButton = panel.getByRole('button',{name:'Continue',exact:true});
    for (const invalidEmail of [
      '', 'fixture', 'fixture@local', '.fixture@example.com', 'fixture..birb@example.com',
      'fixture@-example.com', 'fixture@example.com.', 'a'.repeat(65) + '@example.com',
    ]) {
      await email.fill(invalidEmail);
      assert(await continueButton.isDisabled(), 'Continue is disabled for ' + JSON.stringify(invalidEmail));
    }
    await email.fill('fixture@local');
    await email.press('Enter');
    await panel.locator('#account-entry').getByRole('status').filter({hasText:'Enter a valid email address'}).waitFor();
    assert(Math.abs((await panel.getByRole('status').boundingBox()).width - entryWidth) < .1);
    assert(await email.isVisible());
    assert.deepEqual(requests,['/account/status']);
    await email.fill('limited@example.com');
    await continueButton.click();
    await panel.locator('#account-entry').getByRole('status').filter({hasText:'Try again in 20 minutes.'}).waitFor();
    await email.fill('fixture@example.com');
    assert.equal(await panel.getByRole('status').isVisible(),false);
    assert.equal(await continueButton.evaluate(button => getComputedStyle(button).backgroundColor),'rgb(35, 113, 64)');
    await continueButton.click();
    await panel.getByRole('button',{name:'Sending verification code…',exact:true}).waitFor();
    assert(await email.isDisabled());
    assert(await panel.getByRole('button',{name:'Sign in with passkey',exact:true}).isDisabled());
    const field = app.page.getByLabel('Verification code',{exact:true});
    await field.waitFor();
    assert(await field.evaluate(node => node.getRootNode() === document));
    assert.equal(await field.getAttribute('autocomplete'),'one-time-code');
    assert.equal(await field.getAttribute('inputmode'),'numeric');
    assert.equal(await field.getAttribute('maxlength'),'6');
    assert(Math.abs((await field.boundingBox()).width - entryWidth) < .1);
    const [verifyRect,resendRect] = await Promise.all([verify.boundingBox(),resend.boundingBox()]);
    assert(resendRect.y >= verifyRect.y + verifyRect.height && resendRect.width < verifyRect.width);
    assert(await verify.evaluate(el => getComputedStyle(el).backgroundColor !== getComputedStyle(el.parentElement.querySelector('#account-resend-code')).backgroundColor));
    assert(await resend.evaluate(button => {
      const primary = button.getRootNode().getElementById('account-verify-code');
      return parseFloat(getComputedStyle(button).fontSize) < parseFloat(getComputedStyle(primary).fontSize);
    }), 'resend uses smaller link text');
    assert(await resend.isDisabled());
    await panel.locator('#account-resend-control').hover();
    await app.page.getByRole('tooltip').filter({hasText:'Wait a minute'}).waitFor();
    assert((await field.boundingBox()).height > 40);
    await app.page.clock.fastForward(60001);
    assert.equal(await resend.isDisabled(),false);
    assert.equal(await panel.getByRole('textbox',{name:'Email address',exact:true}).count(),0);
    assert.deepEqual(await profile.boundingBox(),header);
    await field.fill('12345');
    assert(await verify.isDisabled());
    await panel.getByRole('heading',{name:'Check your email'}).click();
    await field.focus();
    assert.equal(await field.inputValue(),'12345');
    assert.equal(await field.getAttribute('autocomplete'),'one-time-code');
    await field.fill('123456');
    await field.press('Enter');
    await panel.getByRole('status').filter({hasText:'incorrect or expired'}).waitFor({timeout:4000});
    assert(await panel.locator('#account-code-field').getByRole('status',{exact:true}).isVisible());
    assert(await field.isVisible());
    await panel.getByRole('button',{name:'Back',exact:true}).click();
    await panel.locator('#account-entry-email').waitFor();
    assert.deepEqual(await profile.boundingBox(),header);
    const slides = await app.page.evaluate(() => window.accountSlides);
    assert(slides.some(({frames}) => frames[0].transform === 'translateX(100%)'));
    assert(slides.some(({frames}) => frames[0].transform === 'translateX(-100%)'));
    assert.equal(await email.inputValue(),'fixture@example.com');
    assert.equal(await panel.getByText('Recovery options',{exact:true}).count(),0);
    await app.page.emulateMedia({reducedMotion:'reduce'});
    await panel.getByRole('button',{name:'Continue',exact:true}).click();
    await field.waitFor();
    assert.equal(await app.page.evaluate(() => window.accountSlides.length),slides.length);
    assert.equal(await panel.locator('#account-stage > :not([hidden])').count(),1);
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('passkey cancellation is silent and recovery continues from verified email', {timeout:14000}, async () => {
  const app = await launchApp({sharedStore:true});
  const requests = [];
  const ceremony = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb';
  const options = {challenge:key,rpId:'backchnnl.app',userVerification:'required'};
  let signInError = true;
  try {
    await app.context.route('https://backchnnl.app/account/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      requests.push(path);
      if (path === '/account/status') return route.fulfill({json:{available:true,emailAvailable:true}});
      if (path === '/account/login/options' && signInError) return route.fulfill({status:500,json:{error:'server-error'}});
      if (path === '/account/login/options' || path === '/account/register/options') return route.fulfill({json:{mode:'login',ceremony,options}});
      if (path === '/account/email/register/start') return route.fulfill({json:{ok:true}});
      if (path === '/account/recover/options') {
        assert.equal(request.postDataJSON().signInCeremony,ceremony);
        assert.match(request.postDataJSON().syncKeyVerifier,/^[A-Za-z0-9_-]{43}$/);
        return route.fulfill({json:{mode:'recover',ceremony,options}});
      }
      return route.fulfill({status:404,json:{error:'not-found'}});
    });
    const panel = await settings(app);
    await app.page.evaluate(() => {
      window.accountPasskeyRequests = 0;
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials),'get',{value: () => {
        const cancelled = new DOMException('Unavailable in fixture','NotAllowedError');
        if (++window.accountPasskeyRequests === 2) return new Promise((resolve, reject) => {
          window.cancelAccountPasskey = () => reject(cancelled);
        });
        throw cancelled;
      }});
    });
    const signIn = panel.getByRole('button',{name:'Sign in with passkey',exact:true});
    await signIn.click();
    await panel.locator('#account-status-login').getByRole('status').filter({hasText:'Couldn’t sign in with your passkey'}).waitFor();
    signInError = false;
    await signIn.click();
    await signIn.waitFor();
    assert.equal(await panel.getByRole('status').isVisible(),false);
    await panel.locator('#account-entry-email').fill('fixture@example.com');
    await panel.getByRole('button',{name:'Continue',exact:true}).click();
    await app.page.getByLabel('Verification code',{exact:true}).fill(key);
    await panel.getByRole('button',{name:'Verify email',exact:true}).click();
    assert(await waitFor(() => app.page.evaluate(() => window.accountPasskeyRequests === 2)), 'verification prompts for the passkey');
    assert.equal(await signIn.isVisible(),false);
    await app.page.evaluate(() => window.cancelAccountPasskey());
    await signIn.waitFor();
    assert.equal(await panel.getByRole('status').isVisible(),false);
    const recover = panel.getByRole('button',{name:'Can’t use your passkey?',exact:true});
    assert(await recover.evaluate(button => {
      const primary = button.getRootNode().getElementById('account-passkey-login-submit');
      return button.getBoundingClientRect().top >= primary.getBoundingClientRect().bottom &&
        parseFloat(getComputedStyle(button).fontSize) < parseFloat(getComputedStyle(primary).fontSize);
    }), 'passkey recovery is small and below sign-in');
    await signIn.click();
    await signIn.waitFor();
    assert.equal(await panel.getByRole('status').isVisible(),false);
    assert.equal(await app.page.evaluate(() => window.accountPasskeyRequests),3);
    await recover.click();
    const keyField = panel.getByLabel('Recovery key',{exact:true});
    await keyField.fill(key);
    await panel.getByRole('button',{name:'Continue',exact:true}).click();
    await panel.getByRole('button',{name:'Replace passkey',exact:true}).waitFor();
    assert.equal(requests.filter(path=>path.startsWith('/account/email/')).length,1);
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('phone Account controls match Settings typography and show passkey progress in the button', {timeout:12000}, async () => {
  const app = await launchApp({sharedStore:true, hasTouch:true, viewport:{width:390,height:844}});
  try {
    await app.context.route('https://backchnnl.app/account/**', route => {
      if (route.request().url().endsWith('/status')) return route.fulfill({json:{available:true,emailAvailable:true}});
      return route.fulfill({json:{ceremony:'fixture',options:{challenge:key,rpId:'backchnnl.app',userVerification:'required'}}});
    });
    const panel = await settings(app);
    assert.equal(await app.page.locator('#account-nav-status').isVisible(),false);
    const signIn = panel.locator('#account-login');
    await signIn.waitFor();
    const entry = await signIn.evaluate(button => {
      const root = button.getRootNode();
      const content = root.getElementById('app-settings-content');
      const stage = root.getElementById('account-stage');
      const actions = root.getElementById('account-sign-in-actions').getBoundingClientRect();
      const bottom = content.getBoundingClientRect().bottom - parseFloat(getComputedStyle(content).paddingBottom);
      return {
        topGap:actions.top - stage.getBoundingClientRect().top - parseFloat(getComputedStyle(stage).borderTopWidth),
        bottomGap:bottom - actions.bottom,
        email:root.getElementById('account-entry-email').getBoundingClientRect().height,
        button:button.getBoundingClientRect().height,
        standard:parseFloat(getComputedStyle(root.getElementById('settings-update-check')).height),
      };
    });
    assert(entry.topGap > 12 && Math.abs(entry.topGap - entry.bottomGap) < 1, JSON.stringify(entry));
    assert(Math.abs(entry.button - entry.standard) < .5 && Math.abs(entry.email - entry.button) < .5, JSON.stringify(entry));
    assert.equal(await panel.locator('#account-email-value').textContent(),'Sync your reading experience across all your devices.');
    const mismatches = await signIn.evaluate(control => {
      const root = control.getRootNode();
      const size = getComputedStyle(root.getElementById('settings-cache-clear')).fontSize;
      const controls = [
        ...root.querySelectorAll('#settings-account-sync :is(.settings-button:not(.account-text-action), input[type="email"], input[type="password"])'),
        root.host.querySelector('#account-email-code'),
      ];
      return controls.map(element => [element.id, getComputedStyle(element).fontSize])
        .filter(([, fontSize]) => fontSize !== size);
    });
    assert.deepEqual(mismatches, []);
    await app.page.evaluate(() => {
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials),'get',{value: () => new Promise(() => {})});
    });
    await signIn.tap();
    await panel.getByRole('button',{name:'Signing in…',exact:true}).waitFor();
    assert.equal(await signIn.getAttribute('aria-busy'),'true');
    assert.equal(await signIn.locator('span').evaluate(el => getComputedStyle(el).animationName),'settings-update-glimmer');
    assert.equal(await panel.getByRole('status').isVisible(),false);
  } finally { await app.browser.close(); }
});

test('email updates confirm the passkey before sending a code and anchor request errors to Update', {timeout:20000}, async () => {
  const app = await launchApp({sharedStore:true, values:{[storage]:{...session, base:{}}}});
  try {
    await app.page.clock.install();
    const sending = Promise.withResolvers();
    const remote = {email:'birb@example.com',capabilities:{emailAvailable:true},beforeEmailSend:sending.promise};
    const mock = mockAccount(app,remote);
    await mock.start;
    const panel = await settings(app, appURL, {recordPasskeyDetails:true});
    const passkeyDetails = name => ({
      rpId:'backchnnl.app', userId:Buffer.from(account).toString('base64url'), name, displayName:'Backchannel account',
    });
    await panel.locator('#account-email-value').getByText(remote.email,{exact:true}).waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.passkeyDetails), [passkeyDetails(remote.email)]);
    await panel.getByRole('button',{name:'Manage account',exact:true}).click();
    const manage = panel.locator('#account-manage-page');
    const address = manage.getByLabel('Email address',{exact:true});
    await address.waitFor();
    assert.equal(await address.getAttribute('placeholder'),'birb@example.com');
    const update = manage.getByRole('button',{name:'Update',exact:true});
    assert(await waitFor(() => mock.requests.includes('/account/email/options')));
    await app.page.evaluate(() => {
      const button = document.querySelector('[data-hnewhere-app]').shadowRoot.getElementById('account-send-code');
      if (!button) throw new Error('Update button is missing');
      window.emailPrompts = [];
      window.emailSlides = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        if (this.parentElement?.id === 'account-manage-stage' && frames.some(frame => frame.transform)) {
          window.emailSlides.push({id:this.id, transforms:frames.map(frame => frame.transform)});
        }
        return animate.call(this, frames, options);
      };
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials), 'get', {value: ({publicKey,signal,mediation}) => new Promise(resolve => {
        window.emailPrompts.push({
          allowed:publicKey.allowCredentials?.length, signal, resolve, mediation,
          buttonDisabled:button.disabled, active:navigator.userActivation?.isActive,
        });
      })});
    });
    await address.fill('new-birb@local');
    assert(await update.isDisabled());
    await address.blur();
    const invalidAddress = manage.locator('#account-status-email').getByRole('status').filter({hasText:'Enter a valid email address'});
    await invalidAddress.waitFor();
    await address.press('Enter');
    assert.equal(await app.page.evaluate(() => window.emailPrompts.length),0);
    assert(!mock.requests.includes('/account/email/start'));
    await address.fill('New-Birb+nest@sub.example.com');
    assert.equal(await invalidAddress.isVisible(),false);
    await update.click();
    const opened = await waitFor(() => app.page.evaluate(() => window.emailPrompts.length === 1),4000);
    if (!opened) {
      const count = await app.page.evaluate(() => window.emailPrompts.length);
      assert.fail(`Expected one passkey request. Got ${count}. Status: ${await manage.getByRole('status').allTextContents()}. Page errors: ${app.errors.join(', ')}`);
    }
    await manage.getByRole('button',{name:'Confirming passkey…',exact:true}).waitFor();
    const prompt = await app.page.evaluate(() => {
      const {allowed,buttonDisabled,active,mediation} = window.emailPrompts[0];
      return {allowed,buttonDisabled,active,mediation};
    });
    assert.equal(prompt.allowed,0);
    assert.equal(prompt.buttonDisabled,false);
    assert.equal(prompt.mediation,'required');
    if (prompt.active !== undefined) assert.equal(prompt.active,true);
    assert.equal(mock.requests.filter(path => path === '/account/email/options').length,1);
    assert(!mock.requests.includes('/account/email/start'));
    await app.page.clock.fastForward(61_000);
    const buttonFeedback = manage.locator('#account-status-send-code');
    const toast = buttonFeedback.getByRole('status').filter({hasText:'Passkey confirmation timed out'});
    await toast.waitFor();
    const [buttonBounds, toastBounds, anchorBounds] = await Promise.all([
      update.boundingBox(), toast.boundingBox(), buttonFeedback.boundingBox(),
    ]);
    assert.equal(buttonBounds.width,toastBounds.width);
    assert(anchorBounds.y >= buttonBounds.y + buttonBounds.height - 0.5);
    assert.equal(await toast.evaluate(element => getComputedStyle(element).animationName),'account-field-toast-in');
    assert(await app.page.evaluate(() => window.emailPrompts[0].signal.aborted));
    assert(!mock.requests.includes('/account/email/start'));
    assert(await waitFor(async () => !(await update.isDisabled())));
    await app.page.clock.fastForward(5 * 60_000);
    await address.press('Enter');
    await manage.getByRole('status').filter({hasText:'Select Update again to open the passkey prompt'}).waitFor();
    assert.equal(await app.page.evaluate(() => window.emailPrompts.length),1);
    await address.press('Enter');
    assert(await waitFor(() => app.page.evaluate(() => window.emailPrompts.length === 2)));
    remote.emailSendError = 'server-error';
    await app.page.evaluate(() => window.emailPrompts[1].resolve({toJSON: () => ({id:'fixture-passkey'})}));
    const deliveryError = buttonFeedback.getByRole('status').filter({hasText:'Couldn’t send a verification code'});
    await deliveryError.waitFor();
    assert.equal(await address.getAttribute('aria-invalid'),null);
    assert.equal(await manage.locator('#account-status-email').textContent(),'');
    assert.match(await update.getAttribute('aria-describedby'),/\baccount-status-send-code\b/);
    remote.emailSendError = null;
    await update.click();
    assert(await waitFor(() => app.page.evaluate(() => window.emailPrompts.length === 3)));
    await app.page.evaluate(() => window.emailPrompts[2].resolve({toJSON: () => ({id:'fixture-passkey'})}));
    await manage.getByRole('button',{name:'Sending verification code…',exact:true}).waitFor();
    const heading = manage.getByRole('heading',{name:'Manage account',exact:true});
    const headingLayout = () => heading.evaluate(element => {
      const {x,y,width,height} = element.getBoundingClientRect();
      const parent = element.parentElement.getBoundingClientRect();
      return {x:x - parent.x,y:y - parent.y,width,height};
    });
    const headingPosition = await headingLayout();
    sending.resolve();
    const code = app.page.getByLabel('Verification code',{exact:true});
    await code.waitFor();
    await address.waitFor({state:'hidden'});
    assert.equal(await address.isVisible(),false);
    assert.equal(await update.isVisible(),false);
    assert.deepEqual(await headingLayout(),headingPosition);
    assert.equal(await toast.isVisible(),false);
    const verify = manage.getByRole('button',{name:'Verify email',exact:true});
    await code.fill('000000');
    await verify.click();
    await manage.locator('#account-status-code [data-error]').waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.passkeyDetails), [passkeyDetails('birb@example.com')]);
    await code.fill('123456');
    await verify.click();
    const confirmation = app.page.locator('#toast').filter({hasText:'Email updated.'});
    await confirmation.and(app.page.locator('.is-showing')).waitFor();
    assert.equal(await confirmation.getAttribute('data-kind'),'system');
    await code.waitFor({state:'hidden'});
    assert.equal(await address.getAttribute('placeholder'),'new-birb+nest@sub.example.com');
    assert.equal(await address.inputValue(),'');
    assert.deepEqual(await app.page.evaluate(() => window.emailSlides), [
      {id:'account-manage-email',transforms:['translateX(0)','translateX(-100%)']},
      {id:'account-manage-code',transforms:['translateX(100%)','translateX(0)']},
      {id:'account-manage-code',transforms:['translateX(0)','translateX(100%)']},
      {id:'account-manage-email',transforms:['translateX(-100%)','translateX(0)']},
    ]);
    assert.deepEqual(await headingLayout(),headingPosition);
    assert.equal(await manage.getByRole('status').filter({hasText:'Email updated.'}).isVisible(),false);
    await app.page.clock.fastForward(6000);
    assert.equal(await confirmation.evaluate(node => node.classList.contains('is-showing')),false);
    assert.deepEqual(await app.page.evaluate(() => window.passkeyDetails), [
      passkeyDetails('birb@example.com'), passkeyDetails('new-birb+nest@sub.example.com'),
    ]);
  } finally { await app.browser.close(); }
});

test('new account creation requires email delivery while existing users can sign in', {timeout:10000}, async () => {
  const app = await launchApp({sharedStore:true, values:{[storage]:{...session, protocol:undefined, recoveryKey:''}}});
  try {
    await app.context.route('https://backchnnl.app/account/status', route => route.fulfill({json:{available:true,emailAvailable:false}}));
    const panel = await settings(app);
    const signIn = panel.getByRole('button', {name:'Sign in with passkey',exact:true});
    await signIn.waitFor();
    assert(!(await signIn.isDisabled()));
    assert(await panel.getByRole('button', {name:'Continue',exact:true}).isDisabled());
    assert(await panel.getByText('Email verification is temporarily unavailable.', {exact:true}).isVisible());
  } finally { await app.browser.close(); }
});

test('a stalled deletion passkey times out and can be retried or cancelled', {timeout:15000}, async () => {
  const app = await launchApp({sharedStore:true, values:{[storage]: session}});
  try {
    await app.page.clock.install();
    const proxy = mockAccount(app, {email:'birb@example.com',capabilities:{emailAvailable:true}});
    await proxy.start;
    const panel = await settings(app);
    await app.page.evaluate(() => {
      window.deletionPrompts = [];
      window.accountActionFades = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        if (this.id === 'account-actions' || this.id === 'account-delete-confirm') {
          window.accountActionFades.push([this.id, ...frames.map(frame => frame.opacity)]);
        }
        return animate.call(this, frames, options);
      };
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials),'get',{value: ({publicKey,signal}) => {
        window.deletionPrompts.push({signal, allowed:publicKey.allowCredentials?.length ?? 0, active:navigator.userActivation?.isActive});
        return new Promise(() => {});
      }});
    });
    const status = panel.getByRole('status');
    const confirm = panel.getByRole('button',{name:'Delete account',exact:true});
    const deletion = panel.getByRole('button',{name:'Delete account…',exact:true});
    await deletion.click();
    await deletion.waitFor({state:'hidden'});
    assert.deepEqual(await app.page.evaluate(() => window.accountActionFades.slice(0,2)), [
      ['account-actions',1,0],
      ['account-delete-confirm',0,1],
    ]);
    const cancel = panel.getByRole('button',{name:'Cancel',exact:true});
    assert((await confirm.boundingBox()).x > (await cancel.boundingBox()).x);
    const prefetched = await waitFor(() => proxy.requests.includes('/account/delete/options'), 1800);
    await confirm.click();
    assert(await waitFor(() => app.page.evaluate(() => window.deletionPrompts.length === 1), 2000), await status.textContent());
    await app.page.clock.fastForward(61000);
    await status.filter({hasText:'Passkey confirmation timed out'}).waitFor({timeout:2500});
    assert(prefetched, 'preparing the challenge does not use the confirmation click');
    const first = await app.page.evaluate(() => window.deletionPrompts.map(({signal,allowed,active}) => ({aborted:signal?.aborted,allowed,active})));
    assert.equal(first[0].aborted,true);
    assert.equal(first[0].allowed,0,'the platform can find the existing discoverable passkey');
    if (first[0].active !== undefined) assert.equal(first[0].active,true);
    await confirm.click();
    assert(await waitFor(() => app.page.evaluate(() => window.deletionPrompts.length === 2)));
    await cancel.click();
    assert(await waitFor(() => app.page.evaluate(() => window.deletionPrompts[1].signal.aborted)));
    await confirm.waitFor({state:'hidden'});
    await deletion.waitFor();
    assert(app.store.get(storage)?.token);
    assert(!proxy.requests.includes('/account'));
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('an established account uploads edits and skips scheduled or focus-triggered network requests when clean', {timeout: 23000}, async () => {
  const remote = {revision:0,ciphertext:null};
  const app = await launchApp({sharedStore:true, values:{[storage]: session}, topHosts:['news.ycombinator.com']});
  try {
    await app.page.clock.install();
    const proxy = mockAccount(app, remote);
    await proxy.start;
    remote.beforePut = () => {
      app.store.set('HNewhere:settings', {...app.store.get('HNewhere:settings'), theme:'dark'});
    };
    const panel = await settings(app);
    assert(await waitFor(() => app.store.get(storage)?.revision === 2), 'the retry includes the edit made during upload');
    assert.equal(app.store.get(storage).base.settings.theme,'dark');

    await app.page.getByRole('button', {name:'Appearance',exact:true}).click();
    await app.page.locator('#settings-panel label:has(input[data-setting="theme"][value="light"])').click();
    assert(await waitFor(() => app.store.get(storage)?.revision === 3), 'saving a setting triggers an immediate sync even with a legacy automatic:false preference');
    assert.equal(app.store.get(storage).base.settings.theme,'light');
    assert.equal(await panel.getByText('Automatic sync', {exact:true}).count(), 0);

    const snapshots = () => proxy.requests.filter(path => path === '/account/snapshot').length;
    const before = snapshots();
    await app.page.clock.fastForward(180001);
    await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await app.page.clock.runFor(1000);
    assert.equal(snapshots(),before);

    await app.context.route('https://news.ycombinator.com/news', route => route.fulfill({contentType:'text/html',body:`
      <table><tr class="athing" id="42"><td class="title"><span class="titleline"><a href="https://example.net/queue">Queue outside Reader</a></span></td></tr>
      <tr><td class="subtext"><a class="hnuser">fixture</a></td></tr></table>`}));
    const news = await app.context.newPage();
    await news.goto('https://news.ycombinator.com/news');
    const queueLink = news.locator('.hnewhere-queue-link');
    await queueLink.click();
    assert(await waitFor(() => app.store.get(queueStorage)?.length === 1));
    await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert(await waitFor(() => app.store.get(storage)?.revision === 4), 'Reader uploads the queue edit on focus');
    assert.equal(app.store.get(storage).base.collection.queue[0].title,'Queue outside Reader');

    await queueLink.click();
    assert(await waitFor(() => app.store.get(queueStorage)?.length === 0));
    await news.close();
    await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert(await waitFor(() => app.store.get(storage)?.revision === 5), 'Reader uploads the queue deletion');

    remote.offline = true;
    await app.page.getByRole('button', {name:'Account',exact:true}).click();
    await panel.getByRole('status').filter({hasText:'unavailable'}).waitFor();
    assert(await panel.getByRole('button',{name:'Sync now',exact:true}).isDisabled());
    await panel.getByRole('button',{name:'Sign out',exact:true}).click();
    assert(await waitFor(() => !app.store.get(storage)), 'a device can sign out while the service is offline');
    assert.equal(app.store.get('HNewhere:settings').theme,'light');
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('a passkey timeout cannot appear on sign-in after the account session is removed', {timeout:15000}, async () => {
  const app = await launchApp({sharedStore:true, values:{[storage]: session}});
  try {
    await app.page.clock.install();
    await mockAccount(app, {email:'birb@example.com',capabilities:{emailAvailable:true}}).start;
    const panel = await settings(app);
    await app.page.evaluate(() => {
      Object.defineProperty(Object.getPrototypeOf(navigator.credentials),'get',{value: () => {
        window.confirmingDeletion = true;
        return new Promise(() => {});
      }});
    });
    await panel.getByRole('button',{name:'Delete account…',exact:true}).click();
    await panel.getByRole('button',{name:'Delete account',exact:true}).click();
    assert(await waitFor(() => app.page.evaluate(() => window.confirmingDeletion)));
    app.store.delete(storage);
    await app.page.clock.fastForward(61000);
    await panel.getByRole('button',{name:'Sign in with passkey',exact:true}).waitFor();
    assert.equal(await panel.getByRole('status').filter({hasText:'Passkey confirmation timed out'}).isVisible(),false);
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});

test('Sidebar account settings direct the user to Reader without loading account APIs', {timeout:12000}, async () => {
  const article = STORIES[0].url;
  const app = await launchApp({appHost:new URL(article).hostname, sharedStore:true, settings:{autoOpenSidebar:true}});
  try {
    const account = await settings(app, article);
    await account.getByRole('link', {name:'Open Reader'}).waitFor({timeout:2500});
    assert.equal(await account.getByRole('link', {name:'Open Reader'}).getAttribute('href'), appURL + '#account-sync');
    assert.equal(await account.getByRole('button', {name:'Create passkey'}).count(),0);
    assert.deepEqual(app.errors,[]);
  } finally { await app.browser.close(); }
});
