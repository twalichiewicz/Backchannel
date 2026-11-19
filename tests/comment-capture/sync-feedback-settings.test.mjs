import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,STORIES,waitFor} from './harness.mjs';

const script=async()=> (await readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8')).replace('const TOAST_BRIEF_MS = 1800;','const TOAST_BRIEF_MS = 300;').replace('const TOAST_DISMISS_MS = 5200;','const TOAST_DISMISS_MS = 300;');

for(const failed of [false,true])test(`Reader shows transient sync progress followed by ${failed?'Partial sync':'Synced'}`,{timeout:15000},async()=>{
  const app=await launchApp({source:await script(),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(failed=>{
      const request=window.__gmXHR;
      window.__gmXHR=async options=>{
        if(options.url==='https://news.ycombinator.com/news'){
          await new Promise(resolve=>window.__releaseFeed=resolve);
          if(failed)return{status:503,finalUrl:options.url,responseHeaders:'content-type: text/html',text:'Unavailable'};
        }
        return request(options);
      };
    },failed);
    await app.page.locator('#app-list-sync').click();
    await app.page.waitForFunction(()=>window.__releaseFeed);
    assert.equal(await app.page.locator('#toast').textContent(),'Syncing…');
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'progress expires even while a source is still running');
    assert.equal(await app.page.locator('#app-list-sync').getAttribute('aria-busy'),'true','the Sync button keeps indicating the ongoing work');
    await app.page.evaluate(()=>window.__releaseFeed());
    const text=failed?'Partial sync':'Synced';
    assert(await waitFor(async()=>await app.page.locator('#toast').textContent()===text,3000),'completion reports the whole sync outcome');
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',3000));
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'the final result also dismisses itself');
    assert(await app.page.locator('#app-list-body .browse-title-link').count()>0,'the saved article list remains available');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a Reddit transport failure is a transient Partial sync result',{timeout:15000},async()=>{
  const source=(await script()).replace('init().catch(console.error);',`window.__failedRead=()=>finishRedditReadBatch({nonce:'fixture-failed',actionId:redditReadActionId,sequence:0,unresponsive:true,startedSyncRun:syncRunId});init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__failedRead());
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert.equal(await app.page.locator('#toast .toast-action').count(),0,'sync outcomes use the standard Sync control for another attempt');
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('waiting for Reddit sign-in does not create a persistent instruction toast',{timeout:10000},async()=>{
  const source=(await script()).replace('init().catch(console.error);',`window.__waitForRedditLogin=async()=>{const now=Date.now(),batch={nonce:'fixture-login',created:now,expires:now+900};await save(BRIDGE_RESULT_PREFIX+batch.nonce,{source:REDDIT_READ_SOURCE,nonce:batch.nonce,ts:now,phase:'login',requestId:0});window.__loginWait=waitRedditReadReply(batch,0);};init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__waitForRedditLogin());
    await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal(await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),false,'a source waiting for authentication cannot leave instructions on screen');
    await app.page.evaluate(()=>window.__loginWait);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a new Sidebar Sync briefly reports an unresolved cleanup after its previous result expired',{timeout:15000},async()=>{
  const source=(await script()).replace('init().catch(console.error);',`window.__pendingCleanup=()=>{pendingReadHelpers.add('fixture-pending');showReadHelperCleanupNotice();};init().catch(console.error);`);
  const app=await launchApp({source,appHost:new URL(STORIES[0].url).hostname,sharedStore:true,settings:{sources:{hn:true},autoOpenSidebar:true,frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto(STORIES[0].url);await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
    await app.page.locator('#browse-toggle .wordmark-root').click();
    assert(await waitFor(async()=>await app.page.locator('#panel.browsing').count()===1,3000),'the test is in the inline Front Pages sync view');
    await app.page.locator('#browse-home-sync').waitFor();
    await app.page.evaluate(()=>window.__pendingCleanup());
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert(await waitFor(async()=>!await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),2000));
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#browse-home-sync').getAttribute('aria-busy')!=='true'&&await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),3000),'a new attempt has its own visible terminal result');
    assert.equal(await app.page.locator('#toast').textContent(),'Partial sync');
    assert(await waitFor(async()=>!await app.page.locator('#toast').evaluate(node=>node.classList.contains('is-showing')),2000));
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('searching Settings for Sync schedule opens the Sources section',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail-search').click();
    await app.page.locator('#app-search-input').fill('Sync schedule');
    await app.page.locator('#app-search-results .app-search-item').filter({hasText:'Sync schedule'}).first().click({timeout:3000});
    await app.page.locator('#app-settings-modal').waitFor({state:'visible',timeout:3000});
    assert.equal(await app.page.locator('#app-settings-modal').getAttribute('data-section'),'sources','the setting search result points to its own section');
    assert.equal(await app.page.locator('#setting-source-refresh').isVisible(),true);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const [name,reader,width] of [['Reader',true,1440],['mobile Reader',true,390],['Sidebar',false,1440]])test(`${name} Sync schedule uses a custom dropdown with saved values and the requested layout`,{timeout:20000},async()=>{
  const app=await launchApp({viewport:{width,height:844},...(reader?{}:{appHost:new URL(STORIES[0].url).hostname}),sharedStore:true,settings:{sources:{hn:true},frontPageMode:'sources',autoOpenSidebar:!reader,sourceRefreshMinutes:15,updateCheck:false}});
  try{
    await app.page.goto(reader?'https://backchnnl.app/':STORIES[0].url);
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('[data-settings-section="sources"]').click();
    const row=app.page.locator('.settings-sync-schedule');
    await row.waitFor({timeout:3000});
    const toggle=row.getByRole('button',{name:/Sync schedule/});
    assert.equal(await row.locator('select').count(),0,'the visible schedule control is an app dropdown');
    assert.match(await toggle.innerText(),/Every 15 minutes/);
    assert.equal(await row.locator('.appearance-row-hint').textContent(),'Determine how often sources should automatically sync.');
    const geometry=await row.evaluate(element=>{
      const box=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}};
      return{row:box(element),label:box(element.querySelector('.appearance-row-label')),hint:box(element.querySelector('.appearance-row-hint')),toggle:box(element.querySelector('button')),previous:box(element.previousElementSibling)};
    });
    assert(geometry.toggle.x-geometry.label.right>=12,'the label and dropdown have a minimum horizontal gap');
    assert(Math.abs(geometry.row.right-geometry.toggle.right)<2,'the dropdown aligns to the far right');
    assert(geometry.hint.y>=geometry.label.bottom&&geometry.hint.y-geometry.label.bottom<=4,'the hint sits tightly below the label');
    assert(geometry.label.y-geometry.previous.bottom>=10,'the schedule is separated from the preceding radio group');
    await toggle.click();
    const list=row.getByRole('listbox');
    assert.equal(await list.isVisible(),true);
    assert.equal(await list.getByRole('option',{selected:true}).innerText(),'Every 15 minutes');
    const bounds=await list.evaluate(menu=>{const box=menu.getBoundingClientRect(),content=menu.closest('.app-settings-content').getBoundingClientRect();return{top:box.top,bottom:box.bottom,clipTop:content.top,clipBottom:content.bottom}});
    assert(bounds.top>=bounds.clipTop&&bounds.bottom<=bounds.clipBottom,'all dropdown choices fit inside the visible settings content');
    const manual=await list.getByRole('option',{name:'Manual',exact:true}).boundingBox();
    await app.page.mouse.click(manual.x+manual.width/2,manual.y+manual.height/2);
    assert(await waitFor(()=>app.store.get('HNewhere:settings')?.sourceRefreshMinutes===0,3000));
    await list.waitFor({state:'hidden',timeout:2000});
    assert.match(await toggle.innerText(),/Manual/);
    await toggle.focus();await toggle.press('ArrowDown');
    await app.page.keyboard.press('Home');await app.page.keyboard.press('Enter');
    assert(await waitFor(()=>app.store.get('HNewhere:settings')?.sourceRefreshMinutes===5,3000),'keyboard selection saves the numeric setting');
    await toggle.click();await app.page.keyboard.press('Escape');
    await list.waitFor({state:'hidden',timeout:2000});
    assert.equal(await toggle.evaluate(node=>node.getRootNode().activeElement===node),true,'Escape returns focus to the dropdown');
    await toggle.click();await app.page.locator('#app-settings-heading').click();
    await list.waitFor({state:'hidden',timeout:2000});
    await app.page.reload();await app.page.locator('#settings-toggle').click();
    await app.page.locator('[data-settings-section="sources"]').click();
    assert.match(await app.page.locator('.settings-sync-schedule').getByRole('button',{name:/Sync schedule/}).innerText(),/Every 5 minutes/,'the schedule survives reload');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
