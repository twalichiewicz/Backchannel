import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,STORIES,waitFor} from './harness.mjs';

const settings={sources:{hn:true},frontPageMode:'sources',updateCheck:false};
async function ready(width=1600,story=STORIES[0]){
 const app=await launchApp({sharedStore:true,viewport:{width,height:950},settings,votable:{[STORIES[0].id]:'updown'}});
 try{
  await app.page.goto('https://backchnnl.app/');
  await app.page.locator('#app-list-body .browse-title-link').filter({hasText:story.title}).first().click();
  await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor();
  return app;
 }catch(error){await app.browser.close();throw error}
}

test('desktop Discussion shows the mobile total to the right and follows the selected story',{timeout:20000},async()=>{
 const app=await ready();
 try{
  const desktop=app.page.locator('#app-toggle-discussion .rail-badge');
  const mobile=app.page.locator('#app-bar-discussion .rail-badge');
  assert.equal(await desktop.count(),1,'desktop exposes the discussion count');
  assert.equal(await desktop.textContent(),'30');
  assert.equal(await desktop.textContent(),await mobile.textContent());
  const geometry=await app.page.locator('#app-toggle-discussion').evaluate(node=>{
   const icon=node.querySelector('svg').getBoundingClientRect(),badge=node.querySelector('.rail-badge').getBoundingClientRect(),button=node.getBoundingClientRect();
   return{iconRight:icon.right,badgeLeft:badge.left,badgeRight:badge.right,buttonRight:button.right,badgeHeight:badge.height};
  });
  assert(geometry.badgeLeft>=geometry.iconRight+3,'the total sits beside the icon');
  assert(geometry.badgeRight<=geometry.buttonRight&&geometry.badgeHeight>0,'the count fits its hit target');
  await app.page.locator('#app-list-body .browse-title-link').filter({hasText:STORIES[7].title}).first().click();
  assert(await waitFor(async()=>await desktop.textContent()==='3',4000),'the count follows the next story');
  assert.equal(await desktop.textContent(),await mobile.textContent());
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('Aa opens the current original page without an external button in the chin',{timeout:20000},async()=>{
 const app=await ready();
 try{
  assert.equal(await app.page.locator('#app-chin [aria-label="Open the original page"]').count(),0,'the chin no longer has an external action');
  await app.page.locator('#app-view-toggle').click();
  const original=app.page.locator('#app-view-menu a').filter({hasText:'Open the original page'});
  assert.equal(await original.count(),1,'Style includes an original-page link');
  assert.equal(await original.getAttribute('href'),STORIES[0].url);
  const [tab]=await Promise.all([app.context.waitForEvent('page'),original.click()]);
  await tab.waitForURL(STORIES[0].url);await tab.close();
  await app.page.locator('#app-list-body .browse-title-link').filter({hasText:STORIES[7].title}).first().click();
  await app.page.locator('#app-view-toggle').click();
  assert.equal(await original.getAttribute('href'),STORIES[7].url,'the menu follows the selected story');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('Front Pages kebab opens its own original page while another article stays selected',{timeout:20000},async()=>{
 const app=await ready();
 try{
  const row=app.page.locator('#app-list-body .browse-row').filter({has:app.page.locator('.browse-title-link').filter({hasText:STORIES[7].title})}).first();
  await row.locator('.browse-more').click();
  const original=app.page.locator('#app-row-menu a').filter({hasText:'Open the original page'});
  assert.equal(await original.count(),1,'the row menu provides a native original-page link');
  assert.equal(await original.getAttribute('href'),STORIES[7].url);
  await original.focus();
  const [tab]=await Promise.all([app.context.waitForEvent('page'),app.page.keyboard.press('Enter')]);
  await tab.waitForURL(STORIES[7].url);await tab.close();
  assert(await waitFor(()=>app.store.get('HNewhere:last')?.ids?.[0]===String(STORIES[7].id),1200),'the external page receives its own discussion IDs');
  assert(await waitFor(async()=>!await app.page.locator('#app-row-menu').isVisible(),1000),'the row menu finishes dismissing after the link opens');
  assert.equal(await app.page.locator('#app-article-open').getAttribute('href'),STORIES[0].url,'opening a row externally does not replace the selected article');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('moving original-page access into Aa preserves its keyboard shortcut',{timeout:15000},async()=>{
 const app=await ready();
 try{
  await app.page.locator('#app-view-toggle').focus();
  const opened=app.context.waitForEvent('page',{timeout:2500});
  await app.page.keyboard.press('o');
  const tab=await opened;await tab.waitForURL(STORIES[0].url);await tab.close();
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('keyboard users enter both article menus and return to their openers',{timeout:15000},async()=>{
 const app=await ready(1336);
 try{
  const style=app.page.locator('#app-view-toggle');
  await style.focus();await app.page.keyboard.press('Enter');
  assert(await app.page.locator('#app-view-menu').evaluate(menu=>menu.contains(menu.getRootNode().activeElement)),'opening Aa places focus inside its controls');
  let reached=false;
  for(let i=0;i<12;i++){
   if(await app.page.locator('#app-article-open').evaluate(link=>link.getRootNode().activeElement===link)){reached=true;break}
   await app.page.keyboard.press(process.env.ENGINE==='webkit'?'Alt+Tab':'Tab');
  }
  assert(reached,'Tab reaches the original-page link through the actual Style controls');
  await app.page.keyboard.press('Escape');
  assert(await style.evaluate(node=>node.getRootNode().activeElement===node));
  const more=app.page.locator('#app-list-body .browse-more').first();
  await more.focus();await app.page.keyboard.press('Enter');
  const menu=app.page.locator('#app-row-menu');
  assert(await menu.evaluate(node=>node.querySelector('[role="menuitem"]')===node.getRootNode().activeElement),'the row menu starts at its first item');
  await app.page.keyboard.press('End');
  assert(await menu.evaluate(node=>node.lastElementChild===node.querySelector('a')&&node.lastElementChild===node.getRootNode().activeElement),'the original-page link is the final action');
  await app.page.keyboard.press('ArrowDown');
  assert(await menu.evaluate(node=>node.getRootNode().activeElement===node.querySelector('[role="menuitem"]')),'ArrowDown wraps to the first action');
  await app.page.keyboard.press('Escape');
  assert(await more.evaluate(node=>node.getRootNode().activeElement===node),'Escape returns to the row opener');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('middle-clicking a row original preserves its discussion context and dismisses the menu',{timeout:15000},async()=>{
 const app=await ready();
 try{
  const row=app.page.locator('#app-list-body .browse-row').filter({has:app.page.locator('.browse-title-link').filter({hasText:STORIES[7].title})}).first();
  await row.locator('.browse-more').click();
  const link=app.page.locator('#app-row-menu a');
  const [tab]=await Promise.all([app.context.waitForEvent('page',{timeout:2500}),link.click({button:'middle'})]);
  await tab.waitForURL(STORIES[7].url);await tab.close();
  assert(await waitFor(()=>app.store.get('HNewhere:last')?.ids?.[0]===String(STORIES[7].id),1200),'middle-click preserves the opened row context');
  assert(await waitFor(async()=>!await app.page.locator('#app-row-menu').isVisible(),1000),'middle-click dismisses the row menu');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('an article menu keeps a temporary Front Pages preview open until its focus leaves',{timeout:15000},async()=>{
 const app=await launchApp({sharedStore:true,viewport:{width:1100,height:950},settings,values:{'HNewhere:app_panes':{list:false,discussion:true}}});
 try{
  await app.page.goto('https://backchnnl.app/');
  assert(await waitFor(async()=>!await app.page.locator('#app-list').isVisible(),2000),'the saved collapsed preference has loaded');
  await app.page.locator('#app-rail [data-app-view="source:hn"]').click();
  assert(await waitFor(()=>app.page.locator('#app').evaluate(node=>!node.classList.contains('list-moving')),2000),'the rail preview finishes opening before keyboard activation');
  const more=app.page.locator('#app-list-body .browse-more').first();
  await more.focus();await app.page.keyboard.press('Enter');
  assert(await app.page.locator('#app-row-menu').evaluate(node=>node.contains(node.getRootNode().activeElement)));
  await app.page.mouse.move(1000,400);await app.page.waitForTimeout(500);
  assert.equal(await app.page.locator('#app-list').isVisible(),true,'the associated menu holds the temporary panel open');
  await app.page.keyboard.press('Escape');
  assert(await more.evaluate(node=>node.getRootNode().activeElement===node));
  await app.page.locator('#app-toggle-list').focus();
  assert(await waitFor(async()=>!await app.page.locator('#app-list').isVisible(),2000),'leaving the menu and panel lets the preview collapse');
  assert.equal(app.store.get('HNewhere:app_panes').list,false,'using the menu does not pin the temporary panel');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('a resized Discussion stays beside the article throughout Front Pages motion',{timeout:20000},async()=>{
 const app=await ready(1336);
 try{
  await app.page.locator('#app-toggle-list').click();
  assert(await waitFor(()=>app.page.locator('#app').evaluate(node=>!node.classList.contains('list-moving')),2000));
  const handle=await app.page.locator('#panel #resize-handle').boundingBox();
  await app.page.mouse.move(handle.x+handle.width/2,handle.y+100);await app.page.mouse.down();
  await app.page.mouse.move(handle.x-540,handle.y+100,{steps:4});await app.page.mouse.up();
  const panel=await app.page.locator('#panel').boundingBox();
  assert(panel.width>850,'the real resize gesture exercises a capped Discussion');
  const frames=await app.page.locator('#app').evaluate(async node=>{
   const root=node.getRootNode(),start=performance.now(),frames=[];
   const record=()=>{const article=root.querySelector('#app-article').getBoundingClientRect(),panel=root.querySelector('#panel').getBoundingClientRect();frames.push({article:article.width,gap:panel.left-article.right})};
   record();root.querySelector('#app-toggle-list').click();
   await new Promise(resolve=>{const tick=()=>{record();if(performance.now()-start<360)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});
   return frames;
  });
  assert(frames.every(frame=>Math.abs(frame.article-frames[0].article)<=1),'the article keeps its minimum width while the capped Discussion and list move together');
  assert(frames.every(frame=>Math.abs(frame.gap)<=1),'the article and Discussion keep a shared edge');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('panel reversals and concurrent toggles settle to the latest state after resizing',{timeout:20000},async()=>{
 const app=await ready();
 try{
  await app.page.locator('#app').evaluate(async node=>{
   const root=node.getRootNode(),click=pane=>root.querySelector('#app-toggle-'+pane).click(),frame=()=>new Promise(requestAnimationFrame);
   click('list');click('discussion');await frame();await frame();click('list');click('discussion');await frame();await frame();click('list');
  });
  await app.page.setViewportSize({width:1100,height:950});
  assert(await waitFor(()=>app.page.locator('#app').evaluate(node=>!node.classList.contains('list-moving')&&!node.classList.contains('discussion-moving')),2000));
  assert.equal(await app.page.locator('#app-list').isVisible(),false,'the last list request remains closed');
  assert.equal(await app.page.locator('#panel').isVisible(),true,'the last discussion request remains open');
  const before=await app.page.locator('#panel').boundingBox();
  await app.page.locator('#app-toggle-list').click();
  assert(await waitFor(()=>app.page.locator('#app').evaluate(node=>!node.classList.contains('list-moving')),2000));
  const after=await app.page.locator('#panel').boundingBox();
  assert.equal(after.height,before.height,'the Discussion split survives list reversals and resize');
  assert(after.width<before.width,'opening Front Pages reserves the correct space');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

test('reduced motion changes both panel layouts immediately',{timeout:15000},async()=>{
 const app=await ready();
 try{
  await app.page.emulateMedia({reducedMotion:'reduce'});
  const states=await app.page.locator('#app').evaluate(node=>{
   const root=node.getRootNode(),states=[];
   for(const pane of ['list','discussion'])for(const hidden of [true,false]){
    root.querySelector('#app-toggle-'+pane).click();
    states.push({pane,hidden:node.classList.contains(pane+'-hidden'),moving:node.classList.contains(pane+'-moving'),want:hidden});
   }
   return states;
  });
  assert(states.every(state=>state.hidden===state.want&&!state.moving),'reduced-motion users see the requested layout immediately');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

for(const width of [1600,1100])test(`${width}px built-in Reader clips the outer corner when Front Pages is closed`,{timeout:20000},async()=>{
 const app=await ready(width,STORIES[1]);
 try{
  assert(await waitFor(async()=>await app.page.locator('#app-article-body').getAttribute('data-mode')==='reader',8000));
  await app.page.locator('#app-toggle-list').click();
  assert(await waitFor(()=>app.page.locator('#app').evaluate(node=>node.classList.contains('list-hidden')&&!node.classList.contains('list-moving')),2000));
  const box=await app.page.locator('#app-reading').boundingBox();
  const corner=await app.page.screenshot({clip:{x:box.x,y:box.y,width:2,height:2},animations:'disabled'});
  const rail=await app.page.screenshot({clip:{x:box.x-4,y:box.y,width:2,height:2},animations:'disabled'});
  assert(corner.equals(rail),'the pixels outside the rounded content corner show the rail through the clipped Reader gradient');
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});

for(const width of [1600,1100])test(`${width}px panel motion keeps article layout continuous in both directions`,{timeout:20000},async()=>{
 const app=await ready(width);
 try{
  assert(await waitFor(()=>app.page.locator('#panel').evaluate(node=>getComputedStyle(node).transform==='none'),2000));
  for(const pane of ['list','discussion'])for(const direction of ['close','open']){
   const frames=await app.page.locator('#app').evaluate(async(app,pane)=>{
    const root=app.getRootNode(),start=performance.now(),frames=[];
    const record=()=>{const r=root.querySelector('#app-article').getBoundingClientRect();frames.push({t:document.timeline.currentTime,x:r.x,width:r.width,height:r.height})};
    record();root.querySelector('#app-toggle-'+pane).click();
    await new Promise(resolve=>{const tick=()=>{record();if(performance.now()-start<360)requestAnimationFrame(tick);else resolve()};requestAnimationFrame(tick)});
    return frames;
   },pane);
   for(const key of ['x','width','height']){
    const range=Math.abs(frames.at(-1)[key]-frames[0][key]);
    if(range<10)continue;
    assert(frames.some(frame=>Math.abs(frame[key]-frames[0][key])>range*.15&&Math.abs(frame[key]-frames.at(-1)[key])>range*.15),`${pane} ${direction} interpolates article ${key}`);
    for(let i=1;i<frames.length;i++){
     const elapsed=frames[i].t-frames[i-1].t,allowed=range*Math.min(1,elapsed/240*3+.03)+1;
     assert(Math.abs(frames[i][key]-frames[i-1][key])<=allowed,`${pane} ${direction} article ${key} does not jump between frames: ${JSON.stringify({before:frames[i-1],after:frames[i],allowed,frames})}`);
    }
   }
  }
  assert.deepEqual(app.errors,[]);
 }finally{await app.browser.close()}
});
