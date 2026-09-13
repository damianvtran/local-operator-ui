import{j as e}from"./jsx-runtime-6qgwzs7k.js";const a=({title:t,icon:i,subtitle:n,children:o})=>e.jsxs("div",{className:"@container flex flex-wrap items-start justify-between gap-4",children:[e.jsxs("div",{className:"flex min-w-0 items-start gap-4",children:[e.jsx(i,{size:24,"aria-hidden":"true",className:"mt-1 shrink-0 text-ink-muted"}),e.jsxs("div",{className:"flex flex-col gap-1",children:[e.jsx("h1",{className:"text-display text-ink",children:t}),n&&e.jsx("p",{className:"max-w-200 text-body text-ink-muted",children:n})]})]}),o]});try{a.displayName="PageHeader",a.__docgenInfo={description:`The title block at the top of a route, with its icon on the left and any page
actions on the right.

## Two pieces of chrome deliberately not carried over

The header used to be a bordered, rounded panel. A border drawn around the
top of a page delimits the page from nothing — there is no adjacent content
for it to separate — so it loses no information by being deleted, which is
the test the branding contract sets for a boundary.

The icon sat in a 48px circle filled with \`action.hover\`. That plate was a
fifth ground introduced for one element, and it made every page open with a
decorated badge rather than with its title. The icon now sits inline at
\`ink-muted\`, subordinate to the title, which is the hierarchy that was
intended in the first place.

The title is \`text-display\` — 28px, the largest step in the app, and the only
place it is used. There is no step above it on purpose: a desktop app has no
hero.

## No bottom margin

It shipped \`mb-8\`, which stacked with whatever gap its page already had —
every one of the four routes that use it lays its content out as a flex
column. A component does not own its outer margin; the container owns the
gap, and all four containers now set \`gap-8\` explicitly, which is the same
32px said once in a place you can see it.

## Why it wraps, and why it is a container

The row used to be \`justify-between\` with no \`flex-wrap\`. A flex line does
not overflow politely: once the title block and the action group could not
both fit, the actions were squeezed past their labels and then past the
page's \`overflow-hidden\` edge, so at 800px "Export" read as "Exp" and two
buttons were not merely off-screen but unreachable. \`flex-wrap\` makes the
action group drop to its own full-width line instead, and \`min-w-0\` on the
title block lets a long title give way before that happens.

\`@container\` is here so pages can collapse their own actions against the
width the header actually has rather than against the viewport. The two
things between this header and the window edge — the app rail and a list
pane — are both independently collapsible, so the viewport does not know
how much room is left. \`agents-page.tsx\` is the one caller that needs it.`,displayName:"PageHeader",props:{title:{defaultValue:null,description:"",name:"title",required:!0,type:{name:"string"}},icon:{defaultValue:null,description:"",name:"icon",required:!0,type:{name:"LucideIcon"}},subtitle:{defaultValue:null,description:"",name:"subtitle",required:!1,type:{name:"string"}}}}}catch{}export{a as P};
