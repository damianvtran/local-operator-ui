import{j as e}from"./jsx-runtime-6qgwzs7k.js";/* empty css              */import"./tabs-D6HlMULL.js";import{S as h}from"./tooltip-BdVa6PqK.js";import"./textarea-DG-lIhp0.js";import"./index-DQDNmYQF.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";const x=({children:u})=>e.jsx("div",{className:"flex h-[280px] w-full flex-col items-center justify-center bg-canvas px-4 pb-4 pt-2",children:e.jsxs("div",{className:"flex w-full flex-col items-center justify-center gap-6 p-4",children:[u,e.jsx("div",{className:"h-24 w-full max-w-[900px] rounded-md border border-subtle bg-surface"})]})}),v={title:"Chat/Hydration placeholder",parameters:{layout:"fullscreen"}},t={render:()=>e.jsx(x,{children:e.jsx("h2",{className:"text-center text-ink text-title",children:"What can I help you with today?"})})},a={render:()=>e.jsx(x,{children:e.jsxs("output",{className:"flex w-full flex-col items-center gap-3","aria-label":"Loading conversation",children:[e.jsx(h,{className:"h-7 w-64"}),e.jsx("span",{className:"sr-only",children:"Loading conversation…"})]})})};var r,s,o,n,l;t.parameters={...t.parameters,docs:{...(r=t.parameters)==null?void 0:r.docs,source:{originalSource:`{
  render: () => <Slot>
            <h2 className="text-center text-ink text-title">
                What can I help you with today?
            </h2>
        </Slot>
}`,...(o=(s=t.parameters)==null?void 0:s.docs)==null?void 0:o.source},description:{story:"Settled and empty: the app may state the greeting.",...(l=(n=t.parameters)==null?void 0:n.docs)==null?void 0:l.description}}};var c,i,d,p,m;a.parameters={...a.parameters,docs:{...(c=a.parameters)==null?void 0:c.docs,source:{originalSource:`{
  render: () => <Slot>
            <output className="flex w-full flex-col items-center gap-3" aria-label="Loading conversation">
                <Skeleton className="h-7 w-64" />
                <span className="sr-only">Loading conversation…</span>
            </output>
        </Slot>
}`,...(d=(i=a.parameters)==null?void 0:i.docs)==null?void 0:d.source},description:{story:"Hydrating: the same slot, holding a placeholder instead of a claim.",...(m=(p=a.parameters)==null?void 0:p.docs)==null?void 0:m.description}}};const k=["SettledEmpty","Hydrating"];export{a as Hydrating,t as SettledEmpty,k as __namedExportsOrder,v as default};
