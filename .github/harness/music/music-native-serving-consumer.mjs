// One native consumer of an ALREADY LIVE, PREFLIGHTED serving graph.
// No Core process, provider fixture, fake IPC or UI result rows are created here.
import {mkdirSync,readFileSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertNoAutoplay,safeCancel,signalCleanup} from './native-contracts.mjs';
process.env.GIT_CONFIG_SYSTEM='/dev/null';
process.env.GIT_TERMINAL_PROMPT='0';
const root=process.env.MUSIC_QA_ROOT;
if(!root || process.env.MUSIC_CORE_PREFLIGHT_PASS!=='1')throw Error('Serving graph preflight not passed');
if(process.env.MUSIC_NATIVE_LEASE!=='1')throw Error('Native resource/CPP lease absent');
// Linked-identity assertions below are mandatory; manual native admission still
// requires the actual hosted Core preflight and the parent's single-run lease.
process.env.TMPDIR=join(root,'native-tmp');mkdirSync(process.env.TMPDIR,{recursive:true});
const {rendererDriverApi:d}=await import(pathToFileURL(join(process.env.MUSIC_UI_WORKTREE,'scripts/renderer-driver.mjs')).href);
const results={scope:'actual native RootApp attached to same real serving music graph',stages:[]};
let interrupted=false,launchPromise;
const pause=async ms=>{await new Promise(r=>setTimeout(r,ms));if(interrupted)throw Error('Native consumer interrupted');};let app,cdp,context;
// Importing the producer deliberately installs no CLI reapers. Join its awaited
// drain ourselves, including a boot still resolving when the signal arrives.
async function cleanup(){
 try{await launchPromise}catch{}
 try{cdp?.close()}catch{}
 try{note('drain',await d.drainLiveBoots({why:'serving acceptance consumer teardown',strict:true}))}
 catch(e){note('drain_error',String(e));process.exitCode=1;throw e}
}
const reaper=signalCleanup(cleanup,()=>{interrupted=true;process.exitCode=143;});
function demand(message, condition){if(!condition)throw Error(message);}
// `ms` bounds the poll (default 30 s); a timeout is a failed required condition.
// On timeout the LAST observed value and elapsed time are noted before the throw:
// run 42849428922 failed late_result_visible with nothing recorded, so the root cause
// (card left the DOM vs late delivery vs selector) was undeterminable. Diagnostic only;
// the accept predicate and bound are unchanged.
async function observed(label, read, accept, ms=30000){const started=Date.now();let last;for(let i=0;i<Math.ceil(ms/100);i++){const value=await read();last=value;if(accept(value)){note(label,value);return value;}await pause(100);}note(label+'_timeout',{last,elapsed_ms:Date.now()-started,bound_ms:ms});throw Error('Required actual native condition absent: '+label);}
// Operator decision a-69e7: the pending motif is measured on the INLINE chat card for
// the named pending job, before the Jobs panel opens, so a motif only the panel paints fails.
async function motionFacts(job){const card='[data-music-generating='+JSON.stringify(job)+']';return cdp.evaluate(`(()=>{const svg=document.querySelector(${JSON.stringify(card+' [data-music-motif]')});const r=svg?.getBoundingClientRect();return {reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,animation:svg?getComputedStyle(svg).animationName:null,width:r?.width||0,height:r?.height||0}})()`);}

