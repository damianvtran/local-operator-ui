import { readFileSync } from "node:fs";
const { IntlMessageFormat } = await import("/Users/damian/local-operator-ui/.worktrees/i18n-s4/node_modules/intl-messageformat/index.js");
const ru = JSON.parse(readFileSync("/Users/damian/local-operator-ui/.worktrees/i18n-s4/src/i18n/catalogues/ru/ui.agents.upload.json","utf8"));
const t = (k, v) => new IntlMessageFormat(ru[k], "ru").format(v);
const names = ["Acme Corp", "ООО «Ромашка»", "Служба поддержки"];
for (const n of names) {
  console.log("### destination = " + n);
  for (const k of ["ui.agents.upload.intro.org","ui.agents.upload.not_leaving.org","ui.agents.upload.published.org_listed","ui.agents.upload.receipt.title_org"]) {
    console.log("- " + k.replace("ui.agents.upload.","") + ": " + t(k, k.includes("org_listed") ? {name:"Release Crew", destination:n} : {destination:n}));
  }
  console.log();
}
console.log("### blocked_hint, named org, count sweep (CLDR ru categories)");
for (const c of [1,2,3,5,11,21,22,25,31,101]) {
  console.log(String(c).padStart(3) + " -> " + t("ui.agents.upload.target.blocked_hint", {count:c, org:"Acme Corp"}));
}
console.log("\n### blocked_hint, unnamed-org fallback (ui.hub.pages.scope.org_unnamed ru = 'этой организации')");
for (const c of [1,21]) console.log(String(c).padStart(3) + " -> " + t("ui.agents.upload.target.blocked_hint", {count:c, org:"этой организации"}));
