import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,waitFor} from './harness.mjs';

const settings={sources:{hn:true,lemmy:true},frontPageMode:'topics',frontPageTopics:['technology'],updateCheck:false};
const order=app=>app.page.locator('#app-rail-sources .rail-button').evaluateAll(nodes=>nodes.map(node=>node.dataset.appView));
async function ready(app){
  await app.page.goto('https://backchnnl.app/');
  await app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]').waitFor();
  await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
}
async function drag(app,from,to){
  const box=await app.page.locator(`#app-rail-sources [data-app-view="${from}"]`).boundingBox();
  const dest=await app.page.locator(`#app-rail-sources [data-app-view="${to}"]`).boundingBox();
  await app.page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await app.page.mouse.down();
  await app.page.mouse.move(dest.x+dest.width/2,dest.y+2,{steps:10});
}

test('dragging sources across topics persists order without opening a different view',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,settings});
  try{
    await ready(app);
    const fixed=await app.page.locator('#app-rail > .rail-button').evaluateAll(nodes=>nodes.map(n=>n.id||n.dataset.appView));
    await drag(app,'source:lemmy','topic:technology');
    await app.page.mouse.up();
    assert.deepEqual(await order(app),['source:lemmy','topic:technology','source:hn']);
    assert.deepEqual(await app.page.locator('#app-list-tags [data-app-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.appView)),await order(app),'mobile filter chips share the reordered rail order immediately');
    assert(await waitFor(()=>app.store.get('HNewhere:app_rail_order')?.[0]==='source:lemmy',3000),'order is saved');
    assert.equal(await app.page.locator('#app-rail [data-app-view="unread"]').getAttribute('aria-pressed'),'true','dropping does not navigate');
    assert.deepEqual(await app.page.locator('#app-rail > .rail-button').evaluateAll(nodes=>nodes.map(n=>n.id||n.dataset.appView)),fixed,'fixed navigation stays in place');
    await app.page.reload();
    await app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]').waitFor();
    assert.deepEqual(await order(app),['source:lemmy','topic:technology','source:hn']);
    await app.page.locator('#app-rail-sources [data-app-view="source:hn"]').click();
    assert(await waitFor(async()=>await app.page.locator('#app-rail-sources [data-app-view="source:hn"]').getAttribute('aria-pressed')==='true',3000),'ordinary clicks still navigate');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('Escape cancels a drag and keyboard reordering preserves temporarily disabled sources',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,settings});
  try{
    await ready(app);
    const original=await order(app);
    await drag(app,'source:lemmy','topic:technology');
    await app.page.keyboard.press('Escape');
    await new Promise(resolve=>setTimeout(resolve,100));
    await app.page.mouse.up();
    assert.deepEqual(await order(app),original);
    assert.equal(await app.page.locator('#app-rail [data-app-view="unread"]').getAttribute('aria-pressed'),'true','releasing a cancelled drag does not navigate');
    const button=app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]');
    await button.focus();await button.press('Alt+ArrowUp');await button.press('Alt+ArrowUp');
    assert.deepEqual(await order(app),['source:lemmy','topic:technology','source:hn']);
    assert(await waitFor(()=>app.store.get('HNewhere:app_rail_order')?.[0]==='source:lemmy',3000));
    await app.page.locator('#settings-toggle').click();await app.page.locator('[data-settings-section="sources"]').click();
    await app.page.locator('#setting-source-lemmy').uncheck();
    assert(await waitFor(async()=>await app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]').count()===0,5000));
    await app.page.locator('#setting-source-lemmy').check();
    assert(await waitFor(async()=>await app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]').count()===1,5000));
    assert.deepEqual(await order(app),['source:lemmy','topic:technology','source:hn']);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('the source rail scrolls during a drag and fixed controls cannot be reordered',{timeout:20000},async()=>{
  const app=await launchApp({sharedStore:true,viewport:{width:1100,height:400},settings:{...settings,frontPageTopics:['world','technology','science','health'],sources:{hn:true,lemmy:true,lobsters:true,bsky:true}}});
  try{
    await ready(app);
    const section=app.page.locator('#app-rail-sources');
    assert(await section.evaluate(n=>n.scrollHeight>n.clientHeight),'the fixture has an overflowing rail');
    const before=await order(app);
    const first=app.page.locator(`#app-rail-sources [data-app-view="${before[0]}"]`);
    const box=await first.boundingBox(),area=await section.boundingBox();
    await app.page.mouse.move(box.x+box.width/2,box.y+box.height/2);await app.page.mouse.down();
    await app.page.mouse.move(area.x+area.width/2,area.y+area.height-3,{steps:8});
    assert(await waitFor(async()=>await section.evaluate(n=>n.scrollTop)>30,3000),'holding the pointer near the edge scrolls the rail');
    assert(await waitFor(async()=>(await order(app)).at(-1)===before[0],3000),'the dragged item can reach the end without scrolling the page');
    await app.page.mouse.up();
    const after=await order(app);
    const top=await app.page.locator('#app-rail-search').boundingBox();
    await app.page.mouse.move(top.x+top.width/2,top.y+top.height/2);await app.page.mouse.down();
    await app.page.mouse.move(area.x+area.width/2,area.y+area.height/2,{steps:8});await app.page.mouse.up();
    assert.deepEqual(await order(app),after,'fixed navigation cannot enter the sortable section');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
