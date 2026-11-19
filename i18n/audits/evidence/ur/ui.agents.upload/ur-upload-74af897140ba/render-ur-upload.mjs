/**
 * Exercise the SHIPPING path for the 15 audited ur keys: bundle the real
 * src/i18n/messages + locale modules (the same technique
 * scripts/i18n/ur-activation.test.mjs uses), switch to `ur`, and call the real
 * `t()` with plausible params. Prints, per key, the rendered string with every
 * bidi control spelled as <U+XXXX>, so the audit can state which controls the
 * runtime adds (U+2068/U+2069 around a Latin-led value) and which it never
 * adds (U+200E/U+200F/U+061C/U+202A-U+202E/U+2066/U+2067 — none).
 */
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: ['export * as messages from "./src/i18n/messages";', 'export * as locale from "./src/i18n/locale";'].join("\n"),
		resolveDir: new URL("./", import.meta.url).pathname.includes(".worktrees")
			? process.cwd() + "/"
			: process.cwd() + "/",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { messages, locale } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const CONTROL = /[\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;
const spell = (text) =>
	text.replace(CONTROL, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}>`);

const name = "fleet-ops";
const destination = "Acme Corp";
const CASES = [
	["ui.agents.upload.action.publish", {}],
	["ui.agents.upload.action.publishing", {}],
	["ui.agents.upload.action.update_listing", {}],
	["ui.agents.upload.availability.reserved_named", { name }],
	["ui.agents.upload.availability.reserved_unnamed", {}],
	["ui.agents.upload.intro.org", { destination }],
	["ui.agents.upload.intro.public", {}],
	["ui.agents.upload.not_leaving.org", { destination }],
	["ui.agents.upload.not_leaving.public", {}],
	["ui.agents.upload.published.org_listed", { name, destination }],
	["ui.agents.upload.receipt.title_hub", {}],
	["ui.agents.upload.receipt.title_org", { destination }],
	["ui.agents.upload.receipt.title_updated", {}],
	["ui.agents.upload.target.blocked_hint", { count: 1, org: destination }],
	["ui.agents.upload.target.blocked_hint", { count: 3, org: destination }],
	["ui.agents.upload.target.visibility_hint_public", {}],
	["ui.agents.upload.title.publish_public", { name }],
	["ui.agents.upload.title.publish_org", { name, destination }],
	["ui.agents.upload.title.published_public", { name }],
	["ui.agents.upload.title.published_org", { name, destination }],
	["ui.agents.upload.title.republished", { name }],
	["ui.agents.upload.title.update_listing", { name }],
];

locale.setLocale("ur");
let missing = 0;
const controlsSeen = new Set();
for (const [key, params] of CASES) {
	const rendered = messages.t(key, params);
	if (rendered === key) missing++;
	for (const c of rendered.match(CONTROL) ?? []) controlsSeen.add(c.codePointAt(0));
	console.log(`${key}${params.count ? ` (count=${params.count})` : ""}`);
	console.log(`  rendered: ${spell(rendered)}`);
}
console.log(`\nkeys that echoed their own key back (missing message): ${missing}`);
console.log(
	`control codepoints the runtime emitted: ${[...controlsSeen].map((c) => `U+${c.toString(16).toUpperCase()}`).join(", ") || "none"}`,
);
console.log(
	`forbidden-in-output (LRM/RLM/ALM/202A-202E/LRI/RLI): ${[...controlsSeen].filter((c) => c !== 0x2068 && c !== 0x2069).length}`,
);
locale.setLocale("en");
