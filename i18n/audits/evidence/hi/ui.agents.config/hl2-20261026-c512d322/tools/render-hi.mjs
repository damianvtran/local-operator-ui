// Compose the hi catalogue strings that carry placeholders, through the SAME ICU
// runtime the renderer uses (intl-messageformat 12), with the hi catalogue's own
// age messages feeding {when}. Read-only: loads JSON, prints, writes nothing.
import { createRequire } from "node:module";
import fs from "node:fs";

const REPO = "/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2";
const require = createRequire("/Users/damian/local-operator-ui/package.json");
const { IntlMessageFormat } = require("intl-messageformat");

const cat = (ns) =>
  JSON.parse(fs.readFileSync(`${REPO}/i18n-catalogues/${ns}.json`, "utf8"));
const load = (ns) =>
  JSON.parse(fs.readFileSync(`${REPO}/src/i18n/catalogues/hi/${ns}.json`, "utf8"));

const hub = load("ui.hub.pages");
const comments = JSON.parse(
  fs.readFileSync(`${REPO}/src/i18n/catalogues/hi/ui.hub.comments.json`, "utf8"),
);
const teams = load("ui.hub.teams");
const agentsPages = load("ui.agents.pages");
const agentsConfig = load("ui.agents.config");
const agentsDetail = load("ui.agents.detail");
const agentsUpload = load("ui.agents.upload");
const commonActions = load("ui.common.actions");

const fmt = (msg, params) =>
  new IntlMessageFormat(msg, "hi").format(params ?? {});

const ages = {
  "0 सेकंड": fmt(comments["ui.hub.comments.age.seconds"], { count: 0 }),
  "1 सेकंड": fmt(comments["ui.hub.comments.age.seconds"], { count: 1 }),
  "5 मिनट": fmt(comments["ui.hub.comments.age.minutes"], { count: 5 }),
  "3 दिन": fmt(comments["ui.hub.comments.age.days"], { count: 3 }),
  "1 दिन": fmt(comments["ui.hub.comments.age.days"], { count: 1 }),
  "2 महीने": fmt(comments["ui.hub.comments.age.months"], { count: 2 }),
  "1 साल": fmt(comments["ui.hub.comments.age.years"], { count: 1 }),
};

const out = [];
const line = (k, s) => out.push(`${k}\n    ${s}`);

out.push("== age phrases the {when} slot receives (hi, ICU via intl-messageformat) ==");
for (const [n, v] of Object.entries(ages)) out.push(`  ${n.padEnd(10)} -> ${v}`);

out.push("\n== hub card provenance line:  {author} · t(card.updated, {when}) ==");
for (const [n, w] of Object.entries(ages)) {
  line(`card.updated  [${n}]`, `Damian Tran · ${fmt(hub["ui.hub.pages.card.updated"], { when: w })}`);
}
line("card.updated  [long author]", `Priya Raghunathan-Wentworth · ${fmt(hub["ui.hub.pages.card.updated"], { when: ages["3 दिन"] })}`);

out.push("\n== org team row: project · author · recency ==");
for (const [n, w] of Object.entries(ages)) {
  line(`recency.updated [${n}]`, `Minerva Platform · Damian Tran · ${fmt(teams["ui.hub.teams.recency.updated"], { when: w })}`);
  line(`recency.created [${n}]`, `Minerva Platform · Damian Tran · ${fmt(teams["ui.hub.teams.recency.created"], { when: w })}`);
}

out.push("\n== composer placeholder: about {name} ==");
for (const name of ["Code Reviewer", "Enterprise Security Compliance Reviewer", "कोड समीक्षक", "Acme Financial Services (India) Pvt. Ltd."]) {
  line("placeholder.about", fmt(agentsConfig["ui.agents.config.placeholder.about"], { name }));
}
line("placeholder.docked", fmt(agentsConfig["ui.agents.config.placeholder.docked"]));
line("placeholder.hero", fmt(agentsConfig["ui.agents.config.placeholder.hero"]));

