/* empty css              */import{U as Ke}from"./usage-view-DY-r7OvI.js";import"./jsx-runtime-6qgwzs7k.js";import"./index-DQDNmYQF.js";import"./desktop-api-CaQEbvIp.js";import"./tooltip-BdVa6PqK.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";import"./QueryClientProvider-Dm9Qnur9.js";import"./useQuery-KIirrhLZ.js";import"./spinner-B2SkZRIb.js";import"./search-Cf6fTIbH.js";import"./v4-C6aID195.js";const e=176e10,p=6e4,t=36e5,a=864e5,r=(i={})=>({used:null,limit:null,remaining:null,used_fraction:null,unit:"percent",...i}),s=i=>({label:i.id,amount:r(),window:i.id,status:null,resets_at:null,resets_at_ms:null,tier:"",shared:!0,...i}),d=i=>({fetched_at:e,limits:[],notes:null,identity:null,consecutive_failures:0,usage_unavailable:!1,next_probe_at_ms:null,credential_invalid:!1,age_ms:0,state:"available",...i}),c=(i,l="cached")=>({reports:i,source:l,fetched_at:e}),L=()=>{},U=d({provider:"anthropic",identity:"damian@example.com",fetched_at:e-3e4,limits:[s({id:"five_hour",label:"5-hour",amount:r({used:62,limit:100,remaining:38,used_fraction:.62,unit:"percent"}),resets_at_ms:e+3*t+24*p,shared:!0}),s({id:"seven_day",label:"7-day",amount:r({used:88,limit:100,remaining:12,used_fraction:.88,unit:"percent"}),resets_at_ms:e+2*a+11*t,shared:!0}),s({id:"seven_day_opus",label:"7-day, Opus",amount:r({used:100,limit:100,remaining:0,used_fraction:1,unit:"percent"}),resets_at_ms:e+2*a+11*t,tier:"opus",shared:!1}),s({id:"seven_day_sonnet",label:"7-day, Sonnet",amount:r({used:41,limit:100,remaining:59,used_fraction:.41,unit:"percent"}),resets_at_ms:e+2*a+11*t,tier:"sonnet",shared:!1})]}),u=d({provider:"openrouter",identity:"sk-or-…f3a1",fetched_at:e-45e3,limits:[s({id:"credits",label:"Credits",amount:r({used:12.4,limit:40,unit:"usd"}),shared:!0})]}),T=d({provider:"openai",identity:"damian@example.com",fetched_at:e-2e4,limits:[s({id:"primary",label:"Weekly",amount:r({used:37,limit:100,remaining:63,used_fraction:.37,unit:"percent"}),resets_at_ms:e+4*a,shared:!0}),s({id:"secondary",label:"Weekly, reasoning",amount:r({used:91,limit:100,remaining:9,used_fraction:.91,unit:"percent"}),resets_at_ms:e+4*a,tier:"o-series",shared:!1})]}),R=d({provider:"deepseek",identity:"sk-…9c2b",fetched_at:e-6e4,limits:[s({id:"balance",label:"Balance",amount:r({remaining:519.86,unit:"usd"}),shared:!0})]}),n=(i,l,W,Pe,je=l,D="")=>s({id:i,label:l,window:je,tier:D,amount:r({used:W,limit:100,remaining:100-W,used_fraction:W/100,unit:"percent"}),resets_at_ms:Pe,shared:D===""}),m=(i,l)=>d({provider:"anthropic",identity:i,fetched_at:e-45e3,limits:l}),ia={title:"chat-usage",component:Ke,parameters:{layout:"centered"}},o={onClose:L,onFetchLive:L,now:e},h={args:{...o,payload:c([U,T,u,R])}},y={args:{...o,payload:c([T])}},g={args:{...o,payload:c([R])}},_={args:{...o,payload:null,loading:!0,fetching:!0}},f={args:{...o,payload:c([])}},b={args:{...o,payload:null,error:"This backend does not support the requested desktop control. Update the backend and try again."}},w={args:{...o,payload:c([U,u]),fetching:!0,asked:!0}},v={args:{...o,payload:c([d({...U,fetched_at:e-40*p,age_ms:40*p}),u])}},O={args:{...o,payload:c([d({provider:"kimi",identity:"damian@example.com",fetched_at:e-2*t,age_ms:2*t,usage_unavailable:!0,consecutive_failures:4,next_probe_at_ms:e+15*p,state:"unavailable",limits:[s({id:"coding_plan",label:"Coding plan",amount:r({used:94,limit:100,remaining:6,used_fraction:.94,unit:"percent"}),resets_at_ms:e+6*t,shared:!0})]}),u])}},k={args:{...o,payload:c([d({provider:"xai",identity:"damian@example.com",fetched_at:e-2*a,age_ms:2*a,credential_invalid:!0,usage_unavailable:!0,consecutive_failures:9,state:"reauth_required",limits:[s({id:"credits",label:"Credits",amount:r({used:100,limit:100,remaining:0,used_fraction:1,unit:"percent"}),shared:!0})]}),u])}},x={args:{...o,payload:c([d({provider:"mistral",identity:"sk-…7d14",limits:[s({id:"monthly",label:"Monthly",amount:r({unit:"unknown"})}),s({id:"requests",label:"Requests",amount:r({limit:1e5,unit:"requests"})})]}),u])}},N={args:{...o,payload:c([m("team@example.com",[n("five_hour","5 hour",62,e+3*t+24*p),n("seven_day","7 day",88,e+2*a+11*t),n("seven_day_opus","7 day (Opus)",100,e+2*a+11*t,"7 day","opus")]),m("damian@example.com",[n("five_hour","5 hour",12,e+4*t),n("seven_day","7 day",34,e+5*a+3*t),n("seven_day_opus","7 day (Opus)",3,e+5*a+3*t,"7 day","opus"),n("seven_day_sonnet","7 day (Sonnet)",9,e+5*a+3*t,"7 day","sonnet")]),m("ops@example.com",[n("five_hour","5 hour",95,e+41*p),n("seven_day","7 day",100,e+a+6*t),n("seven_day_sonnet","7 day (Sonnet)",41,e+a+6*t,"7 day","sonnet"),s({id:"extra_usage",label:"Extra usage",amount:r({used:3.2,limit:40,remaining:36.8,unit:"usd"}),window:"1 month",resets_at_ms:e+19*a,shared:!0})]),m("build@example.com",[n("five_hour","5 hour",8,e+2*t+10*p),n("seven_day","7 day",21,e+3*a+18*t),n("seven_day_opus","7 day (Opus)",73,e+3*a+18*t,"7 day","opus")]),m("lab@example.com",[n("five_hour","5 hour",44,e+80*p),n("seven_day","7 day",57,e+6*a+2*t),n("seven_day_opus","7 day (Opus)",66,e+6*a+2*t,"7 day","opus")]),T,d({provider:"zai",identity:"sk-…4417",fetched_at:e-9e4,limits:[n("tokens_7d","Token quota (7 day)",54,e+4*a,"7 day"),n("requests_30d","Request quota (30 day)",7,e+12*a,"30 day"),s({id:"zread_30d",label:"Zread quota (30 day)",amount:r({used:12,limit:100,remaining:88,used_fraction:.12,unit:"percent"}),window:"30 day",resets_at_ms:e+12*a,tier:"zread"})]}),d({provider:"kimi",identity:"damian@example.com",fetched_at:e-2*p,limits:[n("coding_5h","Coding plan (5 hour)",71,e+2*t),n("coding_7d","Coding plan (7 day)",94,e+a+9*t),s({id:"balance",label:"Balance (USD)",amount:r({remaining:63.5,unit:"usd"}),window:"lifetime",shared:!0})]}),d({provider:"xai",identity:"xai-…8e02",fetched_at:e-3*p,limits:[n("credits","Credits",26,e+9*a)]}),u,R])}},A={args:{...o,payload:c([U,R])}};var q,E,S,H,Y;h.parameters={...h.parameters,docs:{...(q=h.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([anthropic, openai, openrouter, deepseek])
  }
}`,...(S=(E=h.parameters)==null?void 0:E.docs)==null?void 0:S.source},description:{story:`The main case: four providers, eight windows, every status present.

This is the frame the column alignment and the shared/tier hierarchy are
judged on. Anthropic's Opus cap is at 100% while its binding window — the
account-wide 7-day — is at 88%, which is exactly the distinction the
binding rule exists to make: the account is near its limit, not dead.`,...(Y=(H=h.parameters)==null?void 0:H.docs)==null?void 0:Y.description}}};var C,M,I,z,B;y.parameters={...y.parameters,docs:{...(C=y.parameters)==null?void 0:C.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([openai])
  }
}`,...(I=(M=y.parameters)==null?void 0:M.docs)==null?void 0:I.source},description:{story:"A percent-only provider on its own, where no row carries a currency.",...(B=(z=y.parameters)==null?void 0:z.docs)==null?void 0:B.description}}};var F,P,j,K,Q;g.parameters={...g.parameters,docs:{...(F=g.parameters)==null?void 0:F.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([deepseek])
  }
}`,...(j=(P=g.parameters)==null?void 0:P.docs)==null?void 0:j.source},description:{story:'A remaining-only balance: a number, no fill, and the words "not reported".',...(Q=(K=g.parameters)==null?void 0:K.docs)==null?void 0:Q.description}}};var Z,V,G,J,X;_.parameters={..._.parameters,docs:{...(Z=_.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: null,
    loading: true,
    fetching: true
  }
}`,...(G=(V=_.parameters)==null?void 0:V.docs)==null?void 0:G.source},description:{story:"The first paint, before the cached report has come back.\n\n`fetching` is TRUE here, and that is not a detail. On a first load react-query\nreports `isLoading` and `isFetching` together, so the shipped container always\npasses both — an earlier version of this story left `fetching` at its `false`\ndefault and photographed `Ask providers now`, ENABLED, which is a toolbar\nstate the container cannot produce at first paint. An unreachable frame is\nworse than no frame, because loading is precisely the state a reviewer cannot\ncheck any other way.",...(X=(J=_.parameters)==null?void 0:J.docs)==null?void 0:X.description}}};var $,ee,ae,te,ne;f.parameters={...f.parameters,docs:{...($=f.parameters)==null?void 0:$.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([])
  }
}`,...(ae=(ee=f.parameters)==null?void 0:ee.docs)==null?void 0:ae.source},description:{story:"No provider publishes quota, or none is signed in.",...(ne=(te=f.parameters)==null?void 0:te.docs)==null?void 0:ne.description}}};var re,se,ie,oe,de;b.parameters={...b.parameters,docs:{...(re=b.parameters)==null?void 0:re.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: null,
    error: "This backend does not support the requested desktop control. Update the backend and try again."
  }
}`,...(ie=(se=b.parameters)==null?void 0:se.docs)==null?void 0:ie.source},description:{story:"The backend refused or could not be reached; the message is the backend's.",...(de=(oe=b.parameters)==null?void 0:oe.docs)==null?void 0:de.description}}};var ce,pe,ue,le,me;w.parameters={...w.parameters,docs:{...(ce=w.parameters)==null?void 0:ce.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([anthropic, openrouter]),
    fetching: true,
    asked: true
  }
}`,...(ue=(pe=w.parameters)==null?void 0:pe.docs)==null?void 0:ue.source},description:{story:"Live numbers have been asked for and the request is still out.\n\nThe cached numbers stay on screen throughout, which the container now really\nproduces: `live` is part of the query key, so asking starts a query with no\ncached entry, and `placeholderData: keepPreviousData` is what keeps the\nprevious payload rendering while it loads. Before that this frame was a\npicture of a state the shipped wiring could not reach — the real behaviour\nreplaced the whole table with the word `Loading` for the duration of the\nprobe. `loading` is left at `false` deliberately: with placeholder data in\nhand react-query reports `isLoading: false`, which is the combination the\ncontainer passes here.",...(me=(le=w.parameters)==null?void 0:le.docs)==null?void 0:me.description}}};var he,ye,ge,_e,fe;v.parameters={...v.parameters,docs:{...(he=v.parameters)==null?void 0:he.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([report({
      ...anthropic,
      fetched_at: NOW - 40 * MINUTE,
      age_ms: 40 * MINUTE
    }), openrouter])
  }
}`,...(ge=(ye=v.parameters)==null?void 0:ye.docs)==null?void 0:ge.source},description:{story:`A block the description's age does not speak for.

The background warmer only refreshes the ACTIVE provider, so an idle one is
supposed to be minutes old — this block is 40 minutes behind the response
stamp, which is past the cache's own freshness contract, so it says so and
its dots drop to the dim ramp. The fresh block beside it is unmarked.`,...(fe=(_e=v.parameters)==null?void 0:_e.docs)==null?void 0:fe.description}}};var be,we,ve,Oe,ke;O.parameters={...O.parameters,docs:{...(be=O.parameters)==null?void 0:be.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([report({
      provider: "kimi",
      identity: "damian@example.com",
      fetched_at: NOW - 2 * HOUR,
      age_ms: 2 * HOUR,
      usage_unavailable: true,
      consecutive_failures: 4,
      next_probe_at_ms: NOW + 15 * MINUTE,
      state: "unavailable",
      limits: [limit({
        id: "coding_plan",
        label: "Coding plan",
        amount: amount({
          used: 94,
          limit: 100,
          remaining: 6,
          used_fraction: 0.94,
          unit: "percent"
        }),
        resets_at_ms: NOW + 6 * HOUR,
        shared: true
      })]
    }), openrouter])
  }
}`,...(ve=(we=O.parameters)==null?void 0:we.docs)==null?void 0:ve.source},description:{story:`The probe is failing, and the last-known numbers keep rendering under the
note. A view that dropped them would answer "how much is left?" with
nothing, when it knows the answer as of two hours ago.`,...(ke=(Oe=O.parameters)==null?void 0:Oe.docs)==null?void 0:ke.description}}};var xe,Ne,Ae,Ue,Re;k.parameters={...k.parameters,docs:{...(xe=k.parameters)==null?void 0:xe.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([report({
      provider: "xai",
      identity: "damian@example.com",
      fetched_at: NOW - 2 * DAY,
      age_ms: 2 * DAY,
      credential_invalid: true,
      usage_unavailable: true,
      consecutive_failures: 9,
      state: "reauth_required",
      limits: [limit({
        id: "credits",
        label: "Credits",
        amount: amount({
          used: 100,
          limit: 100,
          remaining: 0,
          used_fraction: 1,
          unit: "percent"
        }),
        shared: true
      })]
    }), openrouter])
  }
}`,...(Ae=(Ne=k.parameters)==null?void 0:Ne.docs)==null?void 0:Ae.source},description:{story:"A dead OAuth grant — the one state here with a remedy the user can act on,\nso the note names the command instead of an age. `/login xai` is runnable\nexactly as printed.",...(Re=(Ue=k.parameters)==null?void 0:Ue.docs)==null?void 0:Re.description}}};var We,Te,De,Le,qe;x.parameters={...x.parameters,docs:{...(We=x.parameters)==null?void 0:We.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([report({
      provider: "mistral",
      identity: "sk-…7d14",
      limits: [limit({
        id: "monthly",
        label: "Monthly",
        amount: amount({
          unit: "unknown"
        })
      }), limit({
        id: "requests",
        label: "Requests",
        amount: amount({
          limit: 100000,
          unit: "requests"
        })
      })]
    }), openrouter])
  }
}`,...(De=(Te=x.parameters)==null?void 0:Te.docs)==null?void 0:De.source},description:{story:`A provider that answered with no numbers at all, beside one that has some.

