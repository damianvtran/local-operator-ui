// One native consumer of an ALREADY LIVE, PREFLIGHTED serving graph.
// No Core process, provider fixture, fake IPC or UI result rows are created here.
import {mkdirSync,readFileSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
process.env.GIT_CONFIG_SYSTEM='/dev/null';
process.env.GIT_TERMINAL_PROMPT='0';
const root=process.env.MUSIC_QA_ROOT;
if(!root || process.env.MUSIC_CORE_PREFLIGHT_PASS!=='1')throw Error('Serving graph preflight not passed');
if(process.env.MUSIC_NATIVE_LEASE!=='1')throw Error('Native resource/CPP lease absent');
// This gate is deliberately not an environment bypass. Complete the actual
// linked-identity assertions below before spending the one authorized App boot.
const panelIdentityAssertionsReady=false;
if(!panelIdentityAssertionsReady)throw Error('Native source preflight BLOCKED: Files/Canvas/Highlights linked-identity predicates are not implemented; do not consume an App boot');
process.env.TMPDIR=join(root,'native-tmp');mkdirSync(process.env.TMPDIR,{recursive:true});
const {rendererDriverApi:d}=await import(pathToFileURL(join(process.env.MUSIC_UI_WORKTREE,'scripts/renderer-driver.mjs')).href);
const results={scope:'actual native RootApp attached to same real serving music graph',stages:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));let app,cdp,context;
function demand(message, condition){if(!condition)throw Error(message);}
async function observed(label, read, accept){for(let i=0;i<300;i++){const value=await read();if(accept(value)){note(label,value);return value;}await pause(100);}throw Error('Required actual native condition absent: '+label);}
async function motionFacts(){return cdp.evaluate(`(()=>{const svg=document.querySelector('[data-music-processing] svg');const r=svg?.getBoundingClientRect();return {reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:svg?getComputedStyle(svg).animationName:null,width:r?.width||0,height:r?.height||0}})()`);}

