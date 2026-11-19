import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,waitFor} from './harness.mjs';

test('an article readout identifies its tab without changing the saved article title', {timeout:15000}, async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace('init().catch(console.error);','globalThis.__answerReadOut = answerReadOut;');
  const url='https://framed.example.com/readout';
  const prose=Array.from({length:8},(_,i)=>`<p>Paragraph ${i+1} contains a substantial and readable account of what happened in the article and why it matters to everyone concerned.</p>`).join('');
  const app=await launchApp({source,appHost:'framed.example.com',sharedStore:true,settings:{sources:{hn:true},updateCheck:false},values:{'HNewhere:read_out':{id:'request',url,key:'framed.example.com/readout',until:Date.now()+10000}},pages:{[url]:{html:`<!doctype html><html><head><title>Original article title</title></head><body><main><h1>Original article title</h1>${prose}</main></body></html>`}}});
  try {
    await app.page.goto(url+'#backchannel_read_out=1&nonce=request');
    await app.page.waitForFunction(()=>Boolean(window.__answerReadOut));
    await app.page.evaluate(()=>{window.close=()=>{window.__closed=true};window.__answer=__answerReadOut()});
    await app.page.waitForFunction(()=>/Backchannel is refreshing framed\.example\.com/.test(document.title),null,{timeout:2000});
    assert.match(await app.page.locator('#backchannel-read-helper-banner').innerText(),/Backchannel is reading.*framed.example.com/i);
    await app.page.evaluate(()=>{document.title='Updated article title'});
    await app.page.evaluate(()=>window.__answer);
    assert.equal(await app.page.title(),'Updated article title','the original page title is restored');
    assert.match(app.store.get('HNewhere:read_out')?.article?.title||'',/article title/i,'the saved article does not use the helper title');
    assert.doesNotMatch(app.store.get('HNewhere:read_out')?.article?.title||'',/Backchannel is refreshing/i);
  } finally {await app.browser.close()}
});

test('an ordinary article tab does not become a readout helper for a matching request',{timeout:15000},async()=>{
  const source=(await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8')).replace('init().catch(console.error);','globalThis.__answerReadOut=answerReadOut;');
  const url='https://framed.example.com/readout';
  const app=await launchApp({source,appHost:'framed.example.com',sharedStore:true,settings:{sources:{hn:true},updateCheck:false},values:{'HNewhere:read_out':{id:'request',url,key:'framed.example.com/readout',until:Date.now()+2000}},pages:{[url]:{html:'<title>Ordinary article</title><article><p>'+('An ordinary existing article. '.repeat(100))+'</p></article>'}}});
  try{
    await app.page.goto(url);await app.page.waitForFunction(()=>window.__answerReadOut);
    await app.page.evaluate(async()=>{window.close=()=>{window.__closed=true};await window.__answerReadOut()});
    assert.equal(await app.page.evaluate(()=>Boolean(window.__closed)),false,'a URL match alone cannot authorize closing an existing tab');
    assert.equal(await app.page.title(),'Ordinary article');
    assert.equal(await app.page.locator('#backchannel-read-helper-banner').count(),0);
    assert(!app.store.get('HNewhere:read_out')?.article);
  }finally{await app.browser.close()}
});


test('Reader opens a marked article helper in the background and cleans it up after a failed scrape',{timeout:15000},async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace(/const APP_READ_OUT_MS = \d+;/,'const APP_READ_OUT_MS = 1400;');
  source=source.replace('init().catch(console.error);',`if(location.hostname==='backchnnl.app'){
    const open=GM.openInTab;window.__readOpenings=[];GM.openInTab=(...args)=>{window.__readOpenings.push(args);return open(...args)};
    window.__requestReadout=async url=>{const card=document.createElement('div');card.id='readout-test-card';card.innerHTML='<button class="app-card-read">Read</button><span class="app-card-note"></span>';document.body.append(card);await requestAppReadOut({url,mode:'card',dead:false},card)};
  }init().catch(console.error);`);
  const url='https://framed.example.com/empty';
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['framed.example.com'],settings:{sources:{hn:true},updateCheck:false},pages:{[url]:{html:'<title>Empty article</title><main></main>'}}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__requestReadout);
    await app.page.evaluate(url=>window.__requestReadout(url),url);
    assert(await waitFor(()=>opened.length===1,3000));
    const helper=opened[0];
    await helper.locator('#backchannel-read-helper-banner').waitFor();
    assert.match(helper.url(),/#backchannel_read_out=1&nonce=/);
    const openings=await app.page.evaluate(()=>window.__readOpenings);
    assert.equal(openings[0][1],true,'the manager is asked to keep the helper in the background');
    assert.match(await helper.locator('#backchannel-read-helper-banner').innerText(),/reading.*framed.example.com/i);
    assert(await waitFor(()=>helper.isClosed(),5000),'a failed scrape still cleans up the helper');
    assert(await waitFor(async()=>/couldn.t be scraped/.test(await app.page.locator('#readout-test-card .app-card-note').textContent()),3000));
    assert.equal(app.page.isClosed(),false);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});

