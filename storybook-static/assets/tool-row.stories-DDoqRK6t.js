import{j as t}from"./jsx-runtime-6qgwzs7k.js";import{r as A}from"./index-DQDNmYQF.js";/* empty css              */import{W as d,C as Ze}from"./canonical-transcript-CuGtzwri.js";import{a as i,d as et,b as tt,E as nt}from"./transcript-reducer-DeWRerWc.js";import"./desktop-api-CaQEbvIp.js";import"./canonical-sessions-store-DXL5LYN7.js";import"./middleware-BA0ma3y9.js";import"./tooltip-BdVa6PqK.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";import"./markdown-renderer-BWJDRHtD.js";import"./iframe-e1Jh8KqV.js";import"./base-dialog-CrmyWXii.js";import"./tabs-D6HlMULL.js";import"./textarea-DG-lIhp0.js";import"./ui-preferences-store-C41aoBWQ.js";import"./createTheme-BajzA9aJ.js";import"./rotate-ccw-CvPrqEDK.js";import"./download-BepMeEVw.js";import"./copy-uVtzsRLQ.js";import"./index-EJ-yq0BT.js";import"./index-B4G4emKD.js";import"./index-84k9TH_T.js";import"./index-D3YqUQwT.js";import"./image-attachment-D93Z9Ls2.js";import"./index-CPD9vZQH.js";import"./index-CnYGlD5c.js";import"./tool-row-model-Cw4Weno9.js";import"./code-xml-i5f_NYNZ.js";import"./pencil-CUWtmVYN.js";import"./is-canvas-supported-CMB23l-O.js";import"./toast-manager-DKnI1kug.js";import"./index-DdWVCD6p.js";import"./ellipsis-BovkwUJa.js";import"./load-language-extensions-CvIC2txr.js";import"./message-timestamp-YUWbwoJA.js";import"./bot-C9UUcjQw.js";import"./date-utils-D4-mGN3N.js";import"./format-DKJucjip.js";import"./en-US-Dx4UrcLc.js";import"./send-DNha2_gr.js";import"./users-B9ScUM_F.js";import"./tag-DSAqN5BT.js";import"./clock-B_VENYd6.js";import"./search-Cf6fTIbH.js";import"./file-text-B4-jMc9p.js";import"./use-media-query-TAtaIvow.js";import"./wrench-BZ4vI0L3.js";import"./circle-slash-Bp7wvHah.js";import"./spinner-B2SkZRIb.js";const n=176e10,e=s=>({kind:"tool",ts:n,toolCallId:s.id,toolName:"bash",intent:null,args:null,phase:"done",argumentBytes:0,output:"ok",isError:!1,durationS:.4,startedAt:null,images:[],added:0,removed:0,diff:null,stopped:!1,...s});function ot(s){return{records:s,index:new Map(s.map((r,o)=>[r.id,o])),generation:1,oldestId:null,hasMore:!1,argsByCall:new Map}}const a=({records:s,width:r="100%",height:o=300,waiting:N=!1,openRows:_=!1})=>{const T=A.useRef(null);return A.useEffect(()=>{var R;if(_)for(const Xe of((R=T.current)==null?void 0:R.querySelectorAll('button[aria-expanded="false"]'))??[])Xe.click()},[_]),t.jsx("div",{className:"overflow-y-auto p-6",ref:T,style:{width:r,height:o},children:t.jsx(Ze,{transcript:ot(s),gate:null,waiting:N,loadingOlder:!1,onLoadOlder:async()=>!0,containerRef:T,isSmallView:!1,status:"live",error:null})})},pn={title:"Chat/Tool rows",parameters:{layout:"fullscreen"}},l={render:()=>t.jsx(a,{height:300,records:[e({id:"tool:1",toolName:"bash",args:{command:"ls ~/ | head -50; echo ---; du -sh *"},durationS:2.94,output:`Applications
Desktop
Documents`}),e({id:"tool:2",toolName:"read",args:{path:"/Users/damian/local-operator-ui/docs/branding.md"},durationS:.04,output:"# Branding and design system"}),e({id:"tool:1c",toolName:"write",args:null,phase:"composing",argumentBytes:12688,durationS:null,output:null}),e({id:"tool:3",toolName:"edit",args:{path:"src/renderer/src/features/chat/canonical/x.tsx"},durationS:.12,added:42,removed:11,output:"edited"}),e({id:"tool:4",toolName:"bash",args:{command:"false"},durationS:.21,isError:!0,output:"exit status 1"}),e({id:"tool:5",toolName:"grep",args:{pattern:"needle",path:"src"},durationS:5,stopped:!0,output:null}),e({id:"tool:6",toolName:"web_fetch",args:{url:"https://example.com/very/long/path/to/a/document"},phase:"running",durationS:null,startedAt:Date.now()-12e3,output:null})]})},h={render:()=>t.jsx(a,{height:300,records:[e({id:"tool:1",toolName:"list_variables",args:{},durationS:.01}),e({id:"tool:2",toolName:"read_variable",args:{name:"invoice_totals"},durationS:.01}),e({id:"tool:3",toolName:"mcp__linear_create_issue",args:{team:"core",title:"Tool rows drift from the TUI"},durationS:1.2,output:"created LIN-482"}),e({id:"tool:4",toolName:"mcp__linear_list_issues",args:{team:"core"},durationS:.8,output:"12 issues"}),e({id:"tool:5",toolName:"some_custom_tool",args:{thing:"value",other:3},durationS:.3,output:"done"}),e({id:"tool:6",toolName:"team",args:{op:"list"},durationS:.02}),e({id:"tool:7",toolName:"eval",args:{code:`import pandas as pd
df.head()`},durationS:1.9,output:`   a  b
0  1  2`})]})},c={render:()=>t.jsx(a,{width:"420px",height:212,records:[e({id:"tool:1",toolName:"edit",args:{path:"src/renderer/src/features/chat/canonical/x.tsx"},durationS:.12,added:42,removed:11,output:"edited"}),e({id:"tool:2",toolName:"bash",args:{command:"rg --hidden --no-ignore -n 'imageCount' src | head -50 | sort -u"},durationS:2.94,output:"one match"}),e({id:"tool:3",toolName:"bash",args:{command:"false"},durationS:.21,isError:!0,output:"exit status 1"})]})},m={render:()=>t.jsx(a,{waiting:!0,height:216,records:[e({id:"tool:1",toolName:"read",args:{path:"docs/branding.md"},durationS:.04,output:"# Branding"}),e({id:"tool:2",toolName:"bash",args:{command:"pnpm test:desktop"},phase:"running",durationS:null,startedAt:Date.now()-47e3,intent:"Running the desktop gates",output:null})]})},p={render:()=>t.jsxs("div",{className:"flex flex-col gap-8 p-6",children:[t.jsx(a,{height:232,records:[e({id:"a1",toolName:"read",args:{path:"~/local-operator-ui/docs/branding.md"},durationS:.04}),e({id:"a2",toolName:"bash",args:{command:"pnpm check-types"},durationS:12.4}),e({id:"a3",toolName:"bash",args:{command:"git status --short"},durationS:.08}),e({id:"a4",toolName:"bash",args:{command:"pnpm lint"},durationS:3.1})]}),t.jsx(a,{height:240,records:[{kind:"assistant",id:"b0",ts:n,text:"Checking on both reviewers before I fold the rounds together.",streaming:!1,complete:!0,stopReason:null,error:!1},e({id:"b1",toolName:"hub",args:{op:"peek",job_id:"reviewer"},durationS:.3}),{kind:"assistant",id:"b2",ts:n,text:"",streaming:!1,stopReason:"toolUse",error:!1},e({id:"b3",toolName:"hub",args:{op:"peek",job_id:"designer"},durationS:.2}),e({id:"b4",toolName:"send",args:{target:"qa",message:"rounds are in"},durationS:.1})]}),t.jsx(a,{height:256,records:[e({id:"c1",toolName:"bash",args:{command:"git log --oneline -8"},durationS:.06}),{kind:"assistant",id:"c2",ts:n,text:"",streaming:!1,stopReason:"toolUse",error:!1},e({id:"c3",toolName:"bash",args:{command:"pnpm test:desktop"},durationS:8.2}),e({id:"c4",toolName:"bash",args:{command:"pnpm build"},durationS:34}),{kind:"assistant",id:"c5",ts:n,text:"",streaming:!1,stopReason:"toolUse",error:!1},e({id:"c6",toolName:"grep",args:{pattern:"min-h-6",path:"src"},durationS:.4}),e({id:"c7",toolName:"edit",args:{path:"src/renderer/src/shared/components/ui/disclosure.tsx"},durationS:.1,added:8,removed:3})]})]})},u={render:()=>t.jsxs("div",{className:"flex flex-col gap-8 p-6",children:[t.jsx(a,{height:228,records:[{kind:"assistant",id:"l0",ts:n,text:"Checking the lockfile before I touch anything.",streaming:!1,complete:!0,stopReason:null,error:!1},e({id:"l1",toolName:"read",args:{path:"pnpm-lock.yaml"},durationS:.06}),{kind:"assistant",id:"l2",ts:n,text:"It is unchanged, so the install is not the cause.",streaming:!1,complete:!0,stopReason:null,error:!1}]}),t.jsx(a,{height:236,records:[e({id:"m1",toolName:"bash",args:{command:"pnpm check-types"},durationS:11.2}),{kind:"notice",id:"m2",ts:n,text:"Reconnected to the backend.",level:"info"},e({id:"m3",toolName:"bash",args:{command:"pnpm lint"},durationS:2.8}),e({id:"m4",toolName:"grep",args:{pattern:"GAP",path:"src"},durationS:.11})]}),t.jsx(a,{height:284,records:[{kind:"user",id:"n0",ts:n,text:"Run the gates.",images:[]},e({id:"n1",toolName:"bash",args:{command:"pnpm lint"},durationS:3.1}),e({id:"n2",toolName:"bash",args:{command:"pnpm check-themes"},durationS:6.4}),e({id:"n3",toolName:"bash",args:{command:"pnpm build"},durationS:41})]})]})},g={render:()=>t.jsx(a,{waiting:!0,height:360,records:[e({id:"t1",toolName:"read",args:{path:"docs/branding.md"},durationS:.04}),e({id:"t2",toolName:"bash",args:{command:"pnpm lint"},durationS:3.1}),{kind:"user",id:"t3",ts:n,text:"Tighten the rows, they read as separate cards.",images:[]},{kind:"assistant",id:"t4",ts:n,text:"Measuring the pitch before I change anything.",streaming:!1,complete:!0,stopReason:null,error:!1},e({id:"t5",toolName:"bash",args:{command:"node scripts/measure-pitch.mjs"},phase:"running",durationS:null,intent:"Measuring the row pitch",output:null})]})},w={render:()=>t.jsx(a,{height:396,records:[{kind:"user",id:"p0",ts:n,text:"Why is the chat text indented differently from the tool rows?",images:[]},e({id:"p1",toolName:"read",args:{path:"src/renderer/src/features/chat/components/markdown.css"},durationS:.05}),{kind:"assistant",id:"p2",ts:n,text:"The rendered answer was capped at a reading measure and then centred inside the row it owns, so it took a different left edge from the ledger below it and stopped well short of the same right edge.",streaming:!1,complete:!0,stopReason:null,error:!1},e({id:"p3",toolName:"grep",args:{pattern:"lo-measured",path:"src"},durationS:.12}),e({id:"p4",toolName:"edit",args:{path:"src/renderer/src/features/chat/components/markdown.css"},durationS:.08,added:6,removed:4}),{kind:"assistant",id:"p5",ts:n,text:"Both registers now resolve against the row content box, so the answer opens on the same rail the tool names do and ends on the same right edge as their durations.",streaming:!1,complete:!0,stopReason:null,error:!1}]})},f={render:()=>t.jsx(a,{waiting:!0,height:192,records:[e({id:"s1",toolName:"read",args:{path:"src/renderer/src/features/chat/components/markdown.css"},durationS:.05}),{kind:"assistant",id:"s2",ts:n,text:"",streaming:!0,stopReason:null,error:!1}]})},b={render:()=>t.jsx(a,{height:732,records:[{kind:"user",id:"m0",ts:n,text:"Which rule was capping the answer, and what did it measure?",images:[]},e({id:"m1",toolName:"grep",args:{pattern:"max-width",path:"src/renderer/src/features"},durationS:.09}),{kind:"assistant",id:"m2",ts:n,text:["One rule carried both halves of the report, and it lived on the rendered markdown root rather than on the column:","","```css",".lo-measured .lo-markdown {","	max-width: 62ch;","	margin-inline: auto;","}","```","","Measured against the ledger row in the same turn, at the body step:","","| Viewport | Tool row | Agent prose, before | Left delta | Right delta |","| --- | --- | --- | --- | --- |","| 1024x620 | 102..962 | 258.6..805.4 | 156.6 | 156.6 |","| 1440x900 | 310..1170 | 466.6..1013.4 | 156.6 | 156.6 |","","The consequences were the ones the report named:","","- `margin-inline: auto` centred the answer inside the row it owns, so the column showed two left rails instead of one.","- `62ch` resolved to 546.7px, stopping the prose 313px short of the ledger's right edge on any comfortable window.","- Both grew with the window rather than shrinking, because the cap binds harder the more room there is.","","The measure is now the user bubble's property alone."].join(`
`),streaming:!1,complete:!0,stopReason:null,error:!1},e({id:"m3",toolName:"edit",args:{path:"src/renderer/src/features/chat/components/markdown.css"},durationS:.07,added:34,removed:11})]})},y={render:()=>t.jsxs("div",{className:"flex flex-col gap-4 p-8",children:[t.jsx(d,{activity:"thinking",phase:"thinking"}),t.jsx(d,{activity:"responding",phase:"responding"}),t.jsx(d,{activity:"composing a call",phase:"composing"}),t.jsx(d,{activity:"Auditing tickets against merged MRs",phase:"running"}),t.jsx(d,{activity:"running 3 tools",phase:"running"})]})},x={render:()=>t.jsx(a,{height:276,records:at()})};function at(){const s={command:"sed -n '1130,1230p' src/main/update-service.ts",i:"Reading the updater"},r=N=>({content:[{type:"text",text:N}],details:{}});let o=i(nt,{type:"tool_execution_start",tool_call_id:"c-gap",tool_name:"bash",args:s},n);return o=et(o),o=tt(o,{entries:[{id:"a-gap",ts:n,type:"message",payload:{kind:"message",role:"assistant",content:[],tool_calls:[{id:"c-gap",name:"bash",arguments:s}]}}],has_more:!1}),o=i(o,{type:"tool_execution_end",tool_call_id:"c-gap",tool_name:"bash",result:r(`exit code: 0
--- stdout ---
      this.updateAvailable = false`),duration_s:.1},n+100),o=i(o,{type:"tool_execution_end",tool_call_id:"c-unknown",tool_name:"bash",result:r(`exit code: 0
--- stdout ---
=== /Volumes ===
Local Operator 0.17.0`),duration_s:.3},n+900),o=i(o,{type:"tool_execution_end",tool_call_id:"c-read",tool_name:"read",result:r("1130|  private setupUpdateEvents(): void {"),duration_s:.2},n+1200),o=i(o,{type:"tool_execution_end",tool_call_id:"c-silent",tool_name:"bash",result:r(`exit code: 0
--- stdout ---
(empty)
--- stderr ---
(empty)`),duration_s:.1},n+1300),o=i(o,{type:"tool_execution_end",tool_call_id:"c-long",tool_name:"grep",result:r(`exit code: 0
--- stdout ---
src/renderer/src/features/chat/components/trace/tool-row.tsx:412: a line long enough that the object column truncates it`),duration_s:.4},n+1400),o=i(o,{type:"tool_execution_start",tool_call_id:"c-known",tool_name:"bash",args:{command:"pnpm check-types && pnpm test:desktop"}},n+1500),o=i(o,{type:"tool_execution_end",tool_call_id:"c-known",tool_name:"bash",result:r(`exit code: 0
--- stdout ---
all checks passed`),duration_s:12.4},n+13900),o.records}const rt=["--- ","+++ ","@@ -18,7 +18,8 @@ export function diffCounts(details: unknown) {"," 	const source = (details ?? {}) as Record<string, unknown>;","-	const count = (value: unknown) =>",'-		typeof value === "number" && value > 0 ? value : 0;',"+	const count = (value: unknown) =>",'+		typeof value === "number" && Number.isInteger(value) && value > 0',"+			? value","+			: 0;"," 	return { added: count(source.added), removed: count(source.removed) };"," }","@@ -44,6 +45,7 @@ function sameImages(a: TranscriptImage[], b: TranscriptImage[]) {"," 	for (let i = 0; i < a.length; i++) {","-		if (a[i].id !== b[i].id) return false;","+		if (a[i].id !== b[i].id) return false;","+		if (a[i].data !== b[i].data) return false;","--- a SQL comment inside a Lua migration, still a removal"," 	}"," 	return true;"," }"],st=["--- ","+++ ","@@ -0,0 +1,6 @@","+# Release window notes","+","+A window is the PRs merged since the last tag.","+A latecomer rides the next window.","+","+One owner per window, and the owner picks one bump for all of it."],it=["--- ","+++ ","@@ -1,3 +1,43 @@",...Array.from({length:43},(s,r)=>`+	row ${r+1} of a generated table`)],dt=["--- ","+++ ","@@ -1,3 +1,43 @@",...Array.from({length:43},(s,r)=>`+		const row${r+1} = { cells: ["alpha", "beta", "gamma"], width: "generated" };`)],lt=e({id:"tool:8",toolName:"write",args:{path:"scripts/wrapped-table.mjs",content:"…"},durationS:.5,added:43,removed:0,output:"Overwrote scripts/wrapped-table.mjs (4384 chars).",diff:dt}),Qe=e({id:"tool:1",toolName:"edit",args:{path:"src/renderer/src/features/chat/components/trace/tool-row-model.ts",hunks:[{find:"const count",replace:"const count2"}]},durationS:.12,added:6,removed:3,output:"Edited src/renderer/src/features/chat/components/trace/tool-row-model.ts: 2 hunk(s), 2 replacement(s) applied.",diff:rt}),ht=e({id:"tool:2",toolName:"write",args:{path:"notes/release-window.md",content:`# Release window notes

A window is the PRs merged since the last tag.`},durationS:.03,added:6,removed:0,output:"Created notes/release-window.md (124 chars).",diff:st}),$e=e({id:"tool:3",toolName:"write",args:{path:"scripts/generated-table.mjs",content:"…"},durationS:.4,added:43,removed:0,output:"Overwrote scripts/generated-table.mjs (1204 chars).",diff:it}),ct=e({id:"tool:4",toolName:"write",args:{path:"notes/release-window.md",content:`# Release window notes

A window is the PRs merged since the last tag.`},durationS:.02,added:0,removed:0,output:"Overwrote notes/release-window.md (124 chars).",diff:null}),mt=e({id:"tool:5",toolName:"write",args:{path:"",content:"x"},durationS:.01,isError:!0,output:"path must be a non-empty string",diff:null}),pt=e({id:"tool:6",toolName:"write",phase:"composing",argumentBytes:1204,args:null,output:null,durationS:null,diff:null}),ut=e({id:"tool:7",toolName:"bash",args:{command:"git status --short"},durationS:.07,output:" M src/renderer/src/features/chat/canonical/tool-row.stories.tsx",diff:null}),k={render:()=>t.jsx(a,{height:2110,openRows:!0,records:[Qe,ht,$e,ct,mt,pt,ut]})},S={render:()=>t.jsx(a,{height:1380,openRows:!0,records:[Qe,$e]})},v={render:()=>t.jsx(a,{height:830,openRows:!0,records:[lt]})};var E,W,I,j,O;l.parameters={...l.parameters,docs:{...(E=l.parameters)==null?void 0:E.docs,source:{originalSource:`{
  render: () => <Frame height={300} records={[tool({
    id: "tool:1",
    toolName: "bash",
    args: {
      command: "ls ~/ | head -50; echo ---; du -sh *"
    },
    durationS: 2.94,
    output: "Applications\\nDesktop\\nDocuments"
  }), tool({
    id: "tool:2",
    toolName: "read",
    args: {
      path: "/Users/damian/local-operator-ui/docs/branding.md"
    },
    durationS: 0.04,
    output: "# Branding and design system"
  }),
  // The composing row, which has no execution time to report: the
  // duration slot stays reserved and EMPTY (\`tool_card.py:2503-2507\`),
  // and the dictation counter in the object column is the only thing on
  // the row that moves. Bytes chosen to land on a KB step, because the
  // spelling is what this row is for.
  tool({
    id: "tool:1c",
    toolName: "write",
    args: null,
    phase: "composing",
    argumentBytes: 12_688,
    durationS: null,
    output: null
  }),
  // The diff counters, which is the row shape a write produces.
  tool({
    id: "tool:3",
    toolName: "edit",
    args: {
      path: "src/renderer/src/features/chat/canonical/x.tsx"
    },
    durationS: 0.12,
    added: 42,
    removed: 11,
    output: "edited"
  }),
  // A failure: danger ground, cross glyph, and the duration STILL dim —
  // \`✗ 0.2s\` is not all-red.
  tool({
    id: "tool:4",
    toolName: "bash",
    args: {
      command: "false"
    },
    durationS: 0.21,
    isError: true,
    output: "exit status 1"
  }),
  // A stop is not a failure: hueless glyph, no danger ground.
  tool({
    id: "tool:5",
    toolName: "grep",
    args: {
      pattern: "needle",
      path: "src"
    },
    durationS: 5,
    stopped: true,
    output: null
  }),
  // Running: live clock, NO outcome glyph, raised ground. The start is
  // pinned in the past so the still SHOWS a clock that has moved —
  // captured at \`startedAt: now\` every running row reads \`0s\`, which
  // is indistinguishable from the frozen clock this replaced and is
  // exactly why the defect survived a review round.
  tool({
    id: "tool:6",
    toolName: "web_fetch",
    args: {
      url: "https://example.com/very/long/path/to/a/document"
    },
    phase: "running",
    durationS: null,
    startedAt: Date.now() - 12_000,
    output: null
  })]} />
}`,...(I=(W=l.parameters)==null?void 0:W.docs)==null?void 0:I.source},description:{story:`Every outcome in one column, at a comfortable width — plus the state
before there is an outcome at all: a call still being dictated.`,...(O=(j=l.parameters)==null?void 0:j.docs)==null?void 0:O.description}}};var P,D,C,F,L;h.parameters={...h.parameters,docs:{...(P=h.parameters)==null?void 0:P.docs,source:{originalSource:`{
  render: () => <Frame height={300} records={[
  // The column grows to the longest visible name, so these all share
  // one edge and every summary starts on one rail.
  tool({
    id: "tool:1",
    toolName: "list_variables",
    args: {},
    durationS: 0.01
  }), tool({
    id: "tool:2",
    toolName: "read_variable",
    args: {
      name: "invoice_totals"
    },
    durationS: 0.01
  }),
  // An MCP tool: plug glyph, and the name is the CALL rather than the
  // mint — \`mcp__linear_create_issue\` in eight columns reads \`mcp__lin\`.
  tool({
    id: "tool:3",
    toolName: "mcp__linear_create_issue",
    args: {
      team: "core",
      title: "Tool rows drift from the TUI"
    },
    durationS: 1.2,
    output: "created LIN-482"
  }), tool({
    id: "tool:4",
    toolName: "mcp__linear_list_issues",
    args: {
      team: "core"
    },
    durationS: 0.8,
    output: "12 issues"
  }),
  // An unknown tool: wrench, deliberately NOT the plug. "I do not know
  // this tool" and "this came from a server you connected" are
  // different answers.
  tool({
    id: "tool:5",
    toolName: "some_custom_tool",
    args: {
      thing: "value",
      other: 3
    },
    durationS: 0.3,
    output: "done"
  }),
  // \`team\` and \`eval\` are absent from the TUI's table too, and take the
  // same wrench. The operator's own screenshot shows exactly this.
  tool({
    id: "tool:6",
    toolName: "team",
    args: {
      op: "list"
    },
    durationS: 0.02
  }), tool({
    id: "tool:7",
    toolName: "eval",
    args: {
      code: "import pandas as pd\\ndf.head()"
    },
    durationS: 1.9,
    output: "   a  b\\n0  1  2"
  })]} />
}`,...(C=(D=h.parameters)==null?void 0:D.docs)==null?void 0:C.source},description:{story:"Long names, unknown tools and MCP calls — what the name column must absorb.",...(L=(F=h.parameters)==null?void 0:F.docs)==null?void 0:L.description}}};var B,M,U,H,G;c.parameters={...c.parameters,docs:{...(B=c.parameters)==null?void 0:B.docs,source:{originalSource:`{
  render: () => <Frame width="420px" height={212} records={[tool({
    id: "tool:1",
    toolName: "edit",
    args: {
      path: "src/renderer/src/features/chat/canonical/x.tsx"
    },
    durationS: 0.12,
    added: 42,
    removed: 11,
    output: "edited"
  }), tool({
    id: "tool:2",
    toolName: "bash",
    args: {
      command: "rg --hidden --no-ignore -n 'imageCount' src | head -50 | sort -u"
    },
    durationS: 2.94,
    output: "one match"
  }), tool({
    id: "tool:3",
    toolName: "bash",
    args: {
      command: "false"
    },
    durationS: 0.21,
    isError: true,
    output: "exit status 1"
  })]} />
}`,...(U=(M=c.parameters)==null?void 0:M.docs)==null?void 0:U.source},description:{story:`The same rows in a narrow column.

The shed order is the TUI's: the diff counters go first — "how a write went
is core, how much it wrote is meta" — then the summary truncates, and the
outcome column always survives. Compare against \`States\` at full width.`,...(G=(H=c.parameters)==null?void 0:H.docs)==null?void 0:G.description}}};var q,V,z,K,Y;m.parameters={...m.parameters,docs:{...(q=m.parameters)==null?void 0:q.docs,source:{originalSource:`{
  render: () => <Frame waiting height={216} records={[tool({
    id: "tool:1",
    toolName: "read",
    args: {
      path: "docs/branding.md"
    },
    durationS: 0.04,
    output: "# Branding"
  }), tool({
    id: "tool:2",
    toolName: "bash",
    args: {
      command: "pnpm test:desktop"
    },
    phase: "running",
    durationS: null,
    // A running row's clock counts from here, because \`durationS\`
    // does not arrive until the call ends. Pinned 47s in the past so
    // the frame DEMONSTRATES the clock rather than catching it at
    // \`0s\` — a still taken immediately cannot distinguish a working
    // clock from the frozen one this replaced.
    startedAt: Date.now() - 47_000,
    intent: "Running the desktop gates",
    output: null
  })]} />
}`,...(z=(V=m.parameters)==null?void 0:V.docs)==null?void 0:z.source},description:{story:`The working line, at the foot of a turn.

It must not restate the row above it: the row says WHAT ran and how long that
call has taken, and this says what KIND of work is in flight and how old the
phase is. Two different facts, deliberately not the same words.`,...(Y=(K=m.parameters)==null?void 0:K.docs)==null?void 0:Y.description}}};var J,Q,$,X,Z;p.parameters={...p.parameters,docs:{...(J=p.parameters)==null?void 0:J.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-8 p-6">
            {/* (a) Four consecutive settled rows: one pitch, repeated.
                Heights here and below are \`scrollHeight\` measured in the rendered
                story plus the Frame's 48px of padding, rounded up to the 4px ramp -
                not guessed, and not "whatever looked right". A Frame shorter than
                its transcript CLIPS it: the story's history is anchored at its top,
                so the rows that fall out of the picture are the NEWEST ones, off
                the bottom, while everything above them stays exactly where it was.
                Read that off the two frames rather than from the flex direction:
                across the short frame and its resized replacement the divider sits
                at the same y, rows 1-5 sit at the same y, and what the short one is
                missing is its sixth row and the trailing date band. On a spacing
                surface that silently becomes a photograph of a SHORTER RUN, which
                is the failure design and QA both caught on \`joined-mid-turn\` - six
                rows in the frame it replaced, five here, against a README that says
                six. Two things ate the slack: the \`Start of conversation\` divider
                (#112), which occupies real height at the top, and 2px per gap from
                the hairline. The
                capture viewport in \`capture-evidence.mjs\` has to clear these too,
                because the harness takes \`max(scrollHeight, declared)\` and a
                viewport shorter than the Frame re-crops what the Frame just made
                room for. */}
            <Frame height={232} records={[tool({
      id: "a1",
      toolName: "read",
      args: {
        path: "~/local-operator-ui/docs/branding.md"
      },
      durationS: 0.04
    }), tool({
      id: "a2",
      toolName: "bash",
      args: {
        command: "pnpm check-types"
      },
      durationS: 12.4
    }), tool({
      id: "a3",
      toolName: "bash",
      args: {
        command: "git status --short"
      },
      durationS: 0.08
    }), tool({
      id: "a4",
      toolName: "bash",
      args: {
        command: "pnpm lint"
      },
      durationS: 3.1
    })]} />
            {/* (b) Prose, then two \`hub\` rows separated by a tool-call-only
                assistant record, then a \`send\` row. All four rows must sit on one
                pitch: the invisible record between them is not a spacer. */}
            <Frame height={240} records={[{
      kind: "assistant",
      id: "b0",
      ts: TS,
      text: "Checking on both reviewers before I fold the rounds together.",
      streaming: false,
      complete: true,
      stopReason: null,
      error: false
    }, tool({
      id: "b1",
      toolName: "hub",
      args: {
        op: "peek",
        job_id: "reviewer"
      },
      durationS: 0.3
    }),
    // Tool calls, no prose: renders nothing, must occupy nothing.
    {
      kind: "assistant",
      id: "b2",
      ts: TS,
      text: "",
      streaming: false,
      stopReason: "toolUse",
      error: false
    }, tool({
      id: "b3",
      toolName: "hub",
      args: {
        op: "peek",
        job_id: "designer"
      },
      durationS: 0.2
    }), tool({
      id: "b4",
      toolName: "send",
      args: {
        target: "qa",
        message: "rounds are in"
      },
      durationS: 0.1
    })]} />
            {/* (c) The long ragged run: two more invisible records seeded mid-run,
                which is what made some adjacent pairs tight and others wide. */}
            <Frame height={256} records={[tool({
      id: "c1",
      toolName: "bash",
      args: {
        command: "git log --oneline -8"
      },
      durationS: 0.06
    }), {
      kind: "assistant",
      id: "c2",
      ts: TS,
      text: "",
      streaming: false,
      stopReason: "toolUse",
      error: false
    }, tool({
      id: "c3",
      toolName: "bash",
      args: {
        command: "pnpm test:desktop"
      },
      durationS: 8.2
    }), tool({
      id: "c4",
      toolName: "bash",
      args: {
        command: "pnpm build"
      },
      durationS: 34
    }), {
      kind: "assistant",
      id: "c5",
      ts: TS,
      text: "",
      streaming: false,
      stopReason: "toolUse",
      error: false
    }, tool({
      id: "c6",
      toolName: "grep",
      args: {
        pattern: "min-h-6",
        path: "src"
      },
      durationS: 0.4
    }), tool({
      id: "c7",
      toolName: "edit",
      args: {
        path: "src/renderer/src/shared/components/ui/disclosure.tsx"
      },
      durationS: 0.1,
      added: 8,
      removed: 3
    })]} />
        </div>
}`,...($=(Q=p.parameters)==null?void 0:Q.docs)==null?void 0:$.source},description:{story:`The three runs the operator screenshotted when he reported the spacing as
"much too wide" and "not very uniform".

This is a REGRESSION surface, not a showcase: each block reproduces one of
his three frames, and the point of the story is that the pitch between
adjacent like rows is CONSTANT within each block. The middle block is the
one that caught the bug — the \`assistant\` record between the two \`hub\` rows
carries tool calls and no prose, so it renders nothing, and before the fix it
still minted a wrapper with a margin AND broke the trace-adjacency chain, so
the row after it fell back to the wider \`item\` gap. An invisible record must
not be able to push visible rows apart.`,...(Z=(X=p.parameters)==null?void 0:X.docs)==null?void 0:Z.description}}};var ee,te,ne,oe,ae;u.parameters={...u.parameters,docs:{...(ee=u.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-8 p-6">
            {/* (a) A lone call between two paragraphs: no neighbour, no hairline. */}
            <Frame height={228} records={[{
      kind: "assistant",
      id: "l0",
      ts: TS,
      text: "Checking the lockfile before I touch anything.",
      streaming: false,
      complete: true,
      stopReason: null,
      error: false
    }, tool({
      id: "l1",
      toolName: "read",
      args: {
        path: "pnpm-lock.yaml"
      },
      durationS: 0.06
    }), {
      kind: "assistant",
      id: "l2",
      ts: TS,
      text: "It is unchanged, so the install is not the cause.",
      streaming: false,
      complete: true,
      stopReason: null,
      error: false
    }]} />
            {/* (b) A notice inside a run: one tier, one pitch, all the way down. */}
            <Frame height={236} records={[tool({
      id: "m1",
      toolName: "bash",
      args: {
        command: "pnpm check-types"
      },
      durationS: 11.2
    }), {
      kind: "notice",
      id: "m2",
      ts: TS,
      text: "Reconnected to the backend.",
      level: "info"
    }, tool({
      id: "m3",
      toolName: "bash",
      args: {
        command: "pnpm lint"
      },
      durationS: 2.8
    }), tool({
      id: "m4",
      toolName: "grep",
      args: {
        pattern: "GAP",
        path: "src"
      },
      durationS: 0.11
    })]} />
            {/* (c) The first row of a run takes the TURN boundary, not the
                hairline: the gap is between rows, never above the first one. */}
            <Frame height={284} records={[{
      kind: "user",
      id: "n0",
      ts: TS,
      text: "Run the gates.",
      images: []
    }, tool({
      id: "n1",
      toolName: "bash",
      args: {
        command: "pnpm lint"
      },
      durationS: 3.1
    }), tool({
      id: "n2",
      toolName: "bash",
      args: {
        command: "pnpm check-themes"
      },
      durationS: 6.4
    }), tool({
      id: "n3",
      toolName: "bash",
      args: {
        command: "pnpm build"
      },
      durationS: 41
    })]} />
        </div>
}`,...(ne=(te=u.parameters)==null?void 0:te.docs)==null?void 0:ne.source},description:{story:`Where the \`trace\` hairline applies, and — just as much the point — where it
does NOT.

The gap between adjacent ledger rows is 2px, and the claim a run of identical
rows cannot make on its own is that this is a gap BETWEEN rows rather than a
margin every row carries. A per-row margin looks identical in a picture of a
run and is wrong everywhere else: it would push the first row of a run down
off its own turn boundary and re-space the prose/ledger tier that carries the
"same run vs new turn" signal. So each block here isolates one boundary:

- (a) a LONE call, with prose either side. Nothing is adjacent to it on the
  ledger tier, so it takes no hairline at all — \`item\` above and below.
- (b) a mixed run: calls, a NOTICE between them, then more calls. The notice
  is \`trace\`-like, so every adjacent pair in the block takes the same 2px
  GAP — which is the claim this block makes, and all it claims. The PITCH is
  not uniform and is not supposed to read as though it were: measured, the
  block is \`22, 23.7, 22\`, because a tool row is a 20px box while the notice
  renders its own line box a little taller. That difference is the notice's,
  it predates this tier, and it is what the \`dense\` opt-in already minimises
  (\`trace-line.tsx\`: a row's pitch should follow the COLUMN it is in). What
  this tier owns is the distance BETWEEN rows, and a run whose gap changed
  wherever a notice appeared is the raggedness it was built to prevent.
- (c) a run that OPENS a turn. Its first row takes the turn boundary and the
  rest take the hairline, which is the ordering the gap must not disturb.`,...(ae=(oe=u.parameters)==null?void 0:oe.docs)==null?void 0:ae.description}}};var re,se,ie,de,le;g.parameters={...g.parameters,docs:{...(re=g.parameters)==null?void 0:re.docs,source:{originalSource:`{
  render: () => <Frame waiting height={360} records={[tool({
    id: "t1",
    toolName: "read",
    args: {
      path: "docs/branding.md"
    },
    durationS: 0.04
  }), tool({
    id: "t2",
    toolName: "bash",
    args: {
      command: "pnpm lint"
    },
    durationS: 3.1
  }), {
    kind: "user",
    id: "t3",
    ts: TS,
    text: "Tighten the rows, they read as separate cards.",
    images: []
  }, {
    kind: "assistant",
    id: "t4",
    ts: TS,
    text: "Measuring the pitch before I change anything.",
    streaming: false,
    complete: true,
    stopReason: null,
    error: false
  }, tool({
    id: "t5",
    toolName: "bash",
    args: {
      command: "node scripts/measure-pitch.mjs"
    },
    phase: "running",
    durationS: null,
    intent: "Measuring the row pitch",
    output: null
  })]} />
}`,...(ie=(se=g.parameters)==null?void 0:se.docs)==null?void 0:ie.source},description:{story:`The hierarchy that must SURVIVE the tightening: a turn boundary still gets
real air, and the working line sits on the run below it.

Tightening adjacent tool rows is only correct if the reader can still see
where one turn ended and the next began — otherwise the ledger becomes one
undifferentiated column. This frame is where that trade is judged.`,...(le=(de=g.parameters)==null?void 0:de.docs)==null?void 0:le.description}}};var he,ce,me,pe,ue;w.parameters={...w.parameters,docs:{...(he=w.parameters)==null?void 0:he.docs,source:{originalSource:`{
  render: () => <Frame height={396} records={[{
    kind: "user",
    id: "p0",
    ts: TS,
    text: "Why is the chat text indented differently from the tool rows?",
    images: []
  }, tool({
    id: "p1",
    toolName: "read",
    args: {
      path: "src/renderer/src/features/chat/components/markdown.css"
    },
    durationS: 0.05
  }), {
    kind: "assistant",
    id: "p2",
    ts: TS,
    text: "The rendered answer was capped at a reading measure and then centred inside the row it owns, so it took a different left edge from the ledger below it and stopped well short of the same right edge.",
    streaming: false,
    complete: true,
    stopReason: null,
    error: false
  }, tool({
    id: "p3",
    toolName: "grep",
    args: {
      pattern: "lo-measured",
      path: "src"
    },
    durationS: 0.12
  }), tool({
    id: "p4",
    toolName: "edit",
    args: {
      path: "src/renderer/src/features/chat/components/markdown.css"
    },
    durationS: 0.08,
    added: 6,
    removed: 4
  }), {
    kind: "assistant",
    id: "p5",
    ts: TS,
    text: "Both registers now resolve against the row content box, so the answer opens on the same rail the tool names do and ends on the same right edge as their durations.",
    streaming: false,
    complete: true,
    stopReason: null,
    error: false
  }]} />
}`,...(me=(ce=w.parameters)==null?void 0:ce.docs)==null?void 0:me.source},description:{story:`The operator's alignment report, as one frame: prose between tool rows, and
a final answer, against the ledger they are supposed to line up with.

The subject is a pair of EDGES. Agent prose and a tool row are two registers
of the same turn and sit in the same row content box, so a reader scanning
the column sees one left rail or sees a mistake; \`margin-inline: auto\` on the
answer gave them two, and a reading cap 62 characters wide stopped the prose
hundreds of pixels short of the ledger's right edge on any comfortable
window. The prose here is long enough to reach a cap if one is reintroduced,
and there are rows above AND below it because the report named both cases
("text between tools as well as the agent responses").

The user bubble is in the frame on purpose, as the control: it keeps its own
narrower measure, and a change that widened it too would be visible here.`,...(ue=(pe=w.parameters)==null?void 0:pe.docs)==null?void 0:ue.description}}};var ge,we,fe,be,ye;f.parameters={...f.parameters,docs:{...(ge=f.parameters)==null?void 0:ge.docs,source:{originalSource:`{
  render: () => <Frame waiting height={192} records={[tool({
    id: "s1",
    toolName: "read",
    args: {
      path: "src/renderer/src/features/chat/components/markdown.css"
    },
    durationS: 0.05
  }),
  // Streaming, no text: the model is on the wire. This is the record
  // that used to paint a row of its own.
  {
    kind: "assistant",
    id: "s2",
    ts: TS,
    text: "",
    streaming: true,
    stopReason: null,
    error: false
  }]} />
}`,...(fe=(we=f.parameters)==null?void 0:we.docs)==null?void 0:fe.source},description:{story:`The gap between \`message_start\` and the first token, which is the state the
transcript used to paint twice.

The reducer opens an assistant record the moment the provider call starts, so
for as long as the model is thinking there is a streaming record with no text
in it. That record used to mint a row reading "Writing" directly above the
working line, which already says \`thinking\` — two elements for one fact, and
the redundant one sat in the answer's own register rather than on the ledger.
The TUI has never had a second element here: its one \`WorkingBlock\` carries
the whole phase.

What this frame has to show after the fix is BOTH halves of the trade. No
"Writing" row, and liveness still on screen — the working line is present,
spinning, and naming the phase. A frame that lost the row and the signal
together would be a regression, not a fix, so the story is deliberately
\`waiting\` with a ledger the model has not written to yet.`,...(ye=(be=f.parameters)==null?void 0:be.docs)==null?void 0:ye.description}}};var xe,ke,Se,ve,Ne;b.parameters={...b.parameters,docs:{...(xe=b.parameters)==null?void 0:xe.docs,source:{originalSource:`{
  render: () => <Frame
  // Sized to the content it holds: the four registers this frame exists
  // to show run 688px at 1440, and a shorter frame scrolls the list off
  // its own evidence.
  height={732} records={[{
    kind: "user",
    id: "m0",
    ts: TS,
    text: "Which rule was capping the answer, and what did it measure?",
    images: []
  }, tool({
    id: "m1",
    toolName: "grep",
    args: {
      pattern: "max-width",
      path: "src/renderer/src/features"
    },
    durationS: 0.09
  }), {
    kind: "assistant",
    id: "m2",
    ts: TS,
    text: ["One rule carried both halves of the report, and it lived on the rendered markdown root rather than on the column:", "", "\`\`\`css", ".lo-measured .lo-markdown {", "\\tmax-width: 62ch;", "\\tmargin-inline: auto;", "}", "\`\`\`", "", "Measured against the ledger row in the same turn, at the body step:", "", "| Viewport | Tool row | Agent prose, before | Left delta | Right delta |", "| --- | --- | --- | --- | --- |", "| 1024x620 | 102..962 | 258.6..805.4 | 156.6 | 156.6 |", "| 1440x900 | 310..1170 | 466.6..1013.4 | 156.6 | 156.6 |", "", "The consequences were the ones the report named:", "", "- \`margin-inline: auto\` centred the answer inside the row it owns, so the column showed two left rails instead of one.", "- \`62ch\` resolved to 546.7px, stopping the prose 313px short of the ledger's right edge on any comfortable window.", "- Both grew with the window rather than shrinking, because the cap binds harder the more room there is.", "", "The measure is now the user bubble's property alone."].join("\\n"),
    streaming: false,
    complete: true,
    stopReason: null,
    error: false
  }, tool({
    id: "m3",
    toolName: "edit",
    args: {
      path: "src/renderer/src/features/chat/components/markdown.css"
    },
    durationS: 0.07,
    added: 34,
    removed: 11
  })]} />
}`,...(Se=(ke=b.parameters)==null?void 0:ke.docs)==null?void 0:Se.source},description:{story:`The COMMON case for an agent answer: prose interleaved with a fenced code
block, a table and a list, against the ledger rows that produced them.

\`branding.md\` § 7 and the reading-measure comment in \`markdown.css\` both call
mixed prose and code the common case rather than an edge case, and this
change is precisely about what those blocks resolve against — so it is the
surface that most needs a picture, and until design review round 1 (D4) it
was the one with none. The plain-paragraph alignment frames cannot stand in
for it: a \`<pre>\`, a \`<table>\` and a \`<ul>\` each have their own box model and
their own history of escaping the measure.

What this frame has to show is FOUR registers on ONE left rail — paragraph,
code, table, list — all opening on the tool rows' rail and ending on their
right edge, with nothing overflowing. Two prior findings live here and must
stay fixed: applying the cap per-block gave each type step its own left edge
(code review round 3, R1), and excluding \`<pre>\`/\`<table>\` from it left them
on the column edge while the prose centred, showing four left edges in one
message (design round 3, D13). Removing the cap is what makes all four agree
structurally, and this is where that is checkable.

The table is deliberately wide enough to use the room the removed cap gives
back, since "the wider measure genuinely helps the table" is part of the
trade this PR made.`,...(Ne=(ve=b.parameters)==null?void 0:ve.docs)==null?void 0:Ne.description}}};var Te,_e,Re,Ae,Ee;y.parameters={...y.parameters,docs:{...(Te=y.parameters)==null?void 0:Te.docs,source:{originalSource:`{
  render: () => <div className="flex flex-col gap-4 p-8">
            <WorkingLine activity="thinking" phase="thinking" />
            <WorkingLine activity="responding" phase="responding" />
            <WorkingLine activity="composing a call" phase="composing" />
            {/* The model's own stated intent, when it wrote one — this is why the
                label is not the word "working". */}
            <WorkingLine activity="Auditing tickets against merged MRs" phase="running" />
            {/* A batch drops the intents for a COUNT: presenting one call's purpose
                as the whole batch's activity is a claim the rows above contradict. */}
            <WorkingLine activity="running 3 tools" phase="running" />
        </div>
}`,...(Re=(_e=y.parameters)==null?void 0:_e.docs)==null?void 0:Re.source},description:{story:"Each label the working line can carry, without needing a live turn to reach it.",...(Ee=(Ae=y.parameters)==null?void 0:Ae.docs)==null?void 0:Ee.description}}};var We,Ie,je,Oe,Pe;x.parameters={...x.parameters,docs:{...(We=x.parameters)==null?void 0:We.docs,source:{originalSource:`{
  render: () => <Frame height={276} records={joinedMidTurn()} />
}`,...(je=(Ie=x.parameters)==null?void 0:Ie.docs)==null?void 0:je.source},description:{story:`The reported case: a viewer that joins a turn ALREADY IN FLIGHT.

The owner's snapshot seed keeps the settling frame of every call that
finished before the viewer attached and drops the start it replaces, and the
settling frame carries no \`args\` — so the seed is a list of calls nobody can
name. Records here are built by the PRODUCTION reducer, in the same order the
session hook applies them, because the defect was never in the row's
presentation: it was in what the row was given.

Three rows say what to look for:

1. A live start, then a receipt gap (\`dropLiveRecords\`), then the durable
   page and the seed's settling frame. The row is created by that settling
   frame, and it must still say the command — before the fix it fell through
   to the result's first line and read \`exit code: 0\`.
2. A result that opens with the harness's own wiring (\`exit code: 0\`, then
   \`--- stdout ---\`). When the arguments really are unknown — a call from an
   older runtime, or one whose plan was rejected — the object column steps
   over that wiring instead of quoting it.
3. A call that printed NOTHING, whose object column is therefore empty rather
   than quoting \`(empty)\`: the stand-in exists to say something, and this is
   the state that must not be mistaken for a rendering failure.
4. A stand-in line long enough that the column truncates it, so the mark is
   judged where it has to survive an ellipsis rather than on a line of its own.
5. A normal row, whose arguments arrived on the live start. Unchanged, and
   here as the control: it is what the rows above must look like.`,...(Pe=(Oe=x.parameters)==null?void 0:Oe.docs)==null?void 0:Pe.description}}};var De,Ce,Fe,Le,Be;k.parameters={...k.parameters,docs:{...(De=k.parameters)==null?void 0:De.docs,source:{originalSource:`{
  render: () => <Frame height={2110} openRows records={[EDIT_ROW, NEW_FILE_ROW, CAPPED_WRITE_ROW, UNCHANGED_WRITE_ROW, FAILED_WRITE_ROW, COMPOSING_WRITE_ROW, BASH_ROW]} />
}`,...(Fe=(Ce=k.parameters)==null?void 0:Ce.docs)==null?void 0:Fe.source},description:{story:`The diff body across its states, at a width where no line wraps.

The frame height is the height this content MEASURES at 1280px wide — the
\`scrollHeight\` of the frame's own scroll box, read out of the story in a real
browser — because the frame IS the body: a shorter one photographs a scrolled
corner of it and cuts the last three cases off the bottom.`,...(Be=(Le=k.parameters)==null?void 0:Le.docs)==null?void 0:Be.description}}};var Me,Ue,He,Ge,qe;S.parameters={...S.parameters,docs:{...(Me=S.parameters)==null?void 0:Me.docs,source:{originalSource:`{
  render: () => <Frame height={1380} openRows records={[EDIT_ROW, CAPPED_WRITE_ROW]} />
}`,...(He=(Ue=S.parameters)==null?void 0:Ue.docs)==null?void 0:He.source},description:{story:`The same body in a 560px column: the wrap rule, not the layout.

A diff line is long by nature, and the claim this frame exists for is that
the body WRAPS rather than growing a horizontal scrollbar inside a
disclosure — a scroll region the reader has to discover, at the width where
the transcript is most likely to be narrow. Two cases rather than seven,
because under wrapping each body grows and the honest picture of the rule is
one you can see whole: the multi-hunk edit, and the capped body whose
remaining scroll is now vertical only.`,...(qe=(Ge=S.parameters)==null?void 0:Ge.docs)==null?void 0:qe.description}}};var Ve,ze,Ke,Ye,Je;v.parameters={...v.parameters,docs:{...(Ve=v.parameters)==null?void 0:Ve.docs,source:{originalSource:`{
  render: () => <Frame height={830} openRows records={[WRAPPED_CAPPED_WRITE_ROW]} />
}`,...(Ke=(ze=v.parameters)==null?void 0:ze.docs)==null?void 0:Ke.source},description:{story:`The cap at a WRAPPING width, which is the shape that actually reaches it.

The ceiling above is derived for unwrapped rows and is exactly right there;
a 560px column turns 40 long lines into ~80 rows — 1415px of content in a
738px client box, measured — so the marker's own row begins 648.6px BELOW the
clip, and the body would say "40 lines" while 40 rows stayed hidden. (677px is
the distance the pin lifts that row, not the below-the-fold gap; the
WRAPPED_CAPPED_DIFF fixture above carries both quantities and why they
differ.) That is the defect class the 720px ceiling was fixed for. Here the
frame is at rest, scrolled to the top, and the marker is pinned to the well's
foot: if it ever stops being visible, this frame shows the well claiming
completeness with lines missing, which is the whole point of it.`,...(Je=(Ye=v.parameters)==null?void 0:Ye.docs)==null?void 0:Je.description}}};const un=["States","NamesAndFallbacks","Narrow","Working","OperatorSpacingCases","TraceGapBoundaries","TurnBoundaryAndWorkingLine","ProseToolAlignment","StreamingBeforeFirstToken","MixedProseCodeAndTables","WorkingLabels","JoinedMidTurn","DiffBody","DiffBodyNarrow","DiffBodyNarrowWrappedCap"];export{k as DiffBody,S as DiffBodyNarrow,v as DiffBodyNarrowWrappedCap,x as JoinedMidTurn,b as MixedProseCodeAndTables,h as NamesAndFallbacks,c as Narrow,p as OperatorSpacingCases,w as ProseToolAlignment,l as States,f as StreamingBeforeFirstToken,u as TraceGapBoundaries,g as TurnBoundaryAndWorkingLine,m as Working,y as WorkingLabels,un as __namedExportsOrder,pn as default};
