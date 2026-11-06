// Compose the round-2 delta keys through intl-messageformat with the argument the
// renderer passes: isolateLtr("#<builtin>") -> LRI..PDI under ur, bare otherwise.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { IntlMessageFormat } = require("intl-messageformat");
const d = "src/i18n/catalogues";
const L = (l) => JSON.parse(readFileSync(`${d}/${l}/ui.teamBridge.json`, "utf8"));
const show = (s) => s.replace(/\u202F/g, "⟨NNBSP⟩").replace(/\u2066/g, "⟨LRI⟩").replace(/\u2069/g, "⟨PDI⟩");
for (const l of ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
  const c = L(l);
  const f = (k, a) => show(new IntlMessageFormat(c[`ui.teamBridge.members_panel.${k}`], l).format(a));
  for (const k of ["confirm.remove_body", "confirm.remove_invited_body", "confirm.leave_body"]) console.log(`${l} ${k}:`, f(k, {}));
  for (const n of ["general", "humans", "agents"]) console.log(`${l} note.${n}:`, f(`note.${n}`, { channel: l === "ur" ? `\u2066#${n}\u2069` : `#${n}` }));
}
