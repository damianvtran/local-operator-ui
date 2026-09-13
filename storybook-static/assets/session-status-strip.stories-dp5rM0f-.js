import{j as n}from"./jsx-runtime-6qgwzs7k.js";import{r as g}from"./index-DQDNmYQF.js";/* empty css              */import{S as In}from"./spinner-B2SkZRIb.js";import"./tabs-D6HlMULL.js";import{c as p,T as X}from"./tooltip-BdVa6PqK.js";import"./textarea-DG-lIhp0.js";import{b as On,a as Mn,r as An,e as Rn}from"./session-model-BTAOQ748.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";const $n={signal:"stroke-info",label:"stroke-warning",danger:"stroke-danger"},h=14,z=1.75,Y=h/2-z/2,ee=2*Math.PI*Y,Pn=.06,Z=({reading:e,className:t})=>{const o=e.fraction,a=o!==null&&o>0,s=a?Math.max(o,Pn):0;return n.jsxs("svg",{width:h,height:h,viewBox:`0 0 ${h} ${h}`,className:p("shrink-0",t),"aria-hidden":"true",focusable:"false",children:[n.jsx("circle",{cx:h/2,cy:h/2,r:Y,fill:"none",strokeWidth:z,className:p(a?"stroke-sunken":"stroke-hairline")}),a&&n.jsx("circle",{cx:h/2,cy:h/2,r:Y,fill:"none",strokeWidth:z,strokeLinecap:"round",strokeDasharray:ee,strokeDashoffset:ee*(1-s),transform:`rotate(-90 ${h/2} ${h/2})`,className:p($n[e.rung])})]})};try{Z.displayName="ContextWheel",Z.__docgenInfo={description:"",displayName:"ContextWheel",props:{reading:{defaultValue:null,description:"",name:"reading",required:!0,type:{name:"ContextReading"}},className:{defaultValue:null,description:"",name:"className",required:!1,type:{name:"string"}}}}}catch{}const Dn=0x7ffn,Gn=0xfffffffffffffn,Ln=1075,Un=-1074;function Bn(e){const t=new DataView(new ArrayBuffer(8));t.setFloat64(0,e);const o=BigInt(t.getUint32(0))<<32n|BigInt(t.getUint32(4)),a=(o>>63n&1n)===1n,s=Number(o>>52n&Dn),c=o&Gn,d=s===0?c:c|1n<<52n,m=s===0?Un:s-Ln;return m>=0?{negative:a,num:d<<BigInt(m),scale:0}:{negative:a,num:d*5n**BigInt(-m),scale:-m}}function ne(e,t){let o=e.toString();if(t===0)return o;for(;o.length<=t;)o=`0${o}`;return`${o.slice(0,o.length-t)}.${o.slice(o.length-t)}`}function w(e,t){if(!Number.isFinite(e))return"";const{negative:o,num:a,scale:s}=Bn(e);if(t>=s)return(o?"-":"")+ne(a*10n**BigInt(t-s),t);const c=10n**BigInt(s-t),d=a/c,m=a%c,y=c/2n,v=m>y||m===y&&(d&1n)===1n?d+1n:d;return(o?"-":"")+ne(v,t)}const te=["danger","label","signal"],Tn="signal",qn=[[5e5,"danger"],[2e5,"label"]],Wn=[[.8,"danger"],[.55,"label"]];function Xn(e,t=0){let o=Tn;for(const[a,s]of qn)if(e>a){o=s;break}if(t>0){for(const[a,s]of Wn)if(e>t*a){te.indexOf(s)<te.indexOf(o)&&(o=s);break}}return o}function jn(e){return e>=1e6?`${w(e/1e6,1)}m`:e>=1e3?`${w(e/1e3,1)}k`:String(e)}function q(e){if(e>=1e6){const t=e/1e6;return t===Math.trunc(t)?`${w(t,0)}M`:`${w(t,1)}M`}if(e>=1e3){const t=e/1e3;return t===Math.trunc(t)?`${w(t,0)}k`:`${w(t,1)}k`}return String(e)}function oe(e,t){if(e<=0)return"";if(t<=0)return`${jn(e)}/—`;const o=e/t*100;return o<.05?`<0.1%/${q(t)}`:`${w(o,1)}%/${q(t)}`}function Hn(e){const t=e.context_tokens,o=typeof t=="number"&&Number.isFinite(t)&&t>0?t:null,a=e.context_window,s=typeof a=="number"&&Number.isFinite(a)&&a>0?a:null,c=Xn(o??0,s??0);return o===null?{status:"no-reading",tokens:null,window:s,fraction:null,rung:Tn,spelling:""}:s===null?{status:"window-unknown",tokens:o,window:null,fraction:null,rung:c,spelling:oe(o,0)}:{status:e.context_is_estimate?"estimate":"measured",tokens:o,window:s,fraction:Math.min(o/s,1),rung:c,spelling:oe(o,s)}}function Kn(e,t){if(e.status==="no-reading")return["Context","No reading yet. The first turn reports what the request carried."];const o=[];if(e.status==="window-unknown")return o.push(e.spelling),o.push(`${jn(e.tokens??0)} tokens in use. The window this model allows is not known, so there is no percentage to show.`),o;const a=e.tokens??0,s=e.window??0;return o.push(e.spelling),o.push(`${a.toLocaleString()} of ${s.toLocaleString()} tokens (${q(s)} window)`),typeof t=="number"&&t>0&&t!==s&&o.push(`Model maximum: ${q(t)}`),e.status==="estimate"&&o.push("estimate - counted by the app, not reported by the provider yet"),o}const Vn="≥",Nn="$—";function Cn(e){return typeof e=="number"&&Number.isFinite(e)?e:null}function zn(e){if(e.subagent_cost_knowledge!=null)return Cn(e.subagent_cost);const t=e.child_costs;if(!t)return null;const o=Object.values(t).filter(a=>typeof a=="number"&&Number.isFinite(a));return o.length>0?o.reduce((a,s)=>a+s,0):null}function Yn(e){return e==="floor"||e==="partial"}function Zn(e){return e==="exact"||e==="partial"||e==="floor"?e:"unknown"}function Q(e){return e<.01?`$${w(e,4)}`:e<1?`$${w(e,3)}`:`$${w(e,2)}`}function Qn(e){const t=Zn(e.cost_knowledge);if(t==="partial"||t==="floor")return t;const o=e.subagent_cost_knowledge;return o==="partial"||o==="unknown"&&e.child_costs&&Object.keys(e.child_costs).length>0?"partial":t}function Jn(e,t){const o=Cn(e.cumulative_parent_cost),a=zn(e),s=Qn(e),c=Yn(s),d=o===null&&a===null?null:(o??0)+(a??0);if(d===null){const m=!!(t&&((t.input_tokens??0)||(t.output_tokens??0)));return{total:null,knowledge:s,isFloor:c,text:m?Nn:""}}return d?{total:d,knowledge:s,isFloor:c,text:`${c?Vn:""}${Q(d)}`}:{total:d,knowledge:s,isFloor:c,text:""}}function se(e){if(e.total===null)return e.text===Nn?"This session billed tokens on a model with no published price, so the spend cannot be calculated.":"Nothing has been spent in this session yet.";if(!e.total)return"Nothing has been spent in this session yet.";const t=`Session spend so far: ${Q(e.total)}.`;return e.isFloor?`Session spend is at least ${Q(e.total)}. Part of this conversation ran before the app was tracking it, or a subagent's spend is not fully known.`:t}const U=60,B=3600,H=86400;function K(e){const t=Math.trunc(Number.isFinite(e)&&e>0?e:0);if(t<U)return`${t}s`;if(t<B){const s=Math.trunc(t/U),c=t%U;return c?`${s}m${c}s`:`${s}m`}if(t<H){const s=Math.trunc(t/B),c=Math.trunc(t%B/U);return c?`${s}h${c}m`:`${s}h`}const o=Math.trunc(t/H);if(o>99)return"100d+";const a=Math.trunc(t%H/B);return a?`${o}d${a}h`:`${o}d`}function et(e,t){const o=typeof e=="number"&&Number.isFinite(e)?Math.max(0,e):0,a=typeof t=="number"&&Number.isFinite(t)?t:null;return o<=0&&a===null?null:{banked:o,startedAt:a===null?null:a*1e3}}const ae="Time spent working in this conversation. Waiting between turns is not counted.",Fn="inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-meta",nt=p(Fn,"cursor-pointer text-ink-muted transition-colors duration-fast ease-out-quart","hover:bg-accent-wash hover:text-ink","focus-visible:outline-offset-1!"),re=p(Fn,"cursor-default text-ink-dim"),tt=1e3;function ot(e,t){const o=()=>t===null?e:e+Math.max(0,(Date.now()-t)/1e3),[a,s]=g.useState(o);return g.useEffect(()=>{if(t===null){s(e);return}const c=()=>s(e+Math.max(0,(Date.now()-t)/1e3));c();const d=window.setInterval(c,tt);return()=>window.clearInterval(d)},[e,t]),a}const T=({tooltip:e,label:t,onOpen:o,readout:a=!1,children:s,className:c})=>o?n.jsx(X,{content:e,children:n.jsx("button",{type:"button",onClick:o,"aria-label":t,className:p(nt,c),children:s})}):a?n.jsx(X,{content:e,children:n.jsx("span",{tabIndex:0,"aria-label":t,className:p(re,c),children:s})}):n.jsx(X,{content:e,children:n.jsx("button",{type:"button","aria-disabled":"true","aria-label":t,className:p(re,c),children:s})}),j=({lines:e,mono:t=!0})=>n.jsx("span",{className:"flex flex-col gap-0.5",children:e.map((o,a)=>n.jsx("span",{className:p(a===0?"text-ink":"text-ink-muted",t&&a===0&&e.length>1&&"font-mono text-mono-sm"),children:o},o))});function V(e,t){return t?e==="measured"?"Measured now; click for the full breakdown, which estimates your next request":e==="estimate"?"Estimated now; click for the full breakdown, which estimates your next request":"Click for the full breakdown":J}const J="Slash commands are off on this server, so this reading cannot be opened from here.";function ie(e,t){return t?"Click to choose a different model":e?"The first message will use it. Change it once the conversation starts.":J}function st(e,t,o){return t?e?En:o?"Change it.":J:null}const at="Nothing measured yet. The window fills as the conversation runs.",rt=["Context",at],it="Context: nothing measured yet. The window fills as the conversation runs.",En="Set once the conversation starts.",r=({frontend:e,onCommand:t,effortEntities:o,pendingModel:a=null,draft:s=!1,className:c})=>{if(!e)return null;const d=s?void 0:t,m=a!==null,y=On(e,a),v=y.identity,b=Mn(v),x=An(Rn(y.effort),o),f=Hn({context_tokens:e.context_tokens,context_window:e.context_window,context_is_estimate:e.context_is_estimate}),S=Jn(e,e.last_usage),k=et(e.active_duration_s,e.activity_started_at),W=ot((k==null?void 0:k.banked)??0,(k==null?void 0:k.startedAt)??null);return!b&&!x&&f.status==="no-reading"&&!S.text?null:n.jsxs("div",{className:p("-mx-1.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5","basis-full @min-[750px]/chatcol:order-2 @min-[750px]/chatcol:basis-auto @min-[750px]/chatcol:flex-nowrap",c),"data-lo-session-strip":!0,"data-lo-session-strip-draft":s?!0:void 0,children:[b&&n.jsxs(T,{label:m?`Model: ${b.selector}. Switching; waiting for the session to confirm it.`:`Model: ${b.selector}. ${ie(s,d)}`,tooltip:n.jsx(j,{lines:m?[b.selector,"Switching the model; waiting for the session to confirm it"]:[b.selector,ie(s,d)]}),onOpen:d?()=>d("/model"):void 0,className:p("min-w-14 max-w-full shrink",m&&"text-ink-dim"),children:[n.jsx("span",{className:"truncate",children:b.name}),m&&n.jsx(In,{size:"xs",label:"Switching the model"})]}),x&&(!s||x.levelKnown)&&n.jsx(T,{label:[`Reasoning effort: ${x.label}.`,st(s,x.adjustable,d)].filter(Boolean).join(" "),tooltip:n.jsx(j,{lines:[x.label,...s&&x.adjustable?[En]:[x.detail]]}),onOpen:d&&x.adjustable?()=>d("/effort"):void 0,children:n.jsx("span",{className:"font-mono text-mono-sm",children:x.label})}),n.jsxs(T,{label:s?it:f.status==="no-reading"?`Context: no reading yet. ${V("no-reading",!!d)}`:`Context: ${f.spelling}${f.status==="estimate"?", estimated":""}. ${V(f.status,!!d)}`,tooltip:n.jsx(j,{mono:f.status!=="no-reading",lines:s?rt:[...Kn(f,typeof(v==null?void 0:v.max_context_window)=="number"?v.max_context_window:null),V(f.status,!!d)]}),onOpen:d?()=>d("/context"):void 0,children:[n.jsx(Z,{reading:f}),f.spelling&&n.jsxs("span",{className:"font-mono text-mono-sm",children:[f.spelling,f.status==="estimate"&&n.jsx("span",{className:"ml-1 text-ink-dim",children:"estimate"})]})]}),S.text&&n.jsx(T,{label:se(S),tooltip:n.jsx(j,{lines:[S.text,se(S)]}),readout:!0,children:n.jsx("span",{className:"font-mono text-mono-sm",children:S.text})}),k&&n.jsx(T,{label:`Active time: ${K(W)}. ${ae}`,tooltip:n.jsx(j,{lines:[K(W),ae]}),readout:!0,className:"@min-[750px]/chatcol:@max-[860px]/chatcol:hidden",children:n.jsx("span",{className:"font-mono text-mono-sm tabular-nums",children:K(W)})})]})};try{r.displayName="SessionStatusStrip",r.__docgenInfo={description:"",displayName:"SessionStatusStrip",props:{frontend:{defaultValue:null,description:"The canonical snapshot. `null` while the stream is connecting, which\nrenders nothing — an empty strip is honest about a session that has not\nreported yet, where a strip full of dashes would be four claims.",name:"frontend",required:!0,type:{name:"CanonicalFrontendState"}},onCommand:{defaultValue:null,description:`Run a slash command exactly as typing it would. Absent on a surface with
no dispatcher (an older backend with commands disabled), which renders
every reading as a plain label rather than a control that cannot succeed.`,name:"onCommand",required:!1,type:{name:"(line: string) => void"}},effortEntities:{defaultValue:null,description:"The effort rungs `/effort` will accept, or `undefined` while unknown.\n\nPassed in rather than queried here so this component stays a pure\nprojection of state it is handed — the same reason it holds no optimistic\nlocal state. See `reconcileEffort` for why the picker's list wins over the\nstream's on adjustability, and why pending is not the same as empty.",name:"effortEntities",required:!1,type:{name:"readonly unknown[]"}},pendingModel:{defaultValue:{value:"null"},description:`A model the user just chose, not yet confirmed by the owner.

Passed in, not read off \`frontend\`: the paint is the session handle's, and
this component must not be the thing that decides what "confirmed" means
(the handle drops the paint when an authoritative frame names the model).
While it is set the model reading is drawn as PENDING — dim, with the
spinner the dialog shows for the same state, because a colour step plus a
hover-only tooltip is a cue the user has to have been taught (UX U3).`,name:"pendingModel",required:!1,type:{name:"CanonicalModel"}},draft:{defaultValue:{value:"false"},description:`Whether this is a NEW conversation's draft — a pane with no session yet.

TOLD, never inferred. \`onCommand === undefined\` already means a backend
whose command surface is off, and the two states need different sentences
for different reasons; one missing prop cannot carry two meanings (R22).

A draft renders the identity the FIRST turn will use — from the same
backend resolution a session gets (\`sessions.preview\`) — as three inert
readings: model, effort where the spec carries a ladder, and an empty
context ring. No spend: nothing has been sent, and both \`$0.00\` and \`$—\`
would be claims (R19).`,name:"draft",required:!1,type:{name:"boolean"}},className:{defaultValue:null,description:"",name:"className",required:!1,type:{name:"string"}}}}}catch{}const i=e=>({context_tokens:null,context_window:null,context_is_estimate:null,cumulative_parent_cost:null,child_costs:{},subagent_cost:null,subagent_cost_knowledge:null,cost_knowledge:"unknown",selected_model:null,effective_model:null,...e}),_={provider:"openrouter",model_id:"openai/gpt-4o-mini",display_name:"OpenAI: GPT-4o-mini",reasoning:!1,reasoning_effort:null,reasoning_efforts:[],reasoning_default_effort:null,context_window:128e3,max_context_window:null},u={provider:"openrouter",model_id:"openai/gpt-5",display_name:"OpenAI: GPT-5",reasoning:!0,reasoning_effort:"high",reasoning_efforts:["minimal","low","medium","high"],reasoning_default_effort:null,context_window:4e5,max_context_window:null},l=({children:e,width:t=720,label:o})=>n.jsxs("div",{className:"flex flex-col gap-2 bg-canvas p-6",style:{width:t+48},children:[o&&n.jsx("p",{className:"text-ink-dim text-meta",children:o}),n.jsxs("div",{className:"@container/chatcol flex flex-col gap-3 rounded-frame border border-control bg-surface p-4",style:{width:t},children:[e,n.jsx("p",{className:"text-ink-dim text-body",children:"Ask me for help"})]})]}),wt={title:"Chat/Session status strip",parameters:{layout:"fullscreen"}},N={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Populated: a measured reading on a reasoning model, spend known",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:13591,context_window:4e5,context_is_estimate:!1,cumulative_parent_cost:.003018,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"No reading yet: an empty track, and no number claimed",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:null,context_window:128e3}),onCommand:()=>{}})}),n.jsx(l,{label:"Estimate: the app's own count, not the provider's receipt",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:52400,context_window:128e3,context_is_estimate:!0,cumulative_parent_cost:.0412,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Window unknown: absolute tokens, an explicit denominator, no arc",children:n.jsx(r,{frontend:i({effective_model:{..._,context_window:null},context_tokens:24e4,context_window:null,cumulative_parent_cost:1.2456,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Noticing band: past 55% of the window, with headroom left",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:84e3,context_window:128e3,context_is_estimate:!1,cumulative_parent_cost:.318,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Saturated: over the window, compaction overdue, arc clamped",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:15e4,context_window:128e3,context_is_estimate:!1,cumulative_parent_cost:2.4,cost_knowledge:"exact"}),onCommand:()=>{}})})]})},C={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Before the pick: the model in force, nothing pending",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:12e3,context_window:4e5,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"The pick registers in the frame it is made: the chosen model, marked unconfirmed",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:12e3,context_window:4e5,cost_knowledge:"exact"}),pendingModel:_,onCommand:()=>{}})})]})},F={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Zero spend: no segment at all, never $0.0000",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:9400,context_window:128e3,cumulative_parent_cost:0,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Floor: a resumed session, or a subagent whose spend is partly unknown",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:12977,context_window:128e3,cumulative_parent_cost:2.1,subagent_cost_knowledge:"exact",cost_knowledge:"floor"}),onCommand:()=>{}})}),n.jsx(l,{label:"Unpriceable: tokens were billed on a model with no published price",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:12977,context_window:128e3,cumulative_parent_cost:null,cost_knowledge:"unknown",last_usage:{input_tokens:12977,output_tokens:2}}),onCommand:()=>{}})}),n.jsx(l,{label:"Under a cent: four decimals, per format_cost",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:12977,context_window:128e3,cumulative_parent_cost:.00194775,cost_knowledge:"exact"}),onCommand:()=>{}})})]})},E={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"A level is set: the ordinary case, and the chip opens /effort",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:13591,context_window:4e5,cumulative_parent_cost:.31,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"A ladder with nothing chosen: `auto`, the word /effort auto uses",children:n.jsx(r,{frontend:i({effective_model:{...u,reasoning_effort:null},context_tokens:13591,context_window:4e5,cumulative_parent_cost:.31,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Reasons with no ladder: `reasoning`, and no control to open",children:n.jsx(r,{frontend:i({effective_model:{...u,display_name:"DeepSeek Reasoner",model_id:"deepseek-reasoner",reasoning_effort:null,reasoning_efforts:[]},context_tokens:13591,context_window:128e3,cumulative_parent_cost:.31,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Non-reasoning model: no effort chip at all",children:n.jsx(r,{frontend:i({effective_model:_,context_tokens:13591,context_window:128e3,cumulative_parent_cost:.31,cost_knowledge:"exact"}),onCommand:()=>{}})})]})},I={render:()=>{const e={...u,display_name:"",model_id:"moonshotai/kimi-k2-instruct-0905-preview-long-context"};return n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Full width: the name fits, nothing truncates",children:n.jsx(r,{frontend:i({effective_model:e,context_tokens:21e4,context_window:4e5,cumulative_parent_cost:1.84,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{width:380,label:"Narrower: the name ellipsises, the three readings stay whole",children:n.jsx(r,{frontend:i({effective_model:e,context_tokens:21e4,context_window:4e5,cumulative_parent_cost:1.84,cost_knowledge:"exact"}),onCommand:()=>{}})})]})}},O={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{width:220,label:"220px column: the row wraps, every reading stays legible",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:21e4,context_window:4e5,context_is_estimate:!1,cumulative_parent_cost:1.84,cost_knowledge:"floor"}),onCommand:()=>{}})}),n.jsx(l,{width:220,label:"220px, long model name and an estimate",children:n.jsx(r,{frontend:i({effective_model:{...u,display_name:"",model_id:"moonshotai/kimi-k2-instruct-0905"},context_tokens:352e3,context_window:4e5,context_is_estimate:!0,cumulative_parent_cost:4.02,cost_knowledge:"exact"}),onCommand:()=>{}})})]})},M={render:()=>{const e=()=>{const t=g.useRef(null);return g.useEffect(()=>{var a,s;const o=(a=t.current)==null?void 0:a.querySelectorAll("button");(s=o==null?void 0:o[2])==null||s.focus()},[]),n.jsx("div",{ref:t,children:n.jsx(r,{frontend:i({effective_model:{...u,context_window:4e5,max_context_window:1e6},context_tokens:352e3,context_window:4e5,context_is_estimate:!0,cumulative_parent_cost:4.02,cost_knowledge:"exact"}),onCommand:()=>{}})})};return n.jsx("div",{className:"flex min-h-[320px] flex-col justify-end bg-canvas p-2",children:n.jsx(l,{label:"Context tooltip: percentage, tokens, window, model maximum, estimate",children:n.jsx(e,{})})})}},A={render:()=>{const e=()=>{const t=g.useRef(null);return g.useEffect(()=>{var s;const o=(s=t.current)==null?void 0:s.querySelectorAll("button"),a=o==null?void 0:o[((o==null?void 0:o.length)??1)-1];a==null||a.focus()},[]),n.jsx("div",{ref:t,children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:13591,context_window:4e5,cumulative_parent_cost:2.1,subagent_cost_knowledge:"exact",cost_knowledge:"floor"}),onCommand:()=>{}})})};return n.jsx("div",{className:"flex min-h-[320px] flex-col justify-end bg-canvas p-2",children:n.jsx(l,{label:"Cost tooltip: what the floor mark means",children:n.jsx(e,{})})})}},R={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Under both ladders: 150k on a 1M window is calm by either rule",children:n.jsx(r,{frontend:i({effective_model:{...u,context_window:1e6},context_tokens:15e4,context_window:1e6,context_is_estimate:!1,cumulative_parent_cost:.94,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Absolute 200k rung: warm at 20% of the window, which the fractional ladder alone would call calm",children:n.jsx(r,{frontend:i({effective_model:{...u,context_window:1e6},context_tokens:21e4,context_window:1e6,context_is_estimate:!1,cumulative_parent_cost:1.31,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Absolute 500k rung: the top rung at 51% of the window, on size alone",children:n.jsx(r,{frontend:i({effective_model:{...u,context_window:1e6},context_tokens:51e4,context_window:1e6,context_is_estimate:!1,cumulative_parent_cost:3.18,cost_knowledge:"exact"}),onCommand:()=>{}})})]})},$={render:()=>n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{label:"Cold snapshot, first-party: the listing name stands, effort unknown rather than absent",children:n.jsx(r,{frontend:i({effective_model:{provider:"anthropic",model_id:"claude-opus-5",display_name:"",reasoning:!1,reasoning_effort:null,reasoning_efforts:[],reasoning_default_effort:null,context_window:null,max_context_window:null},context_tokens:12405,context_window:2e5,cumulative_parent_cost:.0213,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Small but real: 3.4% draws a visible sweep, and the number stays unrounded",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:13591,context_window:4e5,context_is_estimate:!1,cumulative_parent_cost:.003018,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Aggregator route: the chip refuses the listing name, exactly as the TUI band does",children:n.jsx(r,{frontend:i({effective_model:{provider:"openrouter",model_id:"openai/gpt-5-mini",display_name:"OpenAI: GPT-5 Mini",reasoning:!0,reasoning_effort:"high",reasoning_efforts:["minimal","low","medium","high"],reasoning_default_effort:null,context_window:4e5,max_context_window:null},context_tokens:13591,context_window:4e5,cumulative_parent_cost:.0042,cost_knowledge:"exact"}),onCommand:()=>{}})}),n.jsx(l,{label:"Fixed-effort model: the SPEC says the ladder is empty, so the chip reports without offering",children:n.jsx(r,{frontend:i({effective_model:{...u,reasoning_effort:null,reasoning_efforts:[]},context_tokens:4e4,context_window:4e5,cumulative_parent_cost:.21,cost_knowledge:"exact"}),effortEntities:[],onCommand:()=>{}})})]})},P={render:()=>{const e=({frontend:t})=>{const o=g.useRef(null);return g.useEffect(()=>{var s,c;const a=(s=o.current)==null?void 0:s.querySelectorAll("button");(c=a==null?void 0:a[2])==null||c.focus()},[]),n.jsx("div",{ref:o,children:n.jsx(r,{frontend:t,onCommand:()=>{}})})};return n.jsx("div",{className:"flex min-h-[320px] flex-col justify-end bg-canvas p-2",children:n.jsx(l,{label:"No reading: the closing line does not claim a measurement that has not happened",children:n.jsx(e,{frontend:i({effective_model:u,context_tokens:null,context_window:4e5})})})})}},D={render:()=>{const e=u;return n.jsxs("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:[n.jsx(l,{width:900,label:"Draft at a wide column: model, effort, an empty context ring, no spend",children:n.jsx(r,{frontend:i({effective_model:e,context_tokens:null,context_window:4e5}),draft:!0})}),n.jsx(l,{width:220,label:"Draft at the 220px floor: the cluster wraps, nothing is dropped",children:n.jsx(r,{frontend:i({effective_model:e,context_tokens:null,context_window:4e5}),draft:!0})}),n.jsx(l,{width:900,label:"Draft on a spec with no ladder, which is what the preview always returns: no effort reading at all",children:n.jsx(r,{frontend:i({effective_model:{...u,reasoning_effort:null,reasoning_efforts:[]},context_tokens:null,context_window:4e5}),draft:!0})}),n.jsx(l,{width:900,label:"Draft with no resolved model: an empty cluster, never a row of dashes",children:n.jsx(r,{frontend:i({context_tokens:null,context_window:null}),draft:!0})})]})}},G={render:()=>{const e=()=>{const t=g.useRef(null);return g.useEffect(()=>{var a,s;const o=(a=t.current)==null?void 0:a.querySelectorAll("button");(s=o==null?void 0:o[0])==null||s.focus()},[]),n.jsx("div",{ref:t,children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:null,context_window:4e5}),draft:!0})})};return n.jsx("div",{className:"flex min-h-[320px] flex-col justify-end bg-canvas p-2",children:n.jsx(l,{width:900,label:"Draft model tooltip: the full selector, and a reason that is not an action",children:n.jsx(e,{})})})}},L={render:()=>n.jsx("div",{className:"flex flex-col gap-4 bg-canvas p-2",children:n.jsx(l,{width:900,label:"Commands off: every reading is a label, and says why it cannot open",children:n.jsx(r,{frontend:i({effective_model:u,context_tokens:13591,context_window:4e5,context_is_estimate:!1,cumulative_parent_cost:.003018,cost_knowledge:"exact"})})})})};var le,ce,de,ue,me;N.parameters={...N.parameters,docs:{...(le=N.parameters)==null?void 0:le.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="Populated: a measured reading on a reasoning model, spend known">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 13_591,
        context_window: 400_000,
        context_is_estimate: false,
        cumulative_parent_cost: 0.003018,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="No reading yet: an empty track, and no number claimed">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: null,
        context_window: 128_000
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Estimate: the app's own count, not the provider's receipt">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 52_400,
        context_window: 128_000,
        context_is_estimate: true,
        cumulative_parent_cost: 0.0412,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Window unknown: absolute tokens, an explicit denominator, no arc">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_4O_MINI,
          context_window: null
        },
        context_tokens: 240_000,
        context_window: null,
        cumulative_parent_cost: 1.2456,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Noticing band: past 55% of the window, with headroom left">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 84_000,
        context_window: 128_000,
        context_is_estimate: false,
        cumulative_parent_cost: 0.318,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Saturated: over the window, compaction overdue, arc clamped">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 150_000,
        context_window: 128_000,
        context_is_estimate: false,
        cumulative_parent_cost: 2.4,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(de=(ce=N.parameters)==null?void 0:ce.docs)==null?void 0:de.source},description:{story:"Every state that has something to say, stacked for one comparison.",...(me=(ue=N.parameters)==null?void 0:ue.docs)==null?void 0:me.description}}};var fe,he,_e,pe,xe;C.parameters={...C.parameters,docs:{...(fe=C.parameters)==null?void 0:fe.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="Before the pick: the model in force, nothing pending">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 12_000,
        context_window: 400_000,
        cost_knowledge: "exact"
      })} onCommand={() => {}} />
            </Frame>
            <Frame label="The pick registers in the frame it is made: the chosen model, marked unconfirmed">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 12_000,
        context_window: 400_000,
        cost_knowledge: "exact"
      })} pendingModel={GPT_4O_MINI} onCommand={() => {}} />
            </Frame>
        </div>
}`,...(_e=(he=C.parameters)==null?void 0:he.docs)==null?void 0:_e.source},description:{story:`The band while a model switch is UNCONFIRMED — the state U1 paints.

