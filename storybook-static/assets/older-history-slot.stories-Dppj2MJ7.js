import{j as e}from"./jsx-runtime-6qgwzs7k.js";import{r as K}from"./index-DQDNmYQF.js";/* empty css              */import{O as w,C as P}from"./canonical-transcript-CuGtzwri.js";import"./desktop-api-CaQEbvIp.js";import"./canonical-sessions-store-DXL5LYN7.js";import"./middleware-BA0ma3y9.js";import"./tooltip-BdVa6PqK.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";import"./markdown-renderer-BWJDRHtD.js";import"./iframe-e1Jh8KqV.js";import"./base-dialog-CrmyWXii.js";import"./tabs-D6HlMULL.js";import"./textarea-DG-lIhp0.js";import"./ui-preferences-store-C41aoBWQ.js";import"./createTheme-BajzA9aJ.js";import"./rotate-ccw-CvPrqEDK.js";import"./download-BepMeEVw.js";import"./copy-uVtzsRLQ.js";import"./index-EJ-yq0BT.js";import"./index-B4G4emKD.js";import"./index-84k9TH_T.js";import"./index-D3YqUQwT.js";import"./image-attachment-D93Z9Ls2.js";import"./index-CPD9vZQH.js";import"./index-CnYGlD5c.js";import"./tool-row-model-Cw4Weno9.js";import"./code-xml-i5f_NYNZ.js";import"./pencil-CUWtmVYN.js";import"./is-canvas-supported-CMB23l-O.js";import"./toast-manager-DKnI1kug.js";import"./index-DdWVCD6p.js";import"./ellipsis-BovkwUJa.js";import"./load-language-extensions-CvIC2txr.js";import"./message-timestamp-YUWbwoJA.js";import"./bot-C9UUcjQw.js";import"./date-utils-D4-mGN3N.js";import"./format-DKJucjip.js";import"./en-US-Dx4UrcLc.js";import"./send-DNha2_gr.js";import"./users-B9ScUM_F.js";import"./tag-DSAqN5BT.js";import"./clock-B_VENYd6.js";import"./search-Cf6fTIbH.js";import"./file-text-B4-jMc9p.js";import"./use-media-query-TAtaIvow.js";import"./wrench-BZ4vI0L3.js";import"./circle-slash-Bp7wvHah.js";import"./spinner-B2SkZRIb.js";import"./transcript-reducer-DeWRerWc.js";const Ke={title:"Chat/Older history slot",component:w,parameters:{layout:"fullscreen"}},h=[{state:"idle",caption:"idle, more history on the backend"},{state:"loading",caption:"a durable page is in flight"},{state:"failed",caption:"the page failed; the action still works"},{state:"windowed",caption:"rows held back by the render window only"},{state:"exhausted",caption:"every row this conversation has"}],r=({state:t,caption:a,width:s="32rem",transportDown:c=!1})=>e.jsxs("div",{className:"flex items-start gap-4",children:[e.jsx("span",{className:"w-64 shrink-0 pt-1 text-ink-muted text-meta",children:a}),e.jsx("div",{className:"border-hairline border-y",style:{width:s},children:e.jsx(w,{state:t,hiddenRows:137,transportDown:c,onLoadOlder:()=>{}})})]}),n={render:()=>e.jsx("div",{className:"flex flex-col gap-6 bg-canvas p-8",children:h.map(({state:t,caption:a})=>e.jsx(r,{state:t,caption:a},t))})},o={render:()=>e.jsxs("div",{className:"flex flex-col gap-6 bg-canvas p-8",children:[e.jsx("p",{className:"max-w-[46rem] text-ink-muted text-meta",children:"Rendered at 252px, the transcript's content box at the app's 800px minimum window. Every state must keep its lower rule on the same baseline as the others."}),h.map(({state:t,caption:a})=>e.jsx(r,{state:t,caption:a,width:"252px"},t)),e.jsx("p",{className:"max-w-[46rem] pt-2 text-ink-muted text-meta",children:"And at 220px, the chat column's own floor."}),h.filter(t=>t.state==="failed"||t.state==="loading").map(({state:t,caption:a})=>e.jsx(r,{state:t,caption:a,width:"220px"},`narrow-${t}`))]})},i={render:()=>e.jsxs("div",{className:"flex flex-col gap-6 bg-canvas p-8",children:[e.jsx("p",{className:"max-w-[46rem] text-ink-muted text-meta",children:"`failed` in both rows. Only the second offers a retry, because only the second describes something a retry could fix."}),e.jsx(r,{state:"failed",caption:"failed, transport down",transportDown:!0}),e.jsx(r,{state:"failed",caption:"failed, transport up"}),e.jsx(r,{state:"windowed",caption:"windowed, transport down",transportDown:!0}),e.jsx(r,{state:"windowed",caption:"windowed, transport up"}),e.jsx("p",{className:"max-w-[46rem] pt-2 text-ink-muted text-meta",children:"The same four at the 220px chat-column floor, where the short spellings take over."}),e.jsx(r,{state:"failed",caption:"failed, transport down",width:"220px",transportDown:!0}),e.jsx(r,{state:"failed",caption:"failed, transport up",width:"220px"}),e.jsx(r,{state:"windowed",caption:"windowed, transport down",width:"220px",transportDown:!0}),e.jsx(r,{state:"windowed",caption:"windowed, transport up",width:"220px"})]})},d={render:()=>e.jsxs("div",{className:"flex flex-col gap-6 bg-canvas p-8",children:[e.jsx(r,{state:"windowed",caption:"one row, singular copy"}),e.jsxs("div",{className:"flex items-start gap-4",children:[e.jsx("span",{className:"w-64 shrink-0 pt-1 text-ink-muted text-meta",children:"rendered with hiddenRows=1"}),e.jsx("div",{className:"w-[32rem] border-hairline border-y",children:e.jsx(w,{state:"windowed",hiddenRows:1,onLoadOlder:()=>{}})})]})]})},m=(t,a)=>({kind:"assistant",id:t,ts:176e10,text:a,streaming:!1,complete:!0,stopReason:null,error:!1}),Q=(t,a)=>{var s;return{records:t,index:new Map(t.map((c,J)=>[c.id,J])),hasMore:a,oldestId:((s=t[0])==null?void 0:s.id)??null}},G=({hasMore:t,loadingOlder:a})=>{const s=K.useRef(null);return e.jsx("div",{className:"flex h-[520px] flex-col bg-canvas",ref:s,children:e.jsx(P,{transcript:Q([m("a1","The oldest rendered row sits directly below."),m("a2","A slot that changed height would move this row, and every row after it, at the exact moment the reader is looking at the top of the conversation."),m("a3","The newest row.")],t),gate:null,waiting:!1,loadingOlder:a,onLoadOlder:async()=>!0,containerRef:s,isSmallView:!1,status:"live",error:null})})},p={render:()=>e.jsx(G,{hasMore:!0,loadingOlder:!1})},l={render:()=>e.jsx(G,{hasMore:!0,loadingOlder:!0})};var x,u,f,g,v;n.parameters={...n.parameters,docs:{...(x=n.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-6 bg-canvas p-8">
            {STATES.map(({
      state,
      caption
    }) => <Ruled key={state} state={state} caption={caption} />)}
        </div>
}`,...(f=(u=n.parameters)==null?void 0:u.docs)==null?void 0:f.source},description:{story:`The fixed-height claim, falsifiable at a glance: five states between two
rules. Any state that is taller than the others pushes its lower rule down.`,...(v=(g=n.parameters)==null?void 0:g.docs)==null?void 0:v.description}}};var y,b,j,T,k;o.parameters={...o.parameters,docs:{...(y=o.parameters)==null?void 0:y.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-6 bg-canvas p-8">
            <p className="max-w-[46rem] text-ink-muted text-meta">
                Rendered at 252px, the transcript's content box at the app's 800px
                minimum window. Every state must keep its lower rule on the same
                baseline as the others.
            </p>
            {STATES.map(({
      state,
      caption
    }) => <Ruled key={state} state={state} caption={caption} width="252px" />)}
            <p className="max-w-[46rem] pt-2 text-ink-muted text-meta">
                And at 220px, the chat column's own floor.
            </p>
            {STATES.filter(entry => entry.state === "failed" || entry.state === "loading").map(({
      state,
      caption
    }) => <Ruled key={\`narrow-\${state}\`} state={state} caption={caption} width="220px" />)}
        </div>
}`,...(j=(b=o.parameters)==null?void 0:b.docs)==null?void 0:j.source},description:{story:`The same five states at the app's OWN minimum content width.

This board exists because \`EveryState\` renders at a single 32rem column, and
that is why a wrapping failure state shipped: the failure copy has an
intrinsic width of ~258px, so it fit at 512px and wrapped to two lines at
252px, measuring 34.78px inside a 28px box and crossing the row's own bottom
rule.

252px is not a hypothetical. It is what the transcript's content box measures
at the window's 800px minimum: 800 minus the 220px app rail, minus the chat
list pane's 280px default, minus the transcript's \`p-4\` (32px) and the 16px
its \`scrollbar-gutter: stable both-edges\` reserves. The chat column itself
floors lower still (220px), and opening the canvas panel reaches these widths
at any window size — so this is a width the app routinely has, not an edge.

A reviewer should be able to SEE the invariant hold at the narrow measure
rather than derive it from three constants, which is the difference between
evidence and an assertion.`,...(k=(T=o.parameters)==null?void 0:T.docs)==null?void 0:k.description}}};var N,R,S,O,E;i.parameters={...i.parameters,docs:{...(N=i.parameters)==null?void 0:N.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-6 bg-canvas p-8">
            <p className="max-w-[46rem] text-ink-muted text-meta">
                \`failed\` in both rows. Only the second offers a retry, because only the
                second describes something a retry could fix.
            </p>
            <Ruled state="failed" caption="failed, transport down" transportDown />
            <Ruled state="failed" caption="failed, transport up" />
            <Ruled state="windowed" caption="windowed, transport down" transportDown />
            <Ruled state="windowed" caption="windowed, transport up" />
            <p className="max-w-[46rem] pt-2 text-ink-muted text-meta">
                The same four at the 220px chat-column floor, where the short spellings
                take over.
            </p>
            <Ruled state="failed" caption="failed, transport down" width="220px" transportDown />
            <Ruled state="failed" caption="failed, transport up" width="220px" />
            <Ruled state="windowed" caption="windowed, transport down" width="220px" transportDown />
            <Ruled state="windowed" caption="windowed, transport up" width="220px" />
        </div>
}`,...(S=(R=i.parameters)==null?void 0:R.docs)==null?void 0:S.source},description:{story:`What the slot says while the transport is down, beside what it says when the
transport is up and the fetch genuinely failed.

The claim: a failure the reader cannot answer is not painted as one. The
transcript below the slot is already saying "Reconnecting" (or carrying a
session error) in those rows, so a red fault with a \`Try again\` above it
would be two claims about one event with the action attached to the symptom.
These two rows are the comparison that shows the branch works — same state,
same width, different transport, and only one of them is red or actionable.`,...(E=(O=i.parameters)==null?void 0:O.docs)==null?void 0:E.description}}};var A,I,D,M,L;d.parameters={...d.parameters,docs:{...(A=d.parameters)==null?void 0:A.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-6 bg-canvas p-8">
            <Ruled state="windowed" caption="one row, singular copy" />
            <div className="flex items-start gap-4">
                <span className="w-64 shrink-0 pt-1 text-ink-muted text-meta">
                    rendered with hiddenRows=1
                </span>
                <div className="w-[32rem] border-hairline border-y">
                    <OlderHistorySlot state="windowed" hiddenRows={1} onLoadOlder={() => undefined} />
                </div>
            </div>
        </div>
}`,...(D=(I=d.parameters)==null?void 0:I.docs)==null?void 0:D.source},description:{story:"The singular, which is its own copy branch and its own chance to be wrong.",...(L=(M=d.parameters)==null?void 0:M.docs)==null?void 0:L.description}}};var C,H,W,_,$;p.parameters={...p.parameters,docs:{...(C=p.parameters)==null?void 0:C.docs,source:{originalSource:`{
  render: () => <InTranscript hasMore loadingOlder={false} />
}`,...(W=(H=p.parameters)==null?void 0:H.docs)==null?void 0:W.source},description:{story:"The affordance above real rows, in the real column measure.",...($=(_=p.parameters)==null?void 0:_.docs)==null?void 0:$.description}}};var z,V,q,B,F;l.parameters={...l.parameters,docs:{...(z=l.parameters)==null?void 0:z.docs,source:{originalSource:`{
  render: () => <InTranscript hasMore loadingOlder />
}`,...(q=(V=l.parameters)==null?void 0:V.docs)==null?void 0:q.source},description:{story:`The same frame mid-load. Compared against the one above, the first row below
the slot must not have moved.`,...(F=(B=l.parameters)==null?void 0:B.docs)==null?void 0:F.description}}};const Pe=["EveryState","AppMinimumWidth","TransportDown","OneHiddenRow","InTranscriptIdle","InTranscriptLoading"];export{o as AppMinimumWidth,n as EveryState,p as InTranscriptIdle,l as InTranscriptLoading,d as OneHiddenRow,i as TransportDown,Pe as __namedExportsOrder,Ke as default};
