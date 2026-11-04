#!/usr/bin/env node
// Local "what's in the stores" page: `npm run status` → http://localhost:4477
//
// Shows the latest Android/iOS builds and whether each one was uploaded to
// Google Play / App Store Connect, refreshing every 20s. Reads your own Expo
// login from ~/.expo/state.json on this Mac only — the page is served on
// localhost and the session never leaves this machine, which is why this is
// a local script and not a hosted website.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';

const PORT = 4477;
const APP_ID = '23496903-a9cc-44b2-8c89-724e265c34f1';
const EXPO_BUILDS = 'https://expo.dev/accounts/kabilan404/projects/mobile-portal/builds';

function session() {
  const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.expo/state.json'), 'utf8'));
  const secret = state?.auth?.sessionSecret;
  if (!secret) throw new Error('Not logged in to Expo — run `eas login` first.');
  return secret;
}

async function fetchStatus() {
  const query = `{ app { byId(appId: "${APP_ID}") {
    builds(offset: 0, limit: 20) { id platform status appVersion appBuildVersion createdAt completedAt buildProfile distribution artifacts { buildUrl } error { message } }
    submissions(offset: 0, limit: 20, filter: {}) { id platform status createdAt updatedAt error { message } submittedBuild { id } }
  } } }`;
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'expo-session': session() },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  const { builds, submissions } = json.data.app.byId;
  const byBuild = new Map(submissions.filter((s) => s.submittedBuild).map((s) => [s.submittedBuild.id, s]));
  return builds.map((b) => {
    const s = byBuild.get(b.id);
    return {
      id: b.id,
      platform: b.platform,
      version: b.appVersion,
      build: b.appBuildVersion,
      buildStatus: b.status,
      buildError: b.error?.message ?? null,
      profile: b.buildProfile,
      internal: b.distribution === 'INTERNAL',
      downloadUrl: b.artifacts?.buildUrl ?? null,
      createdAt: b.createdAt,
      completedAt: b.completedAt,
      storeStatus: s?.status ?? null,
      storeUpdatedAt: s?.updatedAt ?? null,
      storeError: s?.error?.message ?? null,
    };
  });
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Store Status</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--text:#0f1f33;--muted:#6b7280;--line:#e5e7eb;--ok:#16a34a;--run:#d97706;--bad:#dc2626;--brand:#f0a227}
@media (prefers-color-scheme:dark){:root{--bg:#0b1422;--card:#132033;--text:#e8edf4;--muted:#94a3b8;--line:#22324a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
main{max-width:1000px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
h1{font-size:22px;margin:0}.sub{color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.card h2{font-size:15px;margin:0 0 12px;display:flex;gap:8px;align-items:center}
.big{font-size:30px;font-weight:700}.row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:14px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{background:#16a34a1f;color:var(--ok)}.run{background:#d977061f;color:var(--run)}.bad{background:#dc26261f;color:var(--bad)}.none{background:#6b72801f;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 8px;border-top:1px solid var(--line)}th{color:var(--muted);font-weight:600;font-size:12px}
.tablewrap{overflow-x:auto}a{color:inherit}.err{color:var(--bad);font-size:12px}
button{background:var(--brand);color:#0f1f33;border:0;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
</style></head><body><main>
<header><div><h1>PMC Portal — Store Status</h1><div class="sub" id="updated">Loading…</div></div><button onclick="load()">Refresh</button></header>
<div class="grid" id="summary"></div>
<div class="card"><h2>Recent builds</h2><div class="tablewrap"><table><thead><tr><th>App</th><th>Build</th><th>Build status</th><th>Store upload</th><th>Started</th></tr></thead><tbody id="rows"></tbody></table></div></div>
<p class="sub">Full logs: <a href="${EXPO_BUILDS}" target="_blank">expo.dev builds</a> · "Uploaded" means it reached Google Play internal testing / App Store Connect (TestFlight). Checks for updates every 5 minutes by itself — no need to reload.</p>
</main><script>
const BUILD={FINISHED:['Built','ok'],IN_PROGRESS:['Building…','run'],IN_QUEUE:['Waiting in queue','run'],NEW:['Starting','run'],ERRORED:['Build failed','bad'],CANCELED:['Cancelled','none']};
const STORE={FINISHED:['Uploaded','ok'],IN_PROGRESS:['Uploading…','run'],AWAITING_BUILD:['Waits for build','run'],IN_QUEUE:['Upload queued','run'],ERRORED:['Upload failed','bad'],CANCELED:['Cancelled','none']};
const pill=([t,c])=>'<span class="pill '+c+'">'+t+'</span>';
const dur=(ms)=>{const m=Math.max(0,Math.round(ms/60000));return m<60?m+' min':Math.floor(m/60)+' hr '+(m%60)+' min';};
const clock=(d)=>new Date(d).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const sub=(t)=>'<div class="sub" style="margin-top:3px">'+t+'</div>';
// Estimates come from this project's own history: average of the last 5
// finished builds (start → built) and uploads (built → in store) per platform.
let EST={};
function estimates(list){
  const avg=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  for(const p of ['ANDROID','IOS']){
    const done=list.filter(b=>b.platform===p&&b.buildStatus==='FINISHED'&&b.completedAt).slice(0,5);
    const up=done.filter(b=>b.storeStatus==='FINISHED'&&b.storeUpdatedAt);
    EST[p]={build:avg(done.map(b=>new Date(b.completedAt)-new Date(b.createdAt)))||30*60000,
            upload:avg(up.map(b=>new Date(b.storeUpdatedAt)-new Date(b.completedAt)))||5*60000,
            samples:done.length};
  }
}
function bar(frac,color){return '<div style="height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden;min-width:140px"><div style="height:100%;width:'+Math.round(Math.min(1,frac)*100)+'%;background:'+color+'"></div></div>';}
function buildTime(b){
  if(b.buildStatus==='FINISHED'&&b.completedAt) return sub('took '+dur(new Date(b.completedAt)-new Date(b.createdAt))+' · done '+clock(b.completedAt));
  if(['IN_PROGRESS','IN_QUEUE','NEW'].includes(b.buildStatus)){
    const e=EST[b.platform], el=Date.now()-new Date(b.createdAt), left=e.build-el;
    return bar(el/e.build,'var(--run)')+sub('<b>'+dur(el)+'</b> so far · '+(left>60000?'~'+dur(left)+' left':'almost done…'))
      +sub('usually takes ~'+dur(e.build)+' · built by ~'+clock(new Date(b.createdAt).getTime()+e.build));
  }
  return '';
}
function storeEta(b){
  if(['IN_PROGRESS','IN_QUEUE','NEW'].includes(b.buildStatus)||['AWAITING_BUILD','IN_PROGRESS','IN_QUEUE'].includes(b.storeStatus)){
    const e=EST[b.platform];
    const base=b.completedAt?new Date(b.completedAt).getTime():new Date(b.createdAt).getTime()+e.build;
    return sub('expected in store ~'+clock(base+e.upload));
  }
  return '';
}
function storeTime(b){
  if(b.storeStatus==='FINISHED'&&b.storeUpdatedAt) return sub('in store at '+when(b.storeUpdatedAt));
  if(b.storeStatus==='IN_PROGRESS'&&b.storeUpdatedAt) return sub('uploading since '+clock(b.storeUpdatedAt));
  return '';
}
const when=(d)=>new Date(d).toLocaleString([], {day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const name=(p)=>p==='IOS'?'📱 iPhone':'🤖 Android';
function summary(list,p){
  const mine=list.filter(b=>b.platform===p);
  const live=mine.find(b=>b.storeStatus==='FINISHED');
  const busy=mine.find(b=>['IN_PROGRESS','IN_QUEUE','NEW'].includes(b.buildStatus)||['IN_PROGRESS','AWAITING_BUILD','IN_QUEUE'].includes(b.storeStatus));
  return '<div class="card"><h2>'+name(p)+'</h2><div class="sub">Latest in '+(p==='IOS'?'TestFlight':'Play Store (internal testing)')+'</div>'
   +'<div class="big">'+(live?'Build '+live.build:'—')+'</div>'
   +(live?'<div class="sub">v'+live.version+' · in store since '+when(live.storeUpdatedAt||live.completedAt||live.createdAt)+'</div>':'')
   +'<div class="row"><span>Right now</span>'+(busy?pill(BUILD[busy.buildStatus]&&busy.buildStatus!=='FINISHED'?BUILD[busy.buildStatus]:STORE[busy.storeStatus]||['Working','run'])+' <b>build '+busy.build+'</b>':pill(['Idle','none']))+'</div></div>';
}
async function load(){
  try{
    const r=await fetch('/api/status');const d=await r.json();if(d.error)throw new Error(d.error);LAST=d;estimates(d);FETCHED=Date.now();render();
  }catch(e){document.getElementById('updated').textContent='Could not load: '+e.message;}
}
function render(){
  const d=LAST;if(!d)return;
  {
    document.getElementById('summary').innerHTML=summary(d,'ANDROID')+summary(d,'IOS');
    document.getElementById('rows').innerHTML=d.map(b=>'<tr><td>'+name(b.platform)+'</td><td>v'+b.version+' ('+b.build+')</td><td>'+pill(BUILD[b.buildStatus]||[b.buildStatus,'none'])+buildTime(b)+(b.buildError?'<div class="err">'+b.buildError+'</div>':'')+'</td><td>'+(b.storeStatus?pill(STORE[b.storeStatus]||[b.storeStatus,'none']):b.internal?pill(['Preview · direct install','none'])+(b.downloadUrl&&b.buildStatus==='FINISHED'?sub('<a href="'+b.downloadUrl+'" target="_blank">Download / install link</a> · not for the store'):''):pill(['Not sent','none']))+storeTime(b)+storeEta(b)+(b.storeError?'<div class="err">'+b.storeError+'</div>':'')+'</td><td>'+when(b.createdAt)+'</td></tr>').join('');
    const next=Math.max(0,Math.round((FETCHED+REFRESH_MS-Date.now())/1000));
    document.getElementById('updated').innerHTML='<span style="color:var(--ok)">●</span> Live · checked '+clock(FETCHED)+' · next check in '+Math.floor(next/60)+':'+String(next%60).padStart(2,'0');
  }
}
let LAST=null,FETCHED=0;const REFRESH_MS=5*60*1000;
load();
setInterval(load,REFRESH_MS);            // quiet background check every 5 minutes
setInterval(render,1000);                // timers/progress tick every second
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-FETCHED>60000)load();});
</script></body></html>`;

http
  .createServer(async (req, res) => {
    if (req.url === '/api/status') {
      // Fetch first, respond once — writing headers before the await meant a
      // failed Expo request (e.g. the Mac went offline) wrote them a second
      // time in the catch and crashed the whole server.
      let body;
      try {
        body = await fetchStatus();
      } catch (err) {
        body = { error: err.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  })
  .listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Store status page: ${url}  (Ctrl+C to stop)`);
    exec(`open ${url}`);
  });