The unmeasurable rows draw an outlined dot and a DOTTED rule — not a track at
zero, which would be a claim that nothing has been spent — and the toolbar
tally counts them as "not reported" rather than folding them into a healthy
count. The rule is on the \`ink-dim\` ramp: it is the entire distinction
between "reports nothing" and "at zero", which makes it structural and puts
it on the 3:1 floor that \`ink-disabled\` is exempt from.`,...(qe=(Le=x.parameters)==null?void 0:Le.docs)==null?void 0:qe.description}}};var Ee,Se,He,Ye,Ce;N.parameters={...N.parameters,docs:{...(Ee=N.parameters)==null?void 0:Ee.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([anthropicAccount("team@example.com", [percentLimit("five_hour", "5 hour", 62, NOW + 3 * HOUR + 24 * MINUTE), percentLimit("seven_day", "7 day", 88, NOW + 2 * DAY + 11 * HOUR), percentLimit("seven_day_opus", "7 day (Opus)", 100, NOW + 2 * DAY + 11 * HOUR, "7 day", "opus")]), anthropicAccount("damian@example.com", [percentLimit("five_hour", "5 hour", 12, NOW + 4 * HOUR), percentLimit("seven_day", "7 day", 34, NOW + 5 * DAY + 3 * HOUR), percentLimit("seven_day_opus", "7 day (Opus)", 3, NOW + 5 * DAY + 3 * HOUR, "7 day", "opus"), percentLimit("seven_day_sonnet", "7 day (Sonnet)", 9, NOW + 5 * DAY + 3 * HOUR, "7 day", "sonnet")]), anthropicAccount("ops@example.com", [percentLimit("five_hour", "5 hour", 95, NOW + 41 * MINUTE), percentLimit("seven_day", "7 day", 100, NOW + DAY + 6 * HOUR), percentLimit("seven_day_sonnet", "7 day (Sonnet)", 41, NOW + DAY + 6 * HOUR, "7 day", "sonnet"),
    // The pay-as-you-go meter that tops up an exhausted plan; the
    // real fetcher reports it only when the account has it enabled.
    limit({
      id: "extra_usage",
      label: "Extra usage",
      amount: amount({
        used: 3.2,
        limit: 40,
        remaining: 36.8,
        unit: "usd"
      }),
      window: "1 month",
      resets_at_ms: NOW + 19 * DAY,
      shared: true
    })]), anthropicAccount("build@example.com", [percentLimit("five_hour", "5 hour", 8, NOW + 2 * HOUR + 10 * MINUTE), percentLimit("seven_day", "7 day", 21, NOW + 3 * DAY + 18 * HOUR), percentLimit("seven_day_opus", "7 day (Opus)", 73, NOW + 3 * DAY + 18 * HOUR, "7 day", "opus")]), anthropicAccount("lab@example.com", [percentLimit("five_hour", "5 hour", 44, NOW + 80 * MINUTE), percentLimit("seven_day", "7 day", 57, NOW + 6 * DAY + 2 * HOUR), percentLimit("seven_day_opus", "7 day (Opus)", 66, NOW + 6 * DAY + 2 * HOUR, "7 day", "opus")]), openai, report({
      provider: "zai",
      identity: "sk-…4417",
      fetched_at: NOW - 90_000,
      limits: [percentLimit("tokens_7d", "Token quota (7 day)", 54, NOW + 4 * DAY, "7 day"), percentLimit("requests_30d", "Request quota (30 day)", 7, NOW + 12 * DAY, "30 day"), limit({
        id: "zread_30d",
        label: "Zread quota (30 day)",
        amount: amount({
          used: 12,
          limit: 100,
          remaining: 88,
          used_fraction: 0.12,
          unit: "percent"
        }),
        window: "30 day",
        resets_at_ms: NOW + 12 * DAY,
        tier: "zread"
      })]
    }), report({
      provider: "kimi",
      identity: "damian@example.com",
      fetched_at: NOW - 2 * MINUTE,
      limits: [percentLimit("coding_5h", "Coding plan (5 hour)", 71, NOW + 2 * HOUR), percentLimit("coding_7d", "Coding plan (7 day)", 94, NOW + DAY + 9 * HOUR), limit({
        id: "balance",
        label: "Balance (USD)",
        amount: amount({
          remaining: 63.5,
          unit: "usd"
        }),
        window: "lifetime",
        shared: true
      })]
    }), report({
      provider: "xai",
      identity: "xai-…8e02",
      fetched_at: NOW - 3 * MINUTE,
      limits: [percentLimit("credits", "Credits", 26, NOW + 9 * DAY)]
    }), openrouter, deepseek])
  }
}`,...(He=(Se=N.parameters)==null?void 0:Se.docs)==null?void 0:He.source},description:{story:`Real-account density: the one state where the body overflows its scroll box.

