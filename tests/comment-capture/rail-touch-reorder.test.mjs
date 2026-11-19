import test from 'node:test';
import assert from 'node:assert/strict';
import {launchApp,waitFor} from './harness.mjs';

test('holding an icon allows a touch reorder without canceling on capture transfer',{
  timeout:15000,
  skip:(process.env.ENGINE||'chromium')!=='chromium',
},async()=>{
  const app=await launchApp({
    engine:'chromium',hasTouch:true,sharedStore:true,viewport:{width:1100,height:700},
    settings:{sources:{hn:true,lemmy:true},frontPageMode:'topics',frontPageTopics:['technology'],updateCheck:false},
  });
  try{
    await app.page.goto('https://backchnnl.app/');
    const section=app.page.locator('#app-rail-sources');
    const from=section.locator('[data-app-view="source:lemmy"]');
    await from.waitFor();
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    assert.deepEqual(app.errors,[]);
    const start=await from.boundingBox();
    const end=await section.locator('[data-app-view="topic:technology"]').boundingBox();
    const x=start.x+start.width/2,y=start.y+start.height/2,targetY=end.y+2;
    const cdp=await app.context.newCDPSession(app.page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x,y}]});
    await app.page.waitForTimeout(375);
    for(let step=1;step<=8;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x,y:y+(targetY-y)*step/8}]});
      await app.page.waitForTimeout(20);
    }
    assert.equal(await section.evaluate(node=>node.classList.contains('is-reordering')),true,'the implicit capture loss on the original icon does not cancel the rail drag');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const expected=['source:lemmy','topic:technology','source:hn'];
    assert.deepEqual(await section.locator('.rail-button').evaluateAll(nodes=>nodes.map(node=>node.dataset.appView)),expected);
    assert(await waitFor(()=>app.store.get('HNewhere:app_rail_order')?.[0]==='source:lemmy',3000),'the completed touch reorder is saved');
    assert.equal(await app.page.locator('#app-rail [data-app-view="unread"]').getAttribute('aria-pressed'),'true','the drop does not activate a source');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('an ordinary touch swipe scrolls an overflowing source rail without reordering',{
  timeout:15000,
  skip:(process.env.ENGINE||'chromium')!=='chromium',
},async()=>{
  const app=await launchApp({
    engine:'chromium',hasTouch:true,sharedStore:true,viewport:{width:1100,height:400},
    settings:{sources:{hn:true,lemmy:true,lobsters:true,bsky:true},frontPageMode:'topics',frontPageTopics:['world','technology','science','health'],updateCheck:false},
  });
  try{
    await app.page.goto('https://backchnnl.app/');
    const section=app.page.locator('#app-rail-sources');
    await section.locator('[data-app-view="source:lemmy"]').waitFor();
    await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    assert.deepEqual(app.errors,[]);
    assert(await section.evaluate(node=>node.scrollHeight>node.clientHeight),'the fixture has an overflowing rail');
    const before=await section.locator('.rail-button').evaluateAll(nodes=>nodes.map(node=>node.dataset.appView));
    const start=await section.locator('.rail-button').nth(2).boundingBox();
    const x=start.x+start.width/2,y=start.y+start.height/2;
    const cdp=await app.context.newCDPSession(app.page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x,y}]});
    for(let step=1;step<=8;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x,y:y-step*10}]});
      await app.page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert(await waitFor(()=>section.evaluate(node=>node.scrollTop>30),1500),'the native swipe scrolls the rail');
    assert.deepEqual(await section.locator('.rail-button').evaluateAll(nodes=>nodes.map(node=>node.dataset.appView)),before,'scrolling does not rearrange the rail');
    assert.equal(app.store.get('HNewhere:app_rail_order'),undefined,'scrolling does not persist a reordered rail');
    assert.equal(await app.page.locator('#app-rail [data-app-view="unread"]').getAttribute('aria-pressed'),'true','scrolling does not activate a source');
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
