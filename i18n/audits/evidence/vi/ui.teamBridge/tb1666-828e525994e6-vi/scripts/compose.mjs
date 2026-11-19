import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { IntlMessageFormat } = require("intl-messageformat");
const d = "src/i18n/catalogues";
const L = (l) => JSON.parse(readFileSync(`${d}/${l}/ui.teamBridge.json`, "utf8"));
const show = (s) => s.replace(/\u202F/g, "⟨NNBSP⟩");
const f = (l, k, a = {}) => show(new IntlMessageFormat(L(l)[`ui.teamBridge.${k}`], l).format(a));
const fr = L("fr");
console.log("fr general_topic:", f("fr", "builtin.general_topic"));
for (const r of ["Aida (Ben Tran)", fr["ui.teamBridge.delivery.recipient_unnamed"].replace("{person}", "Ben Tran")])
  console.log("fr out_of_scope :", f("fr", "delivery.refused_out_of_scope", { recipient: r }));
console.log("vi general_topic:", f("vi", "builtin.general_topic"));
console.log("zh general_topic:", f("zh-CN", "builtin.general_topic"));
for (const n of [1, 3, 1234]) console.log(`zh n=${n}:`, f("zh-CN", "attachmentCard.list", { count: n }), "|", f("zh-CN", "fileCard.list", { count: n }), "|", f("zh-CN", "attachmentCard.bytes", { size: n * 1000 }));
