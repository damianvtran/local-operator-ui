/** No React install: framework-like controlled wrapper commits state ONLY on
 * change then replaces its DOM node, reverting property-only writes. */
export const SELECT_FIXTURE = `
<section id="selection">
<label>Native<select id="native"><option value="a">Alpha</option><option value="b">Beta</option><option disabled>Disabled</option></select></label>
<label>Multiple<select id="multi" multiple><option value="a" selected>Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select></label>
<label>Disabled<select id="disabled" disabled><option>Alpha</option></select></label>
<div id="controlled-root"></div>
<button role="combobox" id="combo" aria-controls="choices" aria-expanded="false">Choose colour</button>
<div id="choices" role="listbox" hidden><div role="option" id="red" data-value="r" aria-selected="false">Red</div><div role="option" id="blue" data-value="b" aria-selected="false">Blue</div></div>
<button role="combobox" id="unknown" aria-controls="unknown-choices">Unverifiable</button><div id="unknown-choices" role="listbox" hidden><div role="option">Option without state</div></div>
<pre id="select-state"></pre>
</section><script>
window.__selectEvents=[];window.__controlled='a';
window.__renderControlled=()=>{
 const root=document.getElementById('controlled-root');root.innerHTML='<select id="controlled"><option value="a">Alpha</option><option value="b">Beta</option></select>';
 const s=root.firstChild;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,window.__controlled);
 s.addEventListener('change',()=>{window.__controlled=s.value;window.__selectEvents.push('controlled:change');window.__renderControlled();});
};window.__renderControlled();
for(const s of document.querySelectorAll('select')){s.addEventListener('input',()=>window.__selectEvents.push(s.id+':input'));s.addEventListener('change',()=>window.__selectEvents.push(s.id+':change'));}
const combo=document.getElementById('combo'), choices=document.getElementById('choices');
combo.addEventListener('click',()=>{choices.hidden=false;combo.setAttribute('aria-expanded','true');});
for(const o of choices.children)o.addEventListener('click',()=>{for(const x of choices.children)x.setAttribute('aria-selected',String(x===o));combo.textContent=o.textContent;combo.setAttribute('aria-activedescendant',o.id);choices.hidden=true;combo.setAttribute('aria-expanded','false');});
document.getElementById('unknown').onclick=()=>document.getElementById('unknown-choices').hidden=false;
window.__selectReading=()=>({native:document.getElementById('native').value,multi:Array.from(document.getElementById('multi').selectedOptions).map(o=>o.value),controlled:document.getElementById('controlled').value,held:window.__controlled,events:window.__selectEvents,combo:combo.textContent});
</script>`;