The committed \`real-data/\` frames are the only other evidence at this
density and they cannot be re-derived on demand — they need the local
backend to return its cached reports, which it only does while its
credentials can reach every provider's quota endpoint. This story is the
same density built from fixtures, so the sweep can always re-take it: eleven
reports and twenty-eight windows, which is the shape the machine's live
response actually had (five of the eleven are \`anthropic\`, because one
provider can hold several signed-in accounts — the multi-account case the
React key \`provider:identity\` exists for).

Every label, unit and window name is a real fetcher's own (\`usage.py\`), and
the identities are the shape-preserving stand-ins the real-data capture
redacts to, so the row heights are the heights the real frame photographs.
The status mix is a working machine's, not a demo of every colour: mostly
ok, four near limit, one dead weekly window, two remaining-only balances.

This is the frame the scroll fold is judged on. Captured at 1100x1000 —
\`real-data\`'s own viewport — where the body cap \`min(60vh,520px)\` bottoms
out at 520px against roughly 1300px of content, so the fold is deep and
unambiguous rather than a row or two of overhang. What must hold, per the
design finding it answers (D4): the cut at the bottom is a 20px FADE, not a
hard clip through a row's glyphs; a \`border-control\` rule closes the body
while it scrolls; and — the half of the finding the non-overflowing stories
prove — nothing of the sort is drawn by the states whose content fits.`,...(Ce=(Ye=N.parameters)==null?void 0:Ye.docs)==null?void 0:Ce.description}}};var Me,Ie,ze,Be,Fe;A.parameters={...A.parameters,docs:{...(Me=A.parameters)==null?void 0:Me.docs,source:{originalSource:`{
  args: {
    ...base,
    payload: payload([anthropic, deepseek])
  }
}`,...(ze=(Ie=A.parameters)==null?void 0:Ie.docs)==null?void 0:ze.source},description:{story:`The dialog in a narrow frame.

Captured at a 720px viewport (\`scripts/capture-evidence.mjs\`) rather than
wrapped in a narrow div: the dialog is portal-rendered and viewport-fixed,
so a wrapper constrains nothing and the frame would be a picture of the wide
layout under a false name. The bar is a redundant picture of a number
already on the row, so it is what a narrow frame takes space from first;
the label truncates rather than pushing the numbers off the row, because it
is the one column a reader can still identify from a prefix.`,...(Fe=(Be=A.parameters)==null?void 0:Be.docs)==null?void 0:Fe.description}}};const oa=["MultiProvider","PercentOnly","RemainingBalance","Loading","Empty","QueryError","Fetching","StaleReport","UnavailableWithLastKnown","ReauthRequired","NotReported","Dense","Narrow"];export{N as Dense,f as Empty,w as Fetching,_ as Loading,h as MultiProvider,A as Narrow,x as NotReported,y as PercentOnly,b as QueryError,k as ReauthRequired,g as RemainingBalance,v as StaleReport,O as UnavailableWithLastKnown,oa as __namedExportsOrder,ia as default};