function note(stage,value){results.stages.push({stage,value});writeFileSync(join(root,'native-result.json'),JSON.stringify(results,null,2));console.log(stage,JSON.stringify(value));}
async function control(action,details={}){let id=Date.now()+':'+action;writeFileSync(join(root,'native-control.json'),JSON.stringify({id,action,...details}));for(let i=0;i<300;i++){let p=join(root,'native-control-result.json');if(existsSync(p)){let x=JSON.parse(readFileSync(p));if(x.id===id){if(x.error)throw Error(x.error);return x}}await pause(100)}throw Error('Serving graph control timed out '+action)}
async function facts(){return await cdp.evaluate(`({route:location.hash,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},processing:[...document.querySelectorAll('[data-music-processing]')].map(x=>({width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height})),results:document.querySelectorAll('[data-music-result]').length,tracks:[...document.querySelectorAll('[data-music-track]')].map(x=>x.getAttribute('data-music-track')),audio:[...document.querySelectorAll('audio')].map(x=>({paused:x.paused,currentTime:x.currentTime,duration:x.duration})),buttons:[...document.querySelectorAll('button')].map(x=>({label:x.getAttribute('aria-label'),text:x.textContent?.trim().slice(0,100)})).filter(x=>x.label||x.text)})`)}
async function frame(label){note(label+'-facts',await facts());note(label,await d.capture(cdp,label,{assertPalette:false}));}
async function pressLabel(match){const label=await cdp.evaluate(`(()=>{let b=[...document.querySelectorAll('button[aria-label]')].find(x=>${match}.test(x.getAttribute('aria-label')||''));return b?.getAttribute('aria-label')||null})()`);if(!label)return false;await d.verb(cdp,'press',{selector:'button[aria-label='+JSON.stringify(label)+']'});return true;}
try{
 context=d.prepareDriverContext({apiUrl:'http://127.0.0.1:8080'});
 const records=join(process.env.MUSIC_CORE_CONFIG,'run/serve');
 if(!existsSync(records))throw Error('Actual owned Core serve record absent');
 mkdirSync(join(context.config,'run'),{recursive:true});symlinkSync(records,join(context.config,'run/serve'));
 launchPromise=d.launchApp({armed:true,apiUrl:'http://127.0.0.1:8080',windowMode:'headless',tag:'music-serving-acceptance'});app=await launchPromise;if(interrupted)throw Error('Interrupted during boot');
 note('app_pid',app.pid);await d.waitForDevtools(app,45000);cdp=await d.CdpClient.attach(app.port,'out/renderer/index.html');await d.waitForBridge(cdp,45000);
 // Exact official internal seed lifecycle, renderer-driver.mjs:19857–19864.
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}'});
 await cdp.send('Page.reload',{ignoreCache:false});await pause(1500);await d.waitForBridge(cdp,45000);
 note('hello',await d.verb(cdp,'hello'));note('sound_safety_arm',await d.verb(cdp,'soundsArm'));await frame('music-empty-new-chat');
 await d.verb(cdp,'navigate','/chat/'+process.env.MUSIC_SESSION_ID);await pause(1500);await frame('music-populated-preflight');
 const populated=await facts();if(!populated.results||populated.tracks.length<2)throw Error('Actual serving results not rendered; no hand-authored row fallback');
 const mountedPlayers=await cdp.evaluate(`(()=>{return [...document.querySelectorAll('[data-music-track] [data-sound-player]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length})()`);demand('Real mounted visible music players required before engine assertion',mountedPlayers>0);
 note('mounted_engine_no_autoplay',assertNoAutoplay(await d.verb(cdp,'soundsFacts')));
 const pending=await control('start_pending');note('pending_control',pending);await pause(750);await frame('music-loading-first');await pause(1000);await frame('music-loading-settled');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const motionFirst=await motionFacts(pending.job);await frame('music-reduced-first');await pause(1000);const motionSettled=await motionFacts(pending.job);await frame('music-reduced-settled');note('reduced_motion',{first:motionFirst,settled:motionSettled});
 demand('Real pending motif must honor reduced motion and keep geometry',motionFirst.reduce&&motionSettled.reduce&&motionSettled.animation==='none'&&motionFirst.width>0&&motionFirst.height>0&&motionFirst.width===motionSettled.width&&motionFirst.height===motionSettled.height);
 await cdp.send('Emulation.setEmulatedMedia',{features:[]});
 const jobsOpened=await pressLabel(/jobs|background/i);demand('Required Jobs control absent',jobsOpened);await pause(500);
 // The only trigger permitted here names the actual pending job, never the
 // first global Cancel button (other completed jobs coexist in this Session).
 const cancelSelector='[data-job-cancel='+JSON.stringify(pending.job)+']';
 const dialog=async()=>{await pause(500);return cdp.evaluate(`(()=>{const cards=document.querySelectorAll('[data-job-confirm]');const card=cards[0];const keep=card?.querySelector('[data-job-confirm-keep]');const action=card?.querySelector('[data-job-confirm-action]');return {open:cards.length===1,keep:!!keep&&!keep.disabled,confirm:!!action&&!action.disabled,keepFocused:document.activeElement===keep,focusReturned:document.activeElement===document.querySelector(${JSON.stringify(cancelSelector)})}})()`)};
 await safeCancel({
  open:async()=>{await d.verb(cdp,'press',{selector:cancelSelector});await frame('music-cancel-confirmation');},
  keep:()=>d.verb(cdp,'press',{selector:'[data-job-confirm] [data-job-confirm-keep]'}),
  escape:async()=>{for(const type of ['keyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});},
  confirm:()=>d.verb(cdp,'press',{selector:'[data-job-confirm] [data-job-confirm-action]'}),
  dialog,
  counter:async()=>{const witness=await control('inspect_cancel',{job:pending.job});demand('Wrong pending cancellation witness',witness.job===pending.job);note('safe_cancel_counter',witness);return witness.cancel_delta;}
 });
 note('late_settlement',await control('settle_after_native_cancel'));
 const late=JSON.parse(readFileSync(join(root,'native-control-result.json'))).record;
 const track=late.tracks[0].id;
 // Core finishes a cancelled music job on a SUCCESSOR observer job (music/jobs.py
 // CancelledError arm), whose job_result row lands after its own poll and delivery:
 // a fixed pause measured a race (run 42779240064 framed 1.5 s, before the row).
 // Poll (bounded) for the late track outside any turn summary AND the pending card's
 // settled outcome, then frame: billed audio after a cancel must read
 // finished_after_cancel, never cancelled; no audio stays cancelled.
 const pendingCard='[data-music-generating='+JSON.stringify(pending.job)+']';
 const lateOutcome=late.artifacts?.length?'finished_after_cancel':'cancelled';
 // `track`/`card` keep their exact asserted meaning; the other fields are evidence
// only (where the track is, the card's text, every generating card, result counts),
// sampled every ~500 ms into late_result_timeline so a failure names its cause.
 const lateProbe=()=>cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('[data-music-track='+JSON.stringify(track)+']:not([data-turn-summary] *)')});const r=e?.getBoundingClientRect();const all=[...document.querySelectorAll(${JSON.stringify('[data-music-track='+JSON.stringify(track)+']')})];const c=document.querySelector(${JSON.stringify(pendingCard)});return {track:!!e&&r.width>0&&r.height>0,card:c?.getAttribute('data-music-state')||null,track_nodes:all.length,track_in_summary:all.filter(x=>x.closest('[data-turn-summary]')).length,card_present:!!c,card_text:c?.textContent?.trim().slice(0,160)||null,generating:[...document.querySelectorAll('[data-music-generating]')].map(x=>({job:x.getAttribute('data-music-generating'),state:x.getAttribute('data-music-state')})),results:document.querySelectorAll('[data-music-result]').length,tracks:[...document.querySelectorAll('[data-music-track]')].map(x=>x.getAttribute('data-music-track'))}})()`);
 const lateStarted=Date.now(),lateTimeline=[],lateFirst={};let lastSample=-Infinity;
 const lateRead=async()=>{const x=await lateProbe();const t=Date.now()-lateStarted;
  if(x.track&&lateFirst.track_ms===undefined)lateFirst.track_ms=t;
  if(x.card&&lateFirst['card_'+x.card+'_ms']===undefined)lateFirst['card_'+x.card+'_ms']=t;
  if(!x.card_present&&lateFirst.card_absent_ms===undefined)lateFirst.card_absent_ms=t;
  if(t-lastSample>=500){lastSample=t;lateTimeline.push({t,track:x.track,in_summary:x.track_in_summary,nodes:x.track_nodes,card:x.card_present?x.card:'absent',text:x.card_text,generating:x.generating,results:x.results,tracks:x.tracks.length});}
  return x;};
 try{
 await observed('late_result_visible',lateRead,x=>x.track&&x.card===lateOutcome,10000);
 }catch(e){
  // Diagnostic only, never asserted: keep watching to 30 s total so a late-delivery
  // hypothesis is measurable (when did the track / card state first appear?).
  try{while(Date.now()-lateStarted<30000){const x=await lateRead();if(x.track&&x.card===lateOutcome)break;await pause(100);}}catch(diag){note('late_result_extended_error',String(diag));}
  note('late_result_extended',{expected_card:lateOutcome,track,first_seen:lateFirst,watched_ms:Date.now()-lateStarted,asserted_bound_ms:10000});
  throw e;
 }finally{note('late_result_timeline',{expected_card:lateOutcome,track,first_seen:lateFirst,samples:lateTimeline});}
 await frame('music-late-result');
 // 230bede pins a detached music call OUT of its turn's "N actions" bar
 // (ownsDetachedMusicJob/groupSplitterOf), so no summary lists it: the producing call
 // is the record row owning the pending job's inline card — an observed id, never a
 // manufactured tool:<call> — and must still name the producing call.
 const producingRecord=await observed('actual_producing_run',()=>cdp.evaluate(`document.querySelector(${JSON.stringify(pendingCard)})?.closest('[data-record-id]')?.getAttribute('data-record-id')||null`),Boolean);
 demand('Producing record must be the producing music call',producingRecord.includes(pending.producing_call_id));
 // The producing TURN: every record row between the user row before the producing
 // call and the next user row (data-record-kind is the row's own record kind).
 const turnOwners=`(()=>{const anchor=document.querySelector(${JSON.stringify('[data-record-id='+JSON.stringify(producingRecord)+']')});if(!anchor)return [];const all=[...document.querySelectorAll('[data-record-id]')];const users=all.filter(e=>e.getAttribute('data-record-kind')==='user');const start=users.filter(u=>u.compareDocumentPosition(anchor)&Node.DOCUMENT_POSITION_FOLLOWING).pop();const end=users.find(u=>anchor.compareDocumentPosition(u)&Node.DOCUMENT_POSITION_FOLLOWING);return all.filter(e=>(!start||start.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING)&&(!end||e.compareDocumentPosition(end)&Node.DOCUMENT_POSITION_FOLLOWING));})()`;
 // Expand only a fold of the producing turn that is actually folded.
 const expandProducingTurn=async()=>{for(let i=0;i<8;i++){const sel=await cdp.evaluate(`(()=>{const b=${turnOwners}.filter(e=>e.matches('[data-turn-summary]')).map(e=>e.querySelector('button[aria-expanded="false"]')).find(Boolean);return b?'[data-turn-summary][data-record-id='+JSON.stringify(b.closest('[data-turn-summary]').getAttribute('data-record-id'))+'] button[aria-expanded]':null;})()`);if(!sel)return;await d.verb(cdp,'press',{selector:sel});await pause(200);}throw Error('Required actual native condition absent: producing_turn_expanded');};
 await expandProducingTurn();
 const recordId=await observed('actual_music_record',()=>cdp.evaluate(`document.querySelector('[data-music-track="'+${JSON.stringify(track)}+'"]:not([data-turn-summary] *)')?.closest('[data-record-id]')?.getAttribute('data-record-id')||null`),Boolean);
 const player='[data-record-id='+JSON.stringify(recordId)+']:not([data-turn-summary] *) [data-music-track='+JSON.stringify(track)+'] [data-sound-player]';
 const geometry=await cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(player+' [data-sound-slider]')});const r=e?.getBoundingClientRect();return {width:r?.width||0,height:r?.height||0}})()`);note('player_slider_geometry',geometry);demand('Owned transcript player slider must be visible',geometry.width>0&&geometry.height>0);
 note('before_first_play_engine_no_autoplay',assertNoAutoplay(await d.verb(cdp,'soundsFacts')));
 await d.verb(cdp,'press',{selector:player+' > button'});
 const playing=await observed('actual_player_advances',()=>d.verb(cdp,'soundsFacts'),x=>x.time>.2&&!x.paused&&x.gain===0&&x.rms===0&&x.src?.startsWith('blob:'));
 // The owned fixture is intentionally silent; inputRms===0 is not decoder failure.
 const scrub=await d.verb(cdp,'soundsScrub',{selector:player+' [data-sound-slider]',fraction:.65});note('seek_scrubbing',scrub);demand('Actual pointer handlers must enter scrubbing at65percent',scrub.during==='scrubbing'&&Math.round(scrub.seconds/playing.duration*100)===65);
 const committed=await d.verb(cdp,'soundsScrubFinish');demand('Actual pointerup commits seek',committed.committed===true);await frame('music-seek-committed');
 await d.verb(cdp,'press',{selector:player+' > button'});await observed('actual_player_pause',()=>d.verb(cdp,'soundsFacts'),x=>x.paused);
 await d.verb(cdp,'press',{selector:player+' > button'});await d.verb(cdp,'soundsEnd');await observed('actual_player_end',()=>d.verb(cdp,'soundsFacts'),x=>x.status==='ended'&&x.paused);await frame('music-player-ended');
 const partial=await control('start_partial');note('partial_record',partial.record);await observed('visible_partial_receipt',()=>facts(),x=>partial.record.tracks.every(v=>x.tracks.includes(v.id)));await frame('music-partial');
 demand('Actual partial receipt retains billed success and zero failed sibling',partial.record.artifacts.length===1&&partial.record.tracks.some(x=>x.cost.amount_usd===0)&&partial.record.tracks.some(x=>x.cost.basis==='billed'&&x.cost.units===3000&&Math.round(x.cost.amount_usd*1e6)===7500));
 const failed=await control('start_failed');note('failed_record',failed.record);await observed('visible_failed_receipt',()=>facts(),x=>x.tracks.includes(failed.record.tracks[0].id));await frame('music-settled-zero');demand('Actual failed settlement is zero, with no playable artifact',failed.record.artifacts.length===0&&failed.record.tracks[0].cost.amount_usd===0&&failed.record.tracks[0].cost.basis==='billed');
 // Authoritative inventory supplies service-row IDs and digest document identity.
 const zeroTrack=failed.record.tracks[0].id;
 await observed('visible_zero_is_billed_not_unknown',()=>cdp.evaluate(`(()=>{const e=document.querySelector('[data-music-track="'+${JSON.stringify(zeroTrack)}+'"]:not([data-turn-summary] *)');const r=e?.getBoundingClientRect();return {text:e?.textContent||'',width:r?.width||0,height:r?.height||0,players:e?.querySelectorAll('[data-sound-player]').length??-1}})()`),x=>x.width>0&&x.height>0&&x.players===0&&x.text.includes('$0')&&x.text.includes('(billed)')&&!x.text.toLowerCase().includes('unknown'));
 const links=await observed('actual_core_files',()=>control('inspect_links'),x=>x.files.state==='ready'&&x.files.rows.some(r=>r.ref?.digest===late.artifacts[0].digest));
 const D=late.artifacts[0].digest,docId='artifact:'+D;
 const rows=links.files.rows.filter(r=>r.ref?.digest===D);const R=rows[0];
 note('logical_vs_content_identity',{serviceRows:rows.map(r=>({id:r.id,name:r.name,digest:r.ref.digest})),documentId:docId,initialBatch:links.initial_batch});
 demand('Same-byte batch retains independent logical tracks and artifacts',new Set(links.initial_batch.tracks.map(x=>x.id)).size===2&&new Set(links.initial_batch.artifacts.map(x=>x.artifact_id)).size===2&&new Set(links.initial_batch.artifacts.map(x=>x.digest)).size===1);
 // Core's files inventory is CONTENT-ADDRESSED for every digest-only artifact (image,
 // video, voiceover, music alike): the scan keys a record "a:<digest>"
 // (local_operator/session_files/scan.py:225, :707-709), a repeat sighting only bumps
 // touches (scan.py:852), the row id is sha1(session, key) (session_files/service.py:335)
 // and merge folds to ONE entry per file (service.py:435). So this fixture's same-byte
 // 2-variant batch is one service row with touches >= 2; logical track/artifact identity
 // lives in the chat record, asserted above. Real ElevenLabs variants never share bytes.
 demand('Core inventory is content-addressed: exactly one row for the shared digest, touched by both variants of the producing music call',rows.length===1&&R.tool==='generate_music'&&R.touches>=2);
 await d.verb(cdp,'press',{selector:'[data-panel-rail-item="canvas"]'});
 await d.verb(cdp,'press',{selector:'[data-tour-tag="canvas-files-view-button"]'});
 const fileRow='[data-tour-tag="file-row"][data-file-id='+JSON.stringify(docId)+']';
 await observed('visible_indexed_music_file',()=>cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(fileRow)});const r=e?.getBoundingClientRect();return {width:r?.width||0,height:r?.height||0,text:e?.textContent||'',titles:[...(e?.querySelectorAll('[title]')||[])].map(x=>x.getAttribute('title')),player:!!e?.querySelector('[data-sound-player]')}})()`),x=>x.width>0&&x.height>0&&x.player&&(x.text.includes(R.name)||x.titles.some(v=>v?.includes(R.name))));
 await frame('music-files');note('files_resource_counters_only',await d.verb(cdp,'filesFacts'));
 // This is the indexed row's actual onOpen, not openCanvasDocument/mention:true.
 await d.verb(cdp,'press',{selector:fileRow+' > div > button.flex-1'});
 await observed('selected_indexed_canvas_document',()=>d.verb(cdp,'soundsFacts'),x=>x.canvas.some(p=>p.selectedTab===docId&&p.files?.some(f=>f.id===docId&&f.path===docId&&JSON.stringify(f.artifact).includes(D))));
 const panelId=await observed('associated_audio_tabpanel',()=>cdp.evaluate(`(()=>{for(const tab of document.querySelectorAll('[role="tab"][aria-selected="true"]')){const id=tab.getAttribute('aria-controls'),p=id&&document.getElementById(id),r=p?.getBoundingClientRect();if(p?.getAttribute('role')==='tabpanel'&&r.width>0&&r.height>0&&p.querySelector('[data-sound-player]'))return id;}return null})()`),Boolean);
 const preview='[id='+JSON.stringify(panelId)+'] [data-sound-player]';
 await d.verb(cdp,'press',{selector:preview+' > button'});
 await observed('indexed_canvas_digest_playback',()=>d.verb(cdp,'soundsFacts'),x=>x.ownerId==='sound:'+D&&!x.paused&&x.time>.2&&x.src?.startsWith('blob:')&&x.nativeElements===0);
 await frame('music-canvas');await d.verb(cdp,'press',{selector:preview+' > button'});
 await d.verb(cdp,'press',{selector:'[aria-label="Close canvas"]'});
 // Reopen only the actual producing turn; never a global first summary/player.
 await expandProducingTurn();
 const highlightSelector=await observed('actual_same_turn_highlight',()=>cdp.evaluate(`(()=>{const owners=${turnOwners};let cells=[...new Set(owners.flatMap(e=>[...e.querySelectorAll('[data-supplement-sounds] > [data-supplement-sound]')]))];const cell=cells.find(e=>e.querySelector('[data-supplement-sound-title]')?.textContent?.includes(${JSON.stringify(R.name)}));if(!cell)return null;const e=cell.querySelector('[data-sound-player] > button');if(!e)return null;let path='';for(let n=e;n&&n.parentElement;n=n.parentElement){path=n.tagName.toLowerCase()+':nth-child('+([...n.parentElement.children].indexOf(n)+1)+')'+(path?' > '+path:'');}return 'html > '+path;})()`),Boolean);
 await d.verb(cdp,'press',{selector:highlightSelector});
 await observed('same_turn_highlight_digest_playback',()=>d.verb(cdp,'soundsFacts'),x=>x.ownerId==='sound:'+D&&!x.paused&&x.time>.2&&x.src?.startsWith('blob:'));
 await frame('music-highlights');
 note('coverage',{serving_graph:'asserted',seek:'asserted',reduced_motion:'asserted',error_state:'asserted',files:'Core content-addressed row (one per digest, touches>=2) + visible indexed digest row',canvas:'actual row onOpen + selected tab/panel + digest playback',highlights:'actual producing run/cell + same digest playback',sfx_neighbor:'RETAINED component presentation only: parent verified R2 sound-player blob2f0fbd5bf83149744d486bbd1c020d65b1626239; no new SFX generation claim',rtl:'RETAINED JobsCancelRtl/Urdu confirmation presentation with source/catalogue compatibility; no full-App RTL claim',acceptance:'Native predicates executed; retained dimensions still require independent QA/design judgment'});

}catch(e){note('blocked',String(e));process.exitCode=1;
 // Best effort: the frame at the moment of failure, before teardown destroys it.
 if(cdp)try{await frame('music-failure-final')}catch(f){note('failure_frame_error',String(f))}}
finally{
 try{await reaper.stop()}catch(e){note('cleanup_blocked',String(e));process.exitCode=1}
 reaper.dispose();
}
