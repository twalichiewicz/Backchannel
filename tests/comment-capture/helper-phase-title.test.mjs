import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchApp,waitFor} from './harness.mjs';

const nonce='0123456789abcdef0123456789abcdef';
const payload='HNewhere:bridge_payload:'+nonce;
const result='HNewhere:bridge_result:'+nonce;
const original=()=>readFile(process.env.BC_SCRIPT||new URL('../../HNewhere.user.js',import.meta.url),'utf8');

for(const signedIn of [true,false])test(`Reddit helper title ${signedIn?'follows sign-in, discovery, comment loading and completion':'changes from required sign-in to completion when the read ends'}`,{timeout:20000},async()=>{
  const source=(await original()).replace('init().catch(console.error);','window.__dispatchRead=dispatchRedditReadWindow;');
  const app=await launchApp({source,appHost:'www.reddit.com',handler:'Userscripts',sharedStore:true,settings:{sources:{hn:true,reddit:true},updateCheck:false}});
  const gates=new Map();
  await app.context.route('https://www.reddit.com/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({status:200,contentType:'text/html',body:'<title>Original Reddit title</title>'});
    await new Promise(resolve=>gates.set(path,resolve));
    return route.fulfill({status:200,contentType:'application/json',body:path==='/api/me.json'?JSON.stringify({data:{name:signedIn?'fixture':''}}):'{"data":{"children":[]}}'}).catch(()=>{});
  });
  try{
    await app.page.goto('https://www.reddit.com/#backchannel_read=1&nonce='+nonce);
    await app.page.waitForFunction(()=>window.__dispatchRead);
    await app.page.evaluate(async nonce=>{
      const now=Date.now();await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'reddit-read',nonce,origin:'https://backchnnl.app',ts:now,expires:now+20000,requests:[]});
      window.close=()=>{};GM.closeTab=()=>new Promise(resolve=>window.__releaseClose=resolve);
      window.__readDone=window.__dispatchRead();
    },nonce);
    assert(await waitFor(()=>gates.has('/api/me.json'),3000));
    assert.match(await app.page.title(),/Checking sign-in/i);
    gates.get('/api/me.json')();
    if(signedIn){
    assert(await waitFor(()=>app.store.get(result)?.phase==='ready',3000));
    const stage=app.store.get(payload);app.store.set(payload,{...stage,requests:[{id:1,path:'/api/info.json?url=https%3A%2F%2Fexample.com'}]});
    assert(await waitFor(()=>gates.has('/api/info.json'),3000));
    assert.match(await app.page.title(),/Finding discussions/i);
    gates.get('/api/info.json')();
    assert(await waitFor(()=>app.store.get(result+':1')?.phase==='response',3000));
    app.store.set(payload,{...stage,requests:[{id:1,path:'/api/info.json?url=https%3A%2F%2Fexample.com'},{id:2,path:'/comments/thread123.json'}]});
    assert(await waitFor(()=>gates.has('/comments/thread123.json'),3000));
    assert.match(await app.page.title(),/Loading comments/i);
    gates.get('/comments/thread123.json')();
    assert(await waitFor(()=>app.store.get(result+':2')?.phase==='response',3000));
    }else{
      assert(await waitFor(()=>app.store.get(result)?.phase==='login',3000));
      await app.page.waitForFunction(()=>/Sign in to Reddit/.test(document.title),null,{timeout:1500});
    }
    app.store.set(payload,{...app.store.get(payload),done:true});
    await app.page.waitForFunction(()=>window.__releaseClose,null,{timeout:3000});
    assert.match(await app.page.title(),/Finishing sync/i,'completion remains descriptive until closing finishes');
    await app.page.evaluate(()=>window.__releaseClose());
    await app.page.evaluate(()=>window.__readDone);
    assert.deepEqual(app.errors,[]);
  }finally{for(const release of gates.values())release();await app.browser.close()}
});

test('X helper title follows search loading, post checking, results and completion',{timeout:20000},async()=>{
  const source=(await original()).replace('init().catch(console.error);','window.__dispatchSearch=dispatchXSearchWindow;');
  const article='https://example.com/article';
  const app=await launchApp({source,appHost:'x.com',sharedStore:true,settings:{sources:{hn:true,x:true},updateCheck:false},responses:[{match:path=>path.startsWith('https://cdn.syndication.twimg.com/'),json:{id_str:'101',user:{screen_name:'alice'},text:'A verified public post',entities:{urls:[{expanded_url:article}]}}}]});
  await app.context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Original X title</title>'}));
  try{
    await app.page.goto('https://x.com/search?q=url%3Aexample.com%2Farticle#backchannel_x_search=1&nonce='+nonce);
    await app.page.waitForFunction(()=>window.__dispatchSearch);
    await app.page.evaluate(async({nonce,article})=>{
      const now=Date.now();await GM.setValue('HNewhere:bridge_payload:'+nonce,{kind:'x-search',nonce,target:article,query:'url:example.com/article',ts:now,expires:now+15000});
      const request=window.__gmXHR;window.__gmXHR=async options=>{if(options.url.startsWith('https://cdn.syndication.twimg.com/'))await new Promise(resolve=>window.__releasePost=resolve);return request(options)};
      const save=GM.setValue;GM.setValue=async(key,value)=>{if(key==='HNewhere:bridge_result:'+nonce)await new Promise(resolve=>window.__releaseResults=resolve);return save(key,value)};
      window.close=()=>{};GM.closeTab=()=>new Promise(resolve=>window.__releaseClose=resolve);
      window.__searchDone=window.__dispatchSearch();
    },{nonce,article});
    assert(await waitFor(async()=>/Loading search/i.test(await app.page.title()),3000));
    await app.page.evaluate(article=>{document.body.innerHTML=`<a data-testid="AppTabBar_Profile_Link" href="/fixture">Profile</a><article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice</a></div><div data-testid="tweetText">A post <a href="${article}">link</a></div><a href="/alice/status/101"><time datetime="2026-01-02T03:04:05Z">date</time></a></article>`},article);
    assert(await waitFor(async()=>/Finding posts/i.test(await app.page.title()),2000));
    await app.page.waitForFunction(()=>window.__releasePost,null,{timeout:4000});
    assert.match(await app.page.title(),/Checking posts/i);
    await app.page.evaluate(()=>window.__releasePost());
    await app.page.waitForFunction(()=>window.__releaseResults,null,{timeout:3000});
    assert.match(await app.page.title(),/Saving results/i);
    await app.page.evaluate(()=>window.__releaseResults());
    await app.page.waitForFunction(()=>window.__releaseClose,null,{timeout:3000});
    assert.match(await app.page.title(),/Finishing sync/i);
    await app.page.evaluate(()=>window.__releaseClose());
    await app.page.evaluate(()=>window.__searchDone);
    assert.deepEqual(app.errors,[]);
  }finally{await app.browser.close()}
});
