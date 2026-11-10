import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(`${process.cwd()}/package.json`);
const { IntlMessageFormat } = await import(require.resolve("intl-messageformat"));
const base = "2b72db6a56a";
const path = "src/i18n/catalogues/ru/ui.agents.upload.json";
const ru = JSON.parse(readFileSync(path, "utf8"));
const old = JSON.parse(execFileSync("git", ["show", `${base}:${path}`], {encoding:"utf8"}));
const hubPath = "src/i18n/catalogues/ru/ui.hub.json";
const hub = JSON.parse(readFileSync(hubPath,"utf8"));
assert.equal(execFileSync("git", ["diff", base, "269ef259c05", "--", hubPath], {encoding:"utf8"}), "");
const fmt = (msg, vars) => new IntlMessageFormat(msg, "ru").format(vars);
const key = "ui.agents.upload.target.blocked_hint";
assert.deepEqual(Object.keys(ru).filter(k => !(k in old)), ["ui.agents.upload.target.org_unnamed"]);
assert.deepEqual(Object.keys(old).filter(k => old[k] !== ru[k]), [key]);
assert.equal(Object.keys(old).length, 46);
assert.equal(Object.keys(ru).length, 47);
console.log("PASS drift: exactly blocked_hint modified; exactly org_unnamed added; 45 other ru values unchanged; ru ui.hub.json unchanged.");
for (const count of [1,2,5,21,31,101,1.5]) {
  const vars = {count, org: "этой организации"};
  const before = fmt(old[key],vars);
  const after = fmt(ru[key],vars);
  assert.ok(after.includes(count === 1 ? "Владелец этой организации" : "Владелец любой из отмеченных выше организаций"));
  assert.ok(!/\d/.test(after));
  console.log(`\ncount=${count} CLDR=${new Intl.PluralRules("ru").select(count)}\nBEFORE: ${before}\nAFTER:  ${after}`);
}
const unnamed = ru["ui.agents.upload.target.org_unnamed"];
assert.equal(unnamed, "без названия");
const keys = ["intro.org","not_leaving.org","title.published_org","receipt.title_org","published.org_listed","title.publish_org"].map(k=>`ui.agents.upload.${k}`);
for (const k of keys) {
  console.log(`\nFRAME ${k}`);
  for (const destination of ["this organization", unnamed, "эту организацию"]) {
    console.log(`${destination}: ${fmt(ru[k], {destination,name:"Помощник"})}`);
  }
}
const seventh = "ui.hub.subscriptions.enable_private";
console.log(`\nFRAME ${seventh} (hypothetical confirmation; upload disables auto-push)`);
for (const organization of ["this organization", unnamed, "эту организацию"]) {
  console.log(`${organization}: ${fmt(hub[seventh], {organization,item:"Помощник"})}`);
}
const component = readFileSync("src/renderer/src/features/agents/components/upload-agent-dialog.tsx","utf8");
const policy = readFileSync("src/renderer/src/features/agents/components/hub-initial-policy-fields.tsx","utf8");
assert.match(component, /organization=\{targetIsOrg \? targetDisplayName : null\}[\s\S]*?canEnableAutoPush=\{false\}/);
assert.match(policy, /const \[confirming, setConfirming\] = useState<string \| null>\(null\)/);
assert.match(policy, /else if \(canEnableAutoPush\) setConfirming\(destinationKey\)/);
assert.match(policy, /open=\{confirming !== null\}/);
console.log("\nPASS source gate: upload passes canEnableAutoPush=false; confirming starts null; opening is guarded by canEnableAutoPush; hypothetical seventh is not a reachable upload confirmation. This is source proof, not browser execution.");
console.log("PASS 7 consuming strings formatted; plural sweep asserted; no screenshot or live-app claim.");