Two frames of the same strip, stacked, because the claim is a comparison: the
user picks a model and the band shows it IMMEDIATELY, drawn as pending rather
than as the model in force, and the moment the owner's own \`frontend.update\`
frame names it the paint is dropped and the reading goes back to full weight.

The pending value is a prop, so this story can reach a state the live app
reaches only during the 1.1-4.2 s a cold runtime bind costs. What it cannot
show is the RECONCILIATION: that is the session handle's effect, asserted in
\`scripts/picker-feedback.test.mjs\`, and this frame is what the user sees
before it runs.`,...(xe=(pe=C.parameters)==null?void 0:pe.docs)==null?void 0:xe.description}}};var we,ge,ve,be,ke;F.parameters={...F.parameters,docs:{...(we=F.parameters)==null?void 0:we.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="Zero spend: no segment at all, never $0.0000">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 9_400,
        context_window: 128_000,
        cumulative_parent_cost: 0,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Floor: a resumed session, or a subagent whose spend is partly unknown">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 12_977,
        context_window: 128_000,
        cumulative_parent_cost: 2.1,
        subagent_cost_knowledge: "exact",
        cost_knowledge: "floor"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Unpriceable: tokens were billed on a model with no published price">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 12_977,
        context_window: 128_000,
        cumulative_parent_cost: null,
        cost_knowledge: "unknown",
        last_usage: {
          input_tokens: 12_977,
          output_tokens: 2
        }
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Under a cent: four decimals, per format_cost">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 12_977,
        context_window: 128_000,
        cumulative_parent_cost: 0.00194775,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(ve=(ge=F.parameters)==null?void 0:ge.docs)==null?void 0:ve.source},description:{story:"The cost readout's four honesty states, side by side.",...(ke=(be=F.parameters)==null?void 0:be.docs)==null?void 0:ke.description}}};var Se,ye,Te,je,Ne;E.parameters={...E.parameters,docs:{...(Se=E.parameters)==null?void 0:Se.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="A level is set: the ordinary case, and the chip opens /effort">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 13_591,
        context_window: 400_000,
        cumulative_parent_cost: 0.31,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="A ladder with nothing chosen: \`auto\`, the word /effort auto uses">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          reasoning_effort: null
        },
        context_tokens: 13_591,
        context_window: 400_000,
        cumulative_parent_cost: 0.31,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Reasons with no ladder: \`reasoning\`, and no control to open">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          display_name: "DeepSeek Reasoner",
          model_id: "deepseek-reasoner",
          reasoning_effort: null,
          reasoning_efforts: []
        },
        context_tokens: 13_591,
        context_window: 128_000,
        cumulative_parent_cost: 0.31,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Non-reasoning model: no effort chip at all">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_4O_MINI,
        context_tokens: 13_591,
        context_window: 128_000,
        cumulative_parent_cost: 0.31,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(Te=(ye=E.parameters)==null?void 0:ye.docs)==null?void 0:Te.source},description:{story:"The effort chip's states, including the one with nothing to open.",...(Ne=(je=E.parameters)==null?void 0:je.docs)==null?void 0:Ne.description}}};var Ce,Fe,Ee,Ie,Oe;I.parameters={...I.parameters,docs:{...(Ce=I.parameters)==null?void 0:Ce.docs,source:{originalSource:`{
  render: () => {
    const long = {
      ...GPT_5,
      display_name: "",
      model_id: "moonshotai/kimi-k2-instruct-0905-preview-long-context"
    };
    return <div className="flex flex-col gap-4 bg-canvas p-2">
                <Frame label="Full width: the name fits, nothing truncates">
                    <SessionStatusStrip frontend={state({
          effective_model: long,
          context_tokens: 210_000,
          context_window: 400_000,
          cumulative_parent_cost: 1.84,
          cost_knowledge: "exact"
        })} onCommand={() => undefined} />
                </Frame>
                <Frame width={380} label="Narrower: the name ellipsises, the three readings stay whole">
                    <SessionStatusStrip frontend={state({
          effective_model: long,
          context_tokens: 210_000,
          context_window: 400_000,
          cumulative_parent_cost: 1.84,
          cost_knowledge: "exact"
        })} onCommand={() => undefined} />
                </Frame>
            </div>;
  }
}`,...(Ee=(Fe=I.parameters)==null?void 0:Fe.docs)==null?void 0:Ee.source},description:{story:`A model name long enough to overrun the row, at two widths.

An aggregator id with no curated name is the real source of these: the model
chip falls back to \`model_id\`, which is a full slug.`,...(Oe=(Ie=I.parameters)==null?void 0:Ie.docs)==null?void 0:Oe.description}}};var Me,Ae,Re,$e,Pe;O.parameters={...O.parameters,docs:{...(Me=O.parameters)==null?void 0:Me.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame width={220} label="220px column: the row wraps, every reading stays legible">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 210_000,
        context_window: 400_000,
        context_is_estimate: false,
        cumulative_parent_cost: 1.84,
        cost_knowledge: "floor"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame width={220} label="220px, long model name and an estimate">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          display_name: "",
          model_id: "moonshotai/kimi-k2-instruct-0905"
        },
        context_tokens: 352_000,
        context_window: 400_000,
        context_is_estimate: true,
        cumulative_parent_cost: 4.02,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(Re=(Ae=O.parameters)==null?void 0:Ae.docs)==null?void 0:Re.source},description:{story:`The 220px chat column — the floor the column collapses to with the canvas
panel open, and the width at which the composer's button row was already
over budget before this strip existed.`,...(Pe=($e=O.parameters)==null?void 0:$e.docs)==null?void 0:Pe.description}}};var De,Ge,Le,Ue,Be;M.parameters={...M.parameters,docs:{...(De=M.parameters)==null?void 0:De.docs,source:{originalSource:`{
  render: () => {
    const Focused = () => {
      const host = useRef<HTMLDivElement>(null);
      useEffect(() => {
        // The context reading is the third control in the row.
        const buttons = host.current?.querySelectorAll("button");
        (buttons?.[2] as HTMLButtonElement | undefined)?.focus();
      }, []);
      return <div ref={host}>
                    <SessionStatusStrip frontend={state({
          effective_model: {
            ...GPT_5,
            context_window: 400_000,
            max_context_window: 1_000_000
          },
          context_tokens: 352_000,
          context_window: 400_000,
          context_is_estimate: true,
          cumulative_parent_cost: 4.02,
          cost_knowledge: "exact"
        })} onCommand={() => undefined} />
                </div>;
    };
    return <div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
                <Frame label="Context tooltip: percentage, tokens, window, model maximum, estimate">
                    <Focused />
                </Frame>
            </div>;
  }
}`,...(Le=(Ge=M.parameters)==null?void 0:Ge.docs)==null?void 0:Le.source},description:{story:"The context tooltip, opened the way a keyboard user opens it.\n\nFocus rather than a forced open state, for the reason `Tooltip` gives for\nhaving no `defaultOpen`: photographing a forced state photographs something\nthe product does not do.",...(Be=(Ue=M.parameters)==null?void 0:Ue.docs)==null?void 0:Be.description}}};var qe,We,Xe,He,Ke;A.parameters={...A.parameters,docs:{...(qe=A.parameters)==null?void 0:qe.docs,source:{originalSource:`{
  render: () => {
    const Focused = () => {
      const host = useRef<HTMLDivElement>(null);
      useEffect(() => {
        const buttons = host.current?.querySelectorAll("button");
        // Model, effort, context, cost: the spend is the last one.
        const last = buttons?.[(buttons?.length ?? 1) - 1];
        (last as HTMLButtonElement | undefined)?.focus();
      }, []);
      return <div ref={host}>
                    <SessionStatusStrip frontend={state({
          effective_model: GPT_5,
          context_tokens: 13_591,
          context_window: 400_000,
          cumulative_parent_cost: 2.1,
          subagent_cost_knowledge: "exact",
          cost_knowledge: "floor"
        })} onCommand={() => undefined} />
                </div>;
    };
    return <div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
                <Frame label="Cost tooltip: what the floor mark means">
                    <Focused />
                </Frame>
            </div>;
  }
}`,...(Xe=(We=A.parameters)==null?void 0:We.docs)==null?void 0:Xe.source},description:{story:"The cost tooltip on a floor figure, where the mark needs explaining.",...(Ke=(He=A.parameters)==null?void 0:He.docs)==null?void 0:Ke.description}}};var Ve,ze,Ye,Ze,Qe;R.parameters={...R.parameters,docs:{...(Ve=R.parameters)==null?void 0:Ve.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="Under both ladders: 150k on a 1M window is calm by either rule">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          context_window: 1_000_000
        },
        context_tokens: 150_000,
        context_window: 1_000_000,
        context_is_estimate: false,
        cumulative_parent_cost: 0.94,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Absolute 200k rung: warm at 20% of the window, which the fractional ladder alone would call calm">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          context_window: 1_000_000
        },
        context_tokens: 210_000,
        context_window: 1_000_000,
        context_is_estimate: false,
        cumulative_parent_cost: 1.31,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Absolute 500k rung: the top rung at 51% of the window, on size alone">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          context_window: 1_000_000
        },
        context_tokens: 510_000,
        context_window: 1_000_000,
        context_is_estimate: false,
        cumulative_parent_cost: 3.18,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(Ye=(ze=R.parameters)==null?void 0:ze.docs)==null?void 0:Ye.source},description:{story:`The ABSOLUTE band rungs, which no other story draws.

The TUI added these precisely because the fractional ladder alone leaves a
big window looking calm at the size that costs the most: 300k tokens is slow
and expensive to re-send whether the window is 1M or 200k. On a 1M-token
model the fractional rungs are unreachable in practice, so these two frames
are the only picture of \`CONTEXT_COLOR_BANDS\` doing its job — and round 1
shipped without them (design round 1, D4).`,...(Qe=(Ze=R.parameters)==null?void 0:Ze.docs)==null?void 0:Qe.description}}};var Je,en,nn,tn,on;$.parameters={...$.parameters,docs:{...(Je=$.parameters)==null?void 0:Je.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame label="Cold snapshot, first-party: the listing name stands, effort unknown rather than absent">
                <SessionStatusStrip frontend={state({
        effective_model: {
          provider: "anthropic",
          model_id: "claude-opus-5",
          // Empty on a cold snapshot, so the chip falls back to the id
          // rather than inventing a name it cannot vouch for. The
          // \`model_catalogue\` this story used to pass is gone: nothing
          // on the desktop path ever publishes it (round 2, Q4/U9).
          display_name: "",
          reasoning: false,
          reasoning_effort: null,
          reasoning_efforts: [],
          reasoning_default_effort: null,
          context_window: null,
          max_context_window: null
        },
        context_tokens: 12_405,
        context_window: 200_000,
        cumulative_parent_cost: 0.0213,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Small but real: 3.4% draws a visible sweep, and the number stays unrounded">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 13_591,
        context_window: 400_000,
        context_is_estimate: false,
        cumulative_parent_cost: 0.003018,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Aggregator route: the chip refuses the listing name, exactly as the TUI band does">
                <SessionStatusStrip frontend={state({
        effective_model: {
          provider: "openrouter",
          model_id: "openai/gpt-5-mini",
          // The raw LISTING name. \`model_label\` refuses it for a
          // reseller, because 398 of ~400 names are shared between the
          // two shipped aggregators and none can say which route is
          // answering. The band prints \`gpt-5-mini\`; so does this
          // (round 2, Q3/R8/U9).
          display_name: "OpenAI: GPT-5 Mini",
          reasoning: true,
          reasoning_effort: "high",
          reasoning_efforts: ["minimal", "low", "medium", "high"],
          reasoning_default_effort: null,
          context_window: 400_000,
          max_context_window: null
        },
        context_tokens: 13_591,
        context_window: 400_000,
        cumulative_parent_cost: 0.0042,
        cost_knowledge: "exact"
      })} onCommand={() => undefined} />
            </Frame>
            <Frame label="Fixed-effort model: the SPEC says the ladder is empty, so the chip reports without offering">
                <SessionStatusStrip frontend={state({
        effective_model: {
          ...GPT_5,
          // A reasoning model whose spec carries NO rungs. This is the
          // only source entitled to make the control read-only: round 1
          // inferred it from an empty picker list instead, which is a
          // cold owner rather than a fixed one (round 2, U8).
          reasoning_effort: null,
          reasoning_efforts: []
        },
        context_tokens: 40_000,
        context_window: 400_000,
        cumulative_parent_cost: 0.21,
        cost_knowledge: "exact"
      })} effortEntities={[]} onCommand={() => undefined} />
            </Frame>
        </div>
}`,...(nn=(en=$.parameters)==null?void 0:en.docs)==null?void 0:nn.source},description:{story:`States where the strip must not claim more than it knows.

The cold-snapshot frame is the one round 1 got wrong (UX round 1, U1): after
a reload the owner answers with a selector and nothing else, and the strip
rendered that as a confident raw id with the effort chip silently absent. The
frame below is what it must look like instead — a catalogue-resolved name and
an effort reading that says it does not know yet.

The small-reading frame is the other half of D4: a 3.4% arc used to be four
coloured pixels and read as an empty ring, so \`MIN_DRAWN_FRACTION\` floors the
DRAWING while the number beside it stays exact.`,...(on=(tn=$.parameters)==null?void 0:tn.docs)==null?void 0:on.description}}};var sn,an,rn,ln,cn;P.parameters={...P.parameters,docs:{...(sn=P.parameters)==null?void 0:sn.docs,source:{originalSource:`{
  render: () => {
    const Focused: FC<{
      frontend: CanonicalFrontendState;
    }> = ({
      frontend
    }) => {
      const host = useRef<HTMLDivElement>(null);
      useEffect(() => {
        // The context reading is the third control in the row.
        const buttons = host.current?.querySelectorAll("button");
        (buttons?.[2] as HTMLButtonElement | undefined)?.focus();
      }, []);
      return <div ref={host}>
                    <SessionStatusStrip frontend={frontend} onCommand={() => undefined} />
                </div>;
    };
    /*
     * ONE tooltip per frame. Two \`Focused\` blocks in one story cannot both
     * show their tooltip - focus is singular, so the second steals it and the
     * first frame photographs an empty state, which is exactly the kind of
     * absence that looks like evidence and is not.
     */
    return <div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
                <Frame label="No reading: the closing line does not claim a measurement that has not happened">
                    <Focused frontend={state({
          effective_model: GPT_5,
          context_tokens: null,
          context_window: 400_000
        })} />
                </Frame>
            </div>;
  }
}`,...(rn=(an=P.parameters)==null?void 0:an.docs)==null?void 0:rn.source},description:{story:`The closing line of the context tooltip, in the two states that measured
nothing.

Round 1 appended "Measured now; …" to every context tooltip, so the
no-reading tooltip said there was no reading and then that it was measured
now, and the estimate tooltip labelled its number an estimate and called it a
measurement one line later (round 2, D8). The estimate case is visible in
\`ContextTooltip\` above; this frame is the other one, beside a measured
reading for comparison.`,...(cn=(ln=P.parameters)==null?void 0:ln.docs)==null?void 0:cn.description}}};var dn,un,mn,fn,hn;D.parameters={...D.parameters,docs:{...(dn=D.parameters)==null?void 0:dn.docs,source:{originalSource:`{
  render: () => {
    const model = GPT_5;
    return <div className="flex flex-col gap-4 bg-canvas p-2">
                <Frame width={900} label="Draft at a wide column: model, effort, an empty context ring, no spend">
                    <SessionStatusStrip frontend={state({
          effective_model: model,
          context_tokens: null,
          context_window: 400_000
        })} draft={true} />
                </Frame>
                <Frame width={220} label="Draft at the 220px floor: the cluster wraps, nothing is dropped">
                    <SessionStatusStrip frontend={state({
          effective_model: model,
          context_tokens: null,
          context_window: 400_000
        })} draft={true} />
                </Frame>
                <Frame width={900} label="Draft on a spec with no ladder, which is what the preview always returns: no effort reading at all">
                    <SessionStatusStrip frontend={state({
          effective_model: {
            ...GPT_5,
            reasoning_effort: null,
            reasoning_efforts: []
          },
          context_tokens: null,
          context_window: 400_000
        })} draft={true} />
                </Frame>
                <Frame width={900} label="Draft with no resolved model: an empty cluster, never a row of dashes">
                    <SessionStatusStrip frontend={state({
          context_tokens: null,
          context_window: null
        })} draft={true} />
                </Frame>
            </div>;
  }
}`,...(mn=(un=D.parameters)==null?void 0:un.docs)==null?void 0:mn.source},description:{story:`A NEW conversation's draft: the readings for a first turn that has not
happened yet.

The state a live harness cannot reach on this tree, which is why it is here.
A draft pane has no session, so the strip's payload comes from
\`POST /v1/desktop/sessions/preview\` rather than from the canonical stream —
the same backend resolution the session will get, so the identity on screen
is the identity that will answer. Stories supply the payload directly, so
these frames judge the RENDERING rules (R18-R23), not the resolution, which
the live frames and the wire test own.

What to look for:

- Three readings at most, never four: no cost chip, because nothing has been
  spent and both \`$0.00\` and \`$—\` are claims about a session that does not
  exist; and no effort reading where the spec carries no ladder, which is the
  shape the preview route returns because it skips the account-metadata step
  a cold open runs. The word that would otherwise sit there is \`unknown\` - a
  value a session only shows while it has an owner - and the first turn would
  replace it with \`auto\`, moving the readings beside it (UX round 1, U1).
- All three inert: \`ink-dim\`, no hover step, \`aria-disabled\`, and still
  focusable so the explanation stays reachable from the keyboard (§ 6).
- An EMPTY ring beside the word "Context" — no number and no percentage,
  because nothing has been counted.
- The cluster in the same place and order as a populated session's, so the
  first receipt moves nothing: the cost chip appears after the context
  reading and the other three stay where they are (R23).`,...(hn=(fn=D.parameters)==null?void 0:fn.docs)==null?void 0:hn.description}}};var _n,pn,xn,wn,gn;G.parameters={...G.parameters,docs:{...(_n=G.parameters)==null?void 0:_n.docs,source:{originalSource:`{
  render: () => {
    const Focused = () => {
      const host = useRef<HTMLDivElement>(null);
      useEffect(() => {
        // The model reading is the first control in the cluster.
        const buttons = host.current?.querySelectorAll("button");
        (buttons?.[0] as HTMLButtonElement | undefined)?.focus();
      }, []);
      return <div ref={host}>
                    <SessionStatusStrip frontend={state({
          effective_model: GPT_5,
          context_tokens: null,
          context_window: 400_000
        })} draft={true} />
                </div>;
    };
    return <div className="flex min-h-[320px] flex-col justify-end bg-canvas p-2">
                <Frame width={900} label="Draft model tooltip: the full selector, and a reason that is not an action">
                    <Focused />
                </Frame>
            </div>;
  }
}`,...(xn=(pn=G.parameters)==null?void 0:pn.docs)==null?void 0:xn.source},description:{story:`The draft's model tooltip, opened the way a keyboard user opens it.

D3 and R21: the label form's closing line used to be the constant "Click to
choose a different model", which a draft cannot do — there is no session for
\`/model\` to address. The sentence now states the fact and the reason
instead, and this is the frame that shows which sentence a draft gets.`,...(gn=(wn=G.parameters)==null?void 0:wn.docs)==null?void 0:gn.description}}};var vn,bn,kn,Sn,yn;L.parameters={...L.parameters,docs:{...(vn=L.parameters)==null?void 0:vn.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 bg-canvas p-2">
            <Frame width={900} label="Commands off: every reading is a label, and says why it cannot open">
                <SessionStatusStrip frontend={state({
        effective_model: GPT_5,
        context_tokens: 13_591,
        context_window: 400_000,
        context_is_estimate: false,
        cumulative_parent_cost: 0.003018,
        cost_knowledge: "exact"
      })} />
            </Frame>
        </div>
}`,...(kn=(bn=L.parameters)==null?void 0:bn.docs)==null?void 0:kn.source},description:{story:`A live session whose backend has commands OFF.

The other way a reading can have nothing to open, and the one that made D3 a
defect rather than a nit: \`onCommand === undefined\` on a SESSION means there
is no dispatcher, and the chip used to keep advertising one. It is a story
because it needs a backend without the command surface, which is not the one
these frames are taken against.`,...(yn=(Sn=L.parameters)==null?void 0:Sn.docs)==null?void 0:yn.description}}};const gt=["States","ModelSwitchPending","CostStates","EffortStates","LongModelName","CollapsedColumn","ContextTooltip","CostTooltip","AbsoluteRungs","HonestUnknowns","TooltipHonesty","Draft","DraftTooltip","CommandsOff"];export{R as AbsoluteRungs,O as CollapsedColumn,L as CommandsOff,M as ContextTooltip,F as CostStates,A as CostTooltip,D as Draft,G as DraftTooltip,E as EffortStates,$ as HonestUnknowns,I as LongModelName,C as ModelSwitchPending,N as States,P as TooltipHonesty,gt as __namedExportsOrder,wt as default};
