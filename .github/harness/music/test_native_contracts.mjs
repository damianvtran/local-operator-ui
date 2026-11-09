import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {assertNoAutoplay,safeCancel,signalCleanup} from './native-contracts.mjs';
const idle={players:[{status:'idle'}],paused:true,ownerId:null,status:'idle',time:0,src:null};
assertNoAutoplay(idle);
for(const delta of [{players:[]},{players:[{status:'playing'}]},{paused:false},{ownerId:'sound:other'},{status:'playing'},{time:1},{src:'blob:autoplay'},{paused:undefined}]){
 assert.throws(()=>assertNoAutoplay({...idle,...delta}));
}
async function fixture(broken){
 let open=false,focused=false,cancels=0;const events=[];
 await safeCancel({
  open:async()=>{open=true;focused=false;events.push('open');},
  keep:async()=>{open=false;focused=true;events.push('keep');if(broken==='request')cancels++;},
  escape:async()=>{open=broken==='escape';focused=true;events.push('escape');},
  confirm:async()=>{cancels++;events.push('confirm');},
  dialog:async()=>({open,keep:broken!=='keep',confirm:broken!=='confirm',keepFocused:broken!=='opening-focus',focusReturned:focused&&broken!=='return-focus'}),
  counter:async()=>cancels
 });
 assert.equal(cancels,1);assert.deepEqual(events,['open','keep','open','escape','open','confirm']);
}
await fixture();
for(const missing of ['keep','confirm','opening-focus','return-focus','escape','request'])await assert.rejects(fixture(missing));
for(const name of ['SIGTERM','SIGINT']){
 const emitter=new EventEmitter();let drains=0,interrupted=0,finished=false;
 const reaper=signalCleanup(async()=>{drains++;await new Promise(r=>setTimeout(r,5));finished=true;},()=>interrupted++,emitter);
 emitter.emit(name);emitter.emit(name);await reaper.stop();
 assert.equal(drains,1);assert.equal(finished,true);assert.equal(interrupted,2);
 reaper.dispose();assert.equal(emitter.listenerCount(name),0);
}
// The normal finally must drain without assigning a signal exit status.
const emitter=new EventEmitter();let interrupts=0;
const normal=signalCleanup(async()=>{},()=>interrupts++,emitter);await normal.stop();normal.dispose();assert.equal(interrupts,0);
console.log('PASS native contracts: idle engine, Keep/Escape/focus/counter refusals, awaited idempotent SIGTERM/SIGINT cleanup');