function note(stage,value){results.stages.push({stage,value});writeFileSync(join(root,'native-result.json'),JSON.stringify(results,null,2));console.log(stage,JSON.stringify(value));}
async function control(action){let id=Date.now()+':'+action;writeFileSync(join(root,'native-control.json'),JSON.stringify({id,action}));for(let i=0;i<300;i++){let p=join(root,'native-control-result.json');if(existsSync(p)){let x=JSON.parse(readFileSync(p));if(x.id===id){if(x.error)throw Error(x.error);return x}}await pause(100)}throw Error('Serving graph control timed out '+action)}
async function facts(){return await cdp.evaluate(`({route:location.hash,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},processing:[...document.querySelectorAll('[data-music-processing]')].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height})),results:document.querySelectorAll('[data-music-result]').length,tracks:[...document.querySelectorAll('[data-music-track]')].map(x=>x.getAttribute('data-music-track')),audio:[...document.querySelectorAll('audio')].map(x=>({paused:x.paused,currentTime:x.currentTime,duration:x.duration})),buttons:[...document.querySelectorAll('button')].map(x=>({label:x.getAttribute('aria-label'),text:x.textContent?.trim().slice(0,100)})).filter(x=>x.label||x.text)})`)}
async function frame(label){note(label+'-facts',await facts());note(label,await d.capture(cdp,label,{assertPalette:false}));}
async function pressLabel(match){const label=await cdp.evaluate(`(()=>{let b=[...document.querySelectorAll('button[aria-label]')].find(x=>${match}.test(x.getAttribute('aria-label')||''));return b?.getAttribute('aria-label')||null})()`);if(!label)return false;await d.verb(cdp,'press',{selector:'button[aria-label='+JSON.stringify(label)+']'});return true;}
try{
 context=d.prepareDriverContext({apiUrl:'http://127.0.0.1:8080'});
 const records=join(process.env.MUSIC_CORE_CONFIG,'run/serve');
 if(!existsSync(records))throw Error('Actual owned Core serve record absent');
 mkdirSync(join(context.config,'run'),{recursive:true});symlinkSync(records,join(context.config,'run/serve'));
 app=await d.launchApp({armed:true,apiUrl:'http://127.0.0.1:8080',windowMode:'headless',tag:'music-serving-acceptance'});
 note('app_pid',app.pid);await d.waitForDevtools(app,45000);cdp=await d.CdpClient.attach(app.port,'out/renderer/index.html');await d.waitForBridge(cdp,45000);
 // Exact official internal seed lifecycle, renderer-driver.mjs:19857–19864.
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}'});
 await cdp.send('Page.reload',{ignoreCache:false});await pause(1500);await d.waitForBridge(cdp,45000);
 note('hello',await d.verb(cdp,'hello'));note('sound_safety_arm',await d.verb(cdp,'soundsArm'));await frame('music-empty-new-chat');
 await d.verb(cdp,'navigate','/chat/'+process.env.MUSIC_SESSION_ID);await pause(1500);await frame('music-populated-preflight');
 const populated=await facts();if(!populated.results||populated.tracks.length<2)throw Error('Actual serving results not rendered; no hand-authored row fallback');
 note('pending_control',await control('start_pending'));await pause(750);await frame('music-loading-first');await pause(1000);await frame('music-loading-settled');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const motionFirst=await motionFacts();await frame('music-reduced-first');await pause(1000);const motionSettled=await motionFacts();await frame('music-reduced-settled');note('reduced_motion',{first:motionFirst,settled:motionSettled});
 demand('Real pending motif must honor reduced motion and keep geometry',motionFirst.reduce&&motionSettled.reduce&&motionSettled.animation==='none'&&motionFirst.width>0&&motionFirst.height>0&&motionFirst.width===motionSettled.width&&motionFirst.height===motionSettled.height);
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 const jobsOpened=await pressLabel(/jobs|background/i);note('jobs_opened',jobsOpened);await pause(500);
 const cancelled=await pressLabel(/cancel/i);note('native_cancel_pressed',cancelled);if(!cancelled)throw Error('Required native Cancel control absent');
 if(cancelled){await pause(500);await frame('music-cancel-confirmation');
  // A confirmation's safe Keep control is never dismissed by submitting a fake
  // transport request. Press the actual confirmation only if the UI provides it.
  const confirm=await pressLabel(/cancel.*job|confirm.*cancel|stop.*job/i);note('cancel_confirm_pressed',confirm);
 }
 note('late_settlement',await control(cancelled?'settle_after_native_cancel':'settle_without_native_cancel'));
 await pause(1500);await frame('music-late-result');
 const late=JSON.parse(readFileSync(join(root,'native-control-result.json'))).record;
 const track=late.tracks[0].id;
 const player='[data-music-track='+JSON.stringify(track)+']:not([data-turn-summary] *) [data-sound-player]';
 const geometry=await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(player+' [data-sound-slider]')});const r=e?.getBoundingClientRect();return {width:r?.width||0,height:r?.height||0}})()`);note('player_slider_geometry',geometry);demand('Owned transcript player slider must be visible',geometry.width>0&&geometry.height>0);
 await d.verb(cdp,'press',{selector:player+' > button'});
 const playing=await observed('actual_player_advances',()=>d.verb(cdp,'soundsFacts'),x=>x.time>.2&&!x.paused&&x.gain===0&&x.rms===0&&x.src?.startsWith('blob:'));
 // The owned fixture is intentionally silent; inputRms===0 is not decoder failure.
 const scrub=await d.verb(cdp,'soundsScrub',{selector:player+' [data-sound-slider]',fraction:.65});note('seek_scrubbing',scrub);demand('Actual pointer handlers must enter scrubbing at65percent',scrub.during==='scrubbing'&&Math.round(scrub.seconds/playing.duration*100)===65);
 const committed=await d.verb(cdp,'soundsScrubFinish');demand('Actual pointerup commits seek',committed.committed===true);await frame('music-seek-committed');
 await d.verb(cdp,'press',{selector:player+' > button'});await observed('actual_player_pause',()=>d.verb(cdp,'soundsFacts'),x=>x.paused);
 await d.verb(cdp,'soundsEnd');await frame('music-player-ended');
 const partial=await control('start_partial');note('partial_record',partial.record);await observed('visible_partial_receipt',()=>facts(),x=>partial.record.tracks.every(v=>x.tracks.includes(v.id)));await frame('music-partial');
 demand('Actual partial receipt retains billed success and zero failed sibling',partial.record.artifacts.length===1&&partial.record.tracks.some(x=>x.cost.amount_usd===0)&&partial.record.tracks.some(x=>x.cost.amount_usd===.0075));
 const failed=await control('start_failed');note('failed_record',failed.record);await observed('visible_failed_receipt',()=>facts(),x=>x.tracks.includes(failed.record.tracks[0].id));await frame('music-settled-zero');demand('Actual failed settlement is zero, with no playable artifact',failed.record.artifacts.length===0&&failed.record.tracks[0].cost.amount_usd===0&&failed.record.tracks[0].cost.basis==='billed');
 const openedFiles=await pressLabel(/^files$|open files|show files/i);note('files_open_pressed',openedFiles);demand('Actual Files control required',openedFiles);await pause(600);await frame('music-files');note('filesFacts',await d.verb(cdp,'filesFacts'));
 const openedCanvas=await pressLabel(/canvas/i);note('canvas_open_pressed',openedCanvas);demand('Actual Canvas control required',openedCanvas);await pause(500);await frame('music-canvas');
 const openedHighlights=await pressLabel(/highlights/i);note('highlights_open_pressed',openedHighlights);demand('Actual Highlights control required',openedHighlights);await pause(500);await frame('music-highlights');
 note('coverage',{serving_graph:'observed',seek:'asserted',reduced_motion:'asserted',error_state:'asserted',sfx_neighbor:'RETAINED only if parent verifies prior sounds-scene evidence and unchanged shared player/engine',rtl:'PRESENTATIONAL RTL only: parent-verified canonical RTL Story evidence; no full-app RTL activation claim',panel_linked_identity:'BLOCKED: panel open is not yet a linked-asset assertion',acceptance:'BLOCKED until panel linked identities and retained evidence are independently verified'});process.exitCode=1;
}catch(e){note('blocked',String(e));process.exitCode=1}
finally{
 try{cdp?.close()}catch{}
 try{note('drain',await d.drainLiveBoots({why:'serving acceptance consumer finally',strict:true}))}catch(e){note('drain_error',String(e));process.exitCode=1}
 if(app?.child){const arg=app.child.spawnargs.find(x=>x.startsWith('--user-data-dir='));if(arg){const {thisRunProfile}=await import(pathToFileURL(join(process.env.MUSIC_UI_WORKTREE,'scripts/app-tree-teardown.mjs')).href);let rows=thisRunProfile(arg.slice(16));if(rows===null){note('profile_unreadable',true);process.exitCode=1}else{for(const x of rows){try{process.kill(x.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}await pause(500);rows=thisRunProfile(arg.slice(16));note('remaining_profile_processes',rows);if(rows===null||rows.length)process.exitCode=1}}}
}
