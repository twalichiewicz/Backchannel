import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const PANES = 'HNewhere:app_panes';
const settings = {sources:{hn:true},frontPageMode:'sources',updateCheck:false};
const key = story => new URL(story.url).hostname + new URL(story.url).pathname;
const entry = {...STORIES[0],key:key(STORIES[0]),source:'hn',permalink:`https://news.ycombinator.com/item?id=${STORIES[0].id}`,addedAt:Date.now()};
const values = {
  [PANES]:{list:false,discussion:true},
  'HNewhere:queue':[entry],
  'HNewhere:favorites':[{...entry,kind:'discussion'}],
};
const rail = (app,view) => app.page.locator(`#app-rail [data-app-view="${view}"]`);
const panelVisible = app => app.page.locator('#app-list').isVisible();
const settled = app => waitFor(()=>app.page.locator('#app').evaluate(node=>!node.classList.contains('list-moving')),1500);

async function ready(app,{collapsed=true}={}){
  app.page.setDefaultTimeout(5000);
  await app.page.goto('https://backchnnl.app/');
  await rail(app,'source:hn').waitFor();
  if(!collapsed)await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
  assert(await waitFor(async()=>(await panelVisible(app))===!collapsed,2000),'initial list preference has loaded');
  assert(await waitFor(async()=>await rail(app,'queue').isEnabled()&&await rail(app,'collection').isEnabled(),2000),'Queue and Collection fixtures enable their real rail controls');
  assert(await settled(app));
}
async function openPreview(app,view='source:hn',{keyboard=false}={}){
  const control=rail(app,view);
  if(keyboard){await control.focus();await control.press('Enter')}
  else await control.click();
  assert(await waitFor(()=>panelVisible(app),1200),`${view} reveals the collapsed Front Pages panel`);
  assert(await settled(app),'the preview entrance settles');
}
async function hoverPanel(app){
  const box=await app.page.locator('#app-list').boundingBox();
  assert(box,'the list is visible to pointer users');
  await app.page.mouse.move(box.x+Math.min(100,box.width/2),box.y+20);
}
async function leavePanel(app){
  const box=await app.page.locator('#app-article-body').boundingBox();
  await app.page.mouse.move(box.x+Math.max(20,box.width-30),box.y+Math.min(200,box.height/2));
}
async function expectClosed(app,message='the temporary panel closes after both hover and focus leave'){
  assert(await waitFor(async()=>!await panelVisible(app),1800),message);
  assert.equal(app.store.get(PANES).list,false,'temporary visibility never changes the stored collapsed preference');
}
async function recordToggleFrames(app){
  return app.page.locator('#app').evaluate(root=>new Promise(resolve=>{
    const shadow=root.getRootNode(),list=shadow.querySelector('#app-list');
    const sample=t=>{
      const r=list.getBoundingClientRect();
      return {t,left:r.left,right:r.right,width:r.width,visible:getComputedStyle(list).display!=='none',moving:root.classList.contains('list-moving')};
    };
    const frames=[sample(-1)],start=performance.now();
    shadow.querySelector('#app-toggle-list').click();
    frames.push(sample(0));
    function frame(now){
      frames.push(sample(now-start));
      if(now-start<420)requestAnimationFrame(frame);else resolve(frames);
    }
    requestAnimationFrame(frame);
  }));
}

for(const view of ['source:hn','all','unread','queue','collection']){
  test(`collapsed Front Pages temporarily opens for ${view} rail navigation`,{timeout:15000},async()=>{
    const app=await launchApp({sharedStore:true,viewport:{width:1600,height:900},settings,values});
    try{
      await ready(app);
      await openPreview(app,view);
      assert.equal(await rail(app,view).getAttribute('aria-pressed'),'true','navigation selects the clicked real view');
      await app.page.locator('#app-list-body .browse-title-link').first().waitFor({timeout:3000});
      assert.equal(app.store.get(PANES).list,false,'opening a preview does not persist a pinned panel');
      await hoverPanel(app);
      await leavePanel(app);
      await expectClosed(app);
      await app.page.reload();
      await app.page.locator('#app').waitFor();
      assert(await waitFor(async()=>!await panelVisible(app),2000),'reload restores the user\'s collapsed pane');
      assert.deepEqual(app.errors,[]);
    }finally{await app.browser.close()}
  });
}