test('an article helper created after its scrape timeout still closes automatically',{timeout:15000},async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace(/const APP_READ_OUT_MS = \d+;/,'const APP_READ_OUT_MS = 200;');
  source=source.replace('init().catch(console.error);',`if(location.hostname==='backchnnl.app'){
    const open=GM.openInTab;GM.openInTab=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,3500));return open(...args)};
    window.__requestReadout=async url=>{const card=document.createElement('div');card.id='readout-test-card';card.innerHTML='<button class="app-card-read">Read</button><span class="app-card-note"></span>';document.body.append(card);await requestAppReadOut({url,mode:'card',dead:false},card)};
  }init().catch(console.error);`);
  const url='https://framed.example.com/late';
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['framed.example.com'],settings:{sources:{hn:true},updateCheck:false},pages:{[url]:{html:'<title>Late article</title><main></main>'}}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.waitForFunction(()=>window.__requestReadout);
    await app.page.evaluate(url=>window.__requestReadout(url),url);
    assert(await waitFor(async()=>/couldn.t be scraped/.test(await app.page.locator('#readout-test-card .app-card-note').textContent()),3500));
    assert(await waitFor(()=>opened.length===1,3000));
    assert(await waitFor(()=>opened[0].isClosed(),4000),'late creation must not strand an expired helper without ownership');
    assert.equal(app.page.isClosed(),false);
  }finally{await app.browser.close()}
});

test('a later Sync recovers article cleanup and its relay after manager removal fails',{timeout:30000},async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace(/const APP_READ_OUT_MS = \d+;/,'const APP_READ_OUT_MS = 300;');
  source=source.replace('init().catch(console.error);',`const nativeClose=GM.closeTab;window.__rejectClose=true;GM.closeTab=async(...args)=>{if(window.__rejectClose)throw new Error('Simulated manager removal failure');return nativeClose(...args)};
    if(location.hostname==='framed.example.com')window.close=()=>{};
    if(location.hostname==='backchnnl.app')window.__requestReadout=async url=>{const card=document.createElement('div');card.id='readout-test-card';card.innerHTML='<button class="app-card-read">Read</button><span class="app-card-note"></span>';document.body.append(card);await requestAppReadOut({url,mode:'card',dead:false},card)};
    init().catch(console.error);`);
  const url='https://framed.example.com/close-failure';
  const app=await launchApp({source,sharedStore:true,tabs:true,topHosts:['framed.example.com'],settings:{sources:{hn:true},updateCheck:false},pages:{[url]:{html:'<title>Article</title><main></main>'}}});
  const opened=[];app.context.on('page',page=>opened.push(page));
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(url=>window.__requestReadout(url),url);
    assert(await waitFor(()=>opened.length===2,8000),'a failed direct removal exercises the background cleanup relay');
    await new Promise(resolve=>setTimeout(resolve,8000));
    assert.equal(opened.filter(page=>!page.isClosed()).length,2);
    await app.page.evaluate(()=>{window.__rejectClose=false});
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(()=>opened.every(page=>page.isClosed()),5000),'a later Sync retries every unresolved article helper and relay');
    assert.equal(app.page.isClosed(),false);
  }finally{await app.browser.close()}
});

test('a blocked article opening does not leave a nonexistent helper pending on Sync',{timeout:15000},async()=>{
  let source=await readFile(new URL('../../HNewhere.user.js',import.meta.url),'utf8');
  source=source.replace(/const APP_READ_OUT_MS = \d+;/,'const APP_READ_OUT_MS = 200;');
  source=source.replace('init().catch(console.error);',`GM.openInTab=async()=>null;window.__requestReadout=async()=>{const card=document.createElement('div');card.id='readout-test-card';card.innerHTML='<button class="app-card-read">Read</button><span class="app-card-note"></span>';document.body.append(card);await requestAppReadOut({url:'https://framed.example.com/blocked',mode:'card',dead:false},card)};init().catch(console.error);`);
  const app=await launchApp({source,sharedStore:true,tabs:true,settings:{sources:{hn:true},updateCheck:false}});
  try{
    await app.page.goto('https://backchnnl.app/');await app.page.locator('#app-list-body .browse-title-link').first().waitFor();
    await app.page.evaluate(()=>window.__requestReadout());
    assert(await waitFor(async()=>/couldn.t be scraped/.test(await app.page.locator('#readout-test-card .app-card-note').textContent()),4000));
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async()=>await app.page.locator('#app-list-sync').getAttribute('aria-busy')!=='true',5000));
    assert.doesNotMatch(await app.page.locator('#toast').textContent(),/could not finish/i,'a failed opening does not prove that any helper exists to clean up');
  }finally{await app.browser.close()}
});
