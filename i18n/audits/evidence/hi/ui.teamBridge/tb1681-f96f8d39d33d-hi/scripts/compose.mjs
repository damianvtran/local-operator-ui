// Compose the conversation_menu delta keys with real arguments through intl-messageformat, per locale.
// Arguments mirror the renderer: {channel} arrives as isolateLtr("#general"/"#agents") (U+2066..U+2069),
// {conversation} is a channel name, a group title or a DM name, {name} the reader's own agent's label.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { IntlMessageFormat } = require("intl-messageformat");
const d = "src/i18n/catalogues";
const L = (l) => JSON.parse(readFileSync(`${d}/${l}/ui.teamBridge.json`, "utf8"));
const show = (s) => s.replace(/\u202F/g, "⟨NNBSP⟩").replace(/\u2066/g, "⟨LRI⟩").replace(/\u2069/g, "⟨PDI⟩");
const iso = (s) => `\u2066${s}\u2069`;
const args = { name: "Aida", conversation: "qa-coordination", channel: iso("#general") };
for (const l of ["en", "es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
  const c = L(l);
  for (const k of Object.keys(c).filter((k) => k.includes(".conversation_menu."))) {
    const a = k.endsWith("agents_builtin") ? { ...args, channel: iso("#agents") } : args;
    console.log(`${l} ${k.slice(31)}:`, show(new IntlMessageFormat(c[k], l).format(a)));
  }
}
