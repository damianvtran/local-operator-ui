// Compose the delta keys with real arguments through intl-messageformat, per locale.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { IntlMessageFormat } = require("intl-messageformat");
const d = "src/i18n/catalogues";
const L = (l) => JSON.parse(readFileSync(`${d}/${l}/ui.teamBridge.json`, "utf8"));
const show = (s) => s.replace(/\u202F/g, "⟨NNBSP⟩");
const f = (l, k, a = {}) => show(new IntlMessageFormat(L(l)[`ui.teamBridge.members_panel.${k}`], l).format(a));
for (const l of ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
  for (const n of [0, 1, 2, 5, 21, 1000000]) console.log(`${l} open_label n=${n}:`, f(l, "open_label", { count: n }));
  for (const [a, i] of [[1, 1], [3, 2], [5, 1]]) console.log(`${l} open_label_invited ${a}/${i}:`, f(l, "open_label_invited", { active: a, invited: i }));
  console.log(`${l} remove_title:`, f(l, "confirm.remove_title", { name: "Aida", conversation: "#qa-coordination" }));
  console.log(`${l} leave_title:`, f(l, "confirm.leave_title", { conversation: "#qa-coordination" }));
  console.log(`${l} decline_label:`, f(l, "decline_label", { name: "Aida" }));
  console.log(`${l} decline_title:`, f(l, "confirm.decline_title", { name: "Aida" }));
  console.log(`${l} decline_body:`, f(l, "confirm.decline_body", { name: "Aida", conversation: "#qa-coordination" }));
}