test('preview survives crossing from the rail to the panel',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1100,height:900},settings,values});
  try{
    await ready(app);
    await openPreview(app);
    const button=await rail(app,'source:hn').boundingBox(),list=await app.page.locator('#app-list').boundingBox();
    const x=(button.x+button.width+list.x)/2;
    await app.page.mouse.move(x,button.y+button.height/2);
    await app.page.waitForTimeout(60);
    await hoverPanel(app);
    await app.page.waitForTimeout(350);
    assert(await panelVisible(app),'the gap between the rail button and panel does not cancel entry');
    await leavePanel(app);
    await expectClosed(app);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('hover and keyboard focus independently keep a preview open',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1100,height:900},settings,values});
  try{
    await ready(app);
    await openPreview(app);
    await hoverPanel(app);
    await app.page.locator('#app-list-sync').focus();
    await leavePanel(app);
    await app.page.waitForTimeout(450);
    assert(await panelVisible(app),'focus inside the panel keeps it open after pointer leave');
    await hoverPanel(app);
    await app.page.locator('#app-toggle-list').focus();
    await app.page.waitForTimeout(450);
    assert(await panelVisible(app),'hover keeps it open after focus leaves');
    await leavePanel(app);
    await expectClosed(app);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('keyboard rail activation previews until panel focus leaves',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1600,height:900},settings,values});
  try{
    await ready(app);
    await leavePanel(app);
    await openPreview(app,'source:hn',{keyboard:true});
    await app.page.locator('#app-list-sync').focus();
    await app.page.waitForTimeout(450);
    assert(await panelVisible(app),'a keyboard user can keep the panel open through focus');
    await app.page.locator('#app-toggle-list').focus();
    await expectClosed(app);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('the explicit Front Pages toggle pins an open preview',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1600,height:900},settings,values});
  try{
    await ready(app);
    await openPreview(app);
    await app.page.locator('#app-toggle-list').click();
    assert(await waitFor(()=>app.store.get(PANES)?.list===true,1500),'the explicit toggle saves the panel as open');
    await leavePanel(app);
    await rail(app,'all').focus();
    await app.page.waitForTimeout(600);
    assert(await panelVisible(app),'a pinned panel stays open after hover and focus leave');
    await app.page.reload();
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    assert(await panelVisible(app),'reload keeps the explicit open preference');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('opening a story from a preview allows the panel to close and reopen',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1100,height:900},settings,values});
  try{
    await ready(app);
    await openPreview(app);
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#app-article-body iframe').waitFor();
    await leavePanel(app);
    await app.page.locator('#app-toggle-list').focus();
    await expectClosed(app,'the story remains readable while its temporary list closes');
    assert(await app.page.locator('#app-article-body iframe').isVisible(),'the selected story remains open');
    await openPreview(app);
    assert(await app.page.locator('#app-list-body .app-row.is-open').count()>0,'returning to the source preserves the open story selection');
    await hoverPanel(app);
    await leavePanel(app);
    await expectClosed(app);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

for(const {width,saved} of [{width:1600,saved:null},{width:1100,saved:null},{width:701,saved:480}]){
  test(`${width}px list motion stays within its settled border box${saved?' when its saved width is clamped':''}`,{timeout:15000},async()=>{
    const app=await launchApp({sharedStore:true,viewport:{width,height:900},settings,values:{...values,[PANES]:{list:true,discussion:true},...(saved?{'HNewhere:app_list_width':saved}:{})}});
    try{
      await ready(app,{collapsed:false});
      const close=await recordToggleFrames(app),open=await recordToggleFrames(app);
      const initial=close[0],final=open.at(-1),incoming=open.filter(frame=>frame.visible),outgoing=close.filter(frame=>frame.visible);
      assert(final.visible&&!final.moving,'the open panel reaches a settled visible state');
      assert(Math.abs(final.width-initial.width)<=0.75,'opening preserves the actual layout width');
      assert(Math.abs(final.left-initial.left)<=0.75,'opening preserves the actual layout origin');
      assert(incoming.length>=4&&outgoing.length>=4,'real animation frames were sampled in both directions');
      assert(incoming.every(frame=>Math.abs(frame.width-final.width)<=0.75),`incoming border-box width stays ${final.width}px: ${JSON.stringify(incoming)}`);
      assert(outgoing.every(frame=>Math.abs(frame.width-initial.width)<=0.75),`outgoing border-box width stays ${initial.width}px: ${JSON.stringify(outgoing)}`);
      assert(incoming.every(frame=>frame.right<=final.right+0.75),`opening never passes its settled right edge ${final.right}: ${JSON.stringify(incoming)}`);
      for(let index=1;index<incoming.length;index++)assert(incoming[index].right>=incoming[index-1].right-0.75,'the opening panel never snaps backward at settlement');
      if(saved)assert(final.width<saved,'the 701px desktop fixture really exercises the CSS width clamp');
      assert.deepEqual(app.errors,[]);
    }finally{await app.browser.close()}
  });
}
