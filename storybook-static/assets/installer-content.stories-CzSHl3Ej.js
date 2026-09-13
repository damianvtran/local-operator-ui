import{j as e}from"./jsx-runtime-6qgwzs7k.js";/* empty css              */import{a as h,c as m,B as b}from"./tooltip-BdVa6PqK.js";import{r as u}from"./index-DQDNmYQF.js";import{C as v}from"./code-CwUj9nVF.js";import{H as k}from"./hard-drive-CrkWhlKq.js";import{W as _}from"./wrench-BZ4vI0L3.js";import{S as j}from"./spinner-B2SkZRIb.js";import"./tabs-D6HlMULL.js";import"./textarea-DG-lIhp0.js";import{l as N}from"./icon-CIX_sk7_.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";/**
 * @license lucide-react v0.507.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I=[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]],T=h("handshake",I);/**
 * @license lucide-react v0.507.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]],A=h("shield-check",C);/**
 * @license lucide-react v0.507.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const S=[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]],z=h("target",S),r=[{icon:z,title:"Breaks work into steps",description:"Give it a goal in a sentence. It works out the steps and does them in order."},{icon:v,title:"Writes and runs code",description:"Code is how it reads a spreadsheet, calls an API or renames a folder — written for the job in front of it."},{icon:k,title:"Works on your files",description:"Your documents stay on this computer. No uploading a folder to get an answer about it."},{icon:A,title:"Checks before it acts",description:"A second model reviews anything risky, and you confirm the rest."},{icon:_,title:"Recovers from errors",description:"When something fails it reads the error and tries another way, rather than stopping and asking you."},{icon:T,title:"Agents hand work to each other",description:"A researcher can pass what it found to a writer, without you carrying it across."}],F=5e3,o=()=>{const[t,d]=u.useState(0);return u.useEffect(()=>{const n=setInterval(()=>{d(a=>(a+1)%r.length)},F);return()=>clearInterval(n)},[]),e.jsxs("div",{className:"flex w-full flex-col items-center",children:[e.jsx("div",{className:"relative flex h-44 w-full items-center justify-center",children:r.map((n,a)=>{const p=a===t;return e.jsxs("div",{"aria-hidden":!p,className:m("absolute flex max-w-120 flex-col items-center text-center","transition-opacity duration-slow ease-out-quart",p?"opacity-100":"pointer-events-none opacity-0"),children:[e.jsx(n.icon,{size:32,className:"mb-5 text-accent","aria-hidden":"true"}),e.jsx("h2",{className:"mb-2 text-heading text-ink",children:n.title}),e.jsx("p",{className:"max-w-100 text-body text-ink-muted",children:n.description})]},n.title)})}),e.jsx("div",{className:"mt-6 flex justify-center gap-2",children:r.map((n,a)=>e.jsx("button",{type:"button","aria-label":n.title,"aria-current":a===t,onClick:()=>d(a),className:m("size-2 rounded-full transition-colors duration-base ease-out-quart",a===t?"bg-accent":"bg-control")},`dot-${n.title}`))})]})};try{o.displayName="FeatureCarousel",o.__docgenInfo={description:`FeatureCarousel component

Rotates through the product's capabilities while the install runs.

All six panes are stacked and cross-faded rather than mounted one at a time,
so the block never changes height as the copy length changes. The inactive
ones are hidden from assistive technology and from the pointer, which is the
part a plain \`opacity: 0\` gets wrong.`,displayName:"FeatureCarousel",props:{}}}catch{}const i=()=>{const t=()=>{window.api.ipcRenderer.send("cancel-installation")};return e.jsxs("div",{className:"flex w-full max-w-110 flex-col items-center text-center",children:[e.jsx("h2",{className:"text-title text-ink",children:"Setting up your environment"}),e.jsx("p",{className:"mt-2 text-body text-ink-muted",children:"A one-time install of Python and the AI dependencies your assistants need, all kept on this computer."}),e.jsxs("div",{className:"mt-8 flex flex-col items-center gap-3",children:[e.jsx(j,{size:"lg",label:"Installing dependencies"}),e.jsx("p",{className:"text-body-sm text-ink-muted",children:"This takes a few minutes. You can minimize this window and keep working — you will get a notification when it is done."})]}),e.jsx(b,{variant:"secondary",className:"mt-8",onClick:t,children:"Cancel setup"})]})};try{i.displayName="InstallationProgress",i.__docgenInfo={description:`InstallationProgress component

The right half of the installer: what is happening, how long it takes, and
the one way out. There is no progress bar because the backend reports no
progress — a bar that cannot move is a lie, so the spinner carries the
"still working" signal and the copy carries the expectation.

## Rhythm

Three groups, not five evenly spaced paragraphs. What is happening and why
sit together at 8px; the live status is its own block; the way out is 32px
away from everything, because a destructive-adjacent control that shares
spacing with body copy is a control you can hit by accident. Even 24px gaps
between all five was the thing that made this screen read as a list.

## Heading level

\`text-title\`, not \`text-display\`. The left half's "Local Operator" is the
page's one display-sized line; two 28px headings side by side in a split
window read as two competing screens rather than as a product and its
status.`,displayName:"InstallationProgress",props:{}}}catch{}const c=()=>e.jsxs(e.Fragment,{children:[e.jsx("img",{src:N,alt:"","aria-hidden":"true",className:"mb-5 size-16 rounded-lg object-contain"}),e.jsx("h1",{className:"text-center text-display text-ink",children:"Local Operator"}),e.jsx("p",{className:"mt-2 mb-8 text-center text-body text-ink-muted",children:"Personal AI assistants that turn ideas into action"})]});try{c.displayName="LogoSection",c.__docgenInfo={description:`LogoSection component

The product mark and its one-line promise, above the feature carousel.

## Why the mark changed asset

This used to render \`clear-icon-with-text.png\`, which is a white-only glyph
on transparency: invisible on all six light themes, and despite its name it
carries no wordmark at all. It also has roughly 2000px of empty canvas
around a small figure, so at \`h-30\` the visible glyph was a fraction of the
space it reserved — which is where the dead air between the mark and the
heading came from.

\`icon.png\` is the app's own icon: a dark figure on its own light disc, so it
reads on every ground the way it reads in Finder or the taskbar. Showing the
application icon is also what an installer is expected to show, and it is
the one image on this screen that is the same in all twelve themes because
it brings its own background.`,displayName:"LogoSection",props:{}}}catch{}const l=()=>e.jsxs("div",{className:"flex size-full flex-col lg:flex-row",children:[e.jsxs("section",{className:"flex flex-1 flex-col items-center justify-center overflow-hidden border-hairline border-b bg-surface px-6 py-8 lg:border-r lg:border-b-0 lg:p-12",children:[e.jsx(c,{}),e.jsx(o,{})]}),e.jsx("section",{className:"flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-8 lg:p-12",children:e.jsx(i,{})})]});try{l.displayName="InstallerContent",l.__docgenInfo={description:"InstallerContent component\n\nThe installer window: what the product is on the left, what is happening on\nthe right. The two halves are told apart by their ground — `surface` against\n`canvas` — with a single hairline where they meet. The window is wide, so\nthe split stacks below `lg` and the hairline moves with it.",displayName:"InstallerContent",props:{}}}catch{}const Y={title:"Installer/InstallerContent",parameters:{layout:"fullscreen",viewport:{defaultViewport:"custom",viewports:{custom:{name:"Installer Window",styles:{width:"1380px",height:"800px"}}}},docs:{description:{component:`The installer window: the product on the left, the install on the right.

It renders inside its own html entry, so the story reproduces that entry's
wrapper rather than the app shell.

The window itself only ever renders one palette: \`installer.tsx\` calls
\`applyThemeToDocument(DEFAULT_THEME)\` and nothing there reads a stored
preference, so eleven of the twelve frames below show a theme this window
cannot produce. They are kept because the panel's own contrast should hold
on any ground it is ever pointed at, but the one that matches the product
is \`localOperatorDark\` - which is also why the main process paints
\`#16130e\` behind it.`}}},render:()=>e.jsx("div",{className:"flex h-screen w-screen overflow-hidden font-sans",children:e.jsx(l,{})})},s={};var g,y,w,f,x;s.parameters={...s.parameters,docs:{...(g=s.parameters)==null?void 0:g.docs,source:{originalSource:"{}",...(w=(y=s.parameters)==null?void 0:y.docs)==null?void 0:w.source},description:{story:"The installer as it appears while dependencies are being fetched.",...(x=(f=s.parameters)==null?void 0:f.docs)==null?void 0:x.description}}};const G=["Default"];export{s as Default,G as __namedExportsOrder,Y as default};
