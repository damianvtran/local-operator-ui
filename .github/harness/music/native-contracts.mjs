// Pure acceptance predicates used by the real consumer and cheap negative controls.
// Missing instrumentation is a failed prerequisite, never a qualified success.
export function assertNoAutoplay(facts) {
 if (!facts || !facts.players?.length || facts.players.some(x=>x.status!=='idle') ||
     facts.paused!==true || facts.ownerId!==null || facts.status!=='idle' ||
     facts.time!==0 || facts.src!==null) throw Error('Mounted players must leave the actual engine idle before user playback');
 return facts;
}
export async function safeCancel({open,keep,escape,confirm,dialog,counter}) {
 async function opened(){
  await open();const state=await dialog();
  if(state.open!==true||state.keep!==true||state.confirm!==true||state.keepFocused!==true)
   throw Error('Pending job confirmation/Keep/focus absent');
 }
 async function dismissed(){
  const state=await dialog();
  if(state.open!==false||state.focusReturned!==true)throw Error('Pending Cancel focus not restored');
  if(await counter()!==0)throw Error('Safe dismissal sent a provider cancel');
 }
 if(await counter()!==0)throw Error('Pending job already cancelled');
 await opened();await keep();await dismissed();
 await opened();await escape();await dismissed();
 await opened();await confirm();
 // The caller waits on the real controller's exactly-one settlement assertion.
}
export function signalCleanup(cleanup, onInterrupted, emitter=process) {
 let pending;
 const stop=()=>pending??=Promise.resolve().then(cleanup);
 const handler=()=>{onInterrupted();void stop().catch(()=>{emitter.exitCode=1;});};
 emitter.on('SIGTERM',handler);emitter.on('SIGINT',handler);
 return {stop,dispose(){emitter.removeListener('SIGTERM',handler);emitter.removeListener('SIGINT',handler);}};
}

// The CSS selector for a transcript record's OWN row. A collapsed turn-summary bar
// (turn-summary.tsx) stamps its wrapper with data-record-id = the first row it hides,
// so a bare [data-record-id=...] lookup finds the bar and reads it as the row - the
// false "read-0 visible" in native run 43468507828. Only the real row
// (canonical-transcript.tsx) carries data-record-kind; requiring it, and excluding the
// bar, keeps a read rendered as an expanded row outside the fold detectable.
export function recordRowSelector(id) {
  return '[data-record-id='+JSON.stringify(id)+'][data-record-kind]:not([data-turn-summary])';
}
