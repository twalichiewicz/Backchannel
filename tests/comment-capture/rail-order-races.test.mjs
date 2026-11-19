import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,waitFor} from './harness.mjs';

const settings={sources:{hn:true,lemmy:true},frontPageMode:'topics',frontPageTopics:['technology'],updateCheck:false};
const orderKey='HNewhere:app_rail_order';
const order=app=>app.page.locator('#app-rail-sources .rail-button').evaluateAll(nodes=>nodes.map(node=>node.dataset.appView));

async function ready(app){
  await app.page.goto('https://backchnnl.app/');
  await app.page.locator('#app-rail-sources [data-app-view="source:lemmy"]').waitFor();
  await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
  assert.deepEqual(app.errors,[]);
}

test('a delayed source refresh preserves a rail reorder completed after its settings snapshot',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,settings});
  try{
    await ready(app);
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('[data-settings-section="sources"]').click();
    await app.page.evaluate(()=>{
      const get=GM.getValue;
      GM.getValue=async(...args)=>{
        const hold=args[0]==='HNewhere:settings'&&new Error().stack.includes('refreshAppSources');
        const value=await get(...args);
        if(hold){
          GM.getValue=get;
          await new Promise(resolve=>window.__releaseRailSettingsSnapshot=resolve);
        }
        return value;
      };
    });
    await app.page.locator('#setting-source-lemmy').uncheck();
    assert(await waitFor(()=>app.page.evaluate(()=>Boolean(window.__releaseRailSettingsSnapshot)),3000),'source refresh has read its settings snapshot');
    await app.page.locator('#app-settings-close').click();
    const hn=app.page.locator('#app-rail-sources [data-app-view="source:hn"]');
    await hn.focus();await hn.press('Alt+ArrowUp');
    assert.deepEqual(await order(app),['source:hn','topic:technology','source:lemmy']);
    assert(await waitFor(()=>app.store.get(orderKey)?.[0]==='source:hn',3000),'new rail order is persisted before the delayed refresh completes');
    await app.page.evaluate(()=>window.__releaseRailSettingsSnapshot());
    assert(await waitFor(async()=>(await order(app)).length===2,3000),'source refresh has rendered the disabled source');
    assert.deepEqual(await order(app),['source:hn','topic:technology'],'the delayed refresh retains the newer rail order');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('a delayed rail save preserves a setting changed immediately after reordering',{timeout:15000},async()=>{
  const app=await launchApp({sharedStore:true,settings});
  try{
    await ready(app);
    app.slowSets.prefix=orderKey;
    app.slowSets.ms=1500;
    app.slowSets.armed=true;
    const hn=app.page.locator('#app-rail-sources [data-app-view="source:hn"]');
    await hn.focus();await hn.press('Alt+ArrowUp');
    assert(await waitFor(()=>!app.slowSets.armed,1500),'the rail save has started its delayed storage write');
    await app.page.locator('#settings-toggle').click();
    await app.page.locator('#setting-update-check').check();
    assert(await waitFor(()=>app.slowSets.completed,4000),'the delayed rail save has completed');
    assert(await waitFor(()=>app.store.get('HNewhere:settings')?.updateCheck===true,3000),'the newer automatic-update preference survives the rail save');
    assert.deepEqual(app.store.get(orderKey),['source:hn','topic:technology','source:lemmy'],'both independent settings changes persist');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