out.push("\n== publish dialog titles: {name} + {destination} ==");
for (const [name, dest] of [
  ["Code Reviewer", "Acme Corp"],
  ["Enterprise Security Compliance Reviewer", "Acme Financial Services (India) Pvt. Ltd."],
  ["कोड समीक्षक", "मिनर्वा टीम"],
]) {
  line("publish_org", fmt(agentsUpload["ui.agents.upload.title.publish_org"], { name, destination: dest }));
}
line("published_org", fmt(agentsUpload["ui.agents.upload.title.published_org"], { name: "Code Reviewer", destination: "Acme Corp" }));
line("publish_public", fmt(agentsUpload["ui.agents.upload.title.publish_public"], { name: "Code Reviewer" }));
line("published_public", fmt(agentsUpload["ui.agents.upload.title.published_public"], { name: "Code Reviewer" }));
line("republished", fmt(agentsUpload["ui.agents.upload.title.republished"], { name: "Code Reviewer" }));
line("update_listing", fmt(agentsUpload["ui.agents.upload.title.update_listing"], { name: "Code Reviewer" }));

out.push("\n== bare strings, in UI context ==");
line("add_manual.agent", `[घंटी बटन] ${agentsPages["ui.agents.pages.add_manual.agent"]}`);
line("add_manual.team", `[घंटी बटन] ${agentsPages["ui.agents.pages.add_manual.team"]}`);
line("ask.heading_agent", `[h2] ${agentsPages["ui.agents.pages.ask.heading_agent"]}`);
line("ask.heading_team", `[h2] ${agentsPages["ui.agents.pages.ask.heading_team"]}`);
line("ask.manual_agent", `[लिंक] ${agentsPages["ui.agents.pages.ask.manual_agent"]}`);
line("ask.manual_team", `[लिंक] ${agentsPages["ui.agents.pages.ask.manual_team"]}`);
line("meta.delegates", `हब · ${agentsDetail["ui.agents.detail.meta.delegates"]} · Specialist`);
line("read.show_all", `[लिंक] ${agentsDetail["ui.agents.detail.read.show_all"]}`);
line("read.show_less", `[लिंक] ${agentsDetail["ui.agents.detail.read.show_less"]}`);
line("card.get", `[डाउनलोड आइकन के साथ छोटा बटन] ${hub["ui.hub.pages.card.get"]}`);
line("retrying", `[बटन, aria-busy] ${commonActions["ui.common.actions.retrying"]}`);
line("retry_again (shipped sibling)", `[बटन] ${commonActions["ui.common.actions.retry_again"]}`);
line("ask.body_agent", agentsPages["ui.agents.pages.ask.body_agent"]);
line("ask.body_team", agentsPages["ui.agents.pages.ask.body_team"]);

out.push("\n== lengths (chars) ==");
const pairs = [
  ["ui.agents.pages.add_manual.agent", "Add agent manually"],
  ["ui.agents.pages.add_manual.team", "Add team manually"],
  ["ui.agents.pages.ask.heading_agent", "Ask for an agent"],
  ["ui.agents.pages.ask.manual_agent", "Or add an agent by hand"],
  ["ui.agents.pages.ask.body_agent", null],
  ["ui.hub.pages.card.get", "Get"],
  ["ui.common.actions.retrying", "Trying…"],
];
const srcEn = (ns) => JSON.parse(fs.readFileSync(`${REPO}/src/i18n/catalogues/en/${ns}.json`, "utf8"));
const allHi = { ...agentsPages, ...agentsConfig, ...agentsDetail, ...agentsUpload, ...hub, ...teams, ...commonActions };
for (const [k, enLiteral] of pairs) {
  const hi = allHi[k];
  let en = enLiteral;
  if (!en) {
    for (const ns of ["ui.agents.pages"]) en = srcEn(ns)[k] ?? en;
  }
  out.push(`  ${k.padEnd(42)} en=${String(en.length).padStart(3)}  hi=${String(hi.length).padStart(3)}`);
}
out.push(`  ${"ask.body_agent".padEnd(42)} en=160  hi=${agentsPages["ui.agents.pages.ask.body_agent"].length}`);
out.push(`  ${"ask.body_team".padEnd(42)} en=${srcEn("ui.agents.pages")["ui.agents.pages.ask.body_team"].length}  hi=${agentsPages["ui.agents.pages.ask.body_team"].length}`);

console.log(out.join("\n"));
