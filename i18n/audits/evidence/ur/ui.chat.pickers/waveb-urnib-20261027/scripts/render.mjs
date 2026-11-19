/**
 * Real formatter render for the ur nib delta (ui.chat.pickers.slash.enter_needs_a_pick).
 *
 * Uses the repo's OWN runtime libraries, resolved from the worktree's node_modules:
 *   - `intl-messageformat`      — what src/i18n/messages.ts `formatterFor()` constructs
 *                                 (`new IntlMessageFormat(message, locale)`), and
 *   - `@formatjs/icu-messageformat-parser` — the parser behind it, read directly so
 *     the AST (arguments / plural arms / tags) can be asserted rather than assumed.
 *
 * Renders the two lines the slash popup paints in ONE bordered strip
 * (src/renderer/src/features/chat/components/slash-commands.tsx:2258-2269:
 * `{footerText ? <p>{footerText}</p> : null}` then `{clickText ? <p>{clickText}</p> : null}`),
 * the second line through the same key family the component's clickFooter returns.
 *
 * No translation/MT service is involved: this only formats strings the catalogue
 * already holds.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { IntlMessageFormat } from "intl-messageformat";
import { parse } from "@formatjs/icu-messageformat-parser";

const WT = "/Users/damian/local-operator-ui/.worktrees/wave-b-bind";
const UR = `${WT}/src/i18n/catalogues/ur/ui.chat.pickers.json`;
const EN = `${WT}/src/i18n/catalogues/en/ui.chat.pickers.json`;

const urBytes = readFileSync(UR);
const ur = JSON.parse(urBytes.toString("utf8"));
const en = JSON.parse(readFileSync(EN, "utf8"));

const KEY = "ui.chat.pickers.slash.enter_needs_a_pick";
const CLICK_KEYS = [
	"ui.chat.pickers.slash.click.stages",
	"ui.chat.pickers.slash.click.runs",
	"ui.chat.pickers.slash.click.completes_label",
	"ui.chat.pickers.slash.click.runs_with_value",
	"ui.chat.pickers.slash.click.runs_command",
];

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function astSummary(message) {
	const ast = parse(message);
	const kinds = ast.map((n) => n.type);
	const args = [];
	const walk = (nodes) => {
		for (const n of nodes) {
			if (n.type === 1 || n.type === 2) args.push(n.value); // argument / number
			if (n.type === 5 && n.value) args.push(n.value); // plural/select
			if (Array.isArray(n.options)) for (const o of Object.values(n.options)) walk(o.value);
			if (Array.isArray(n.children)) walk(n.children);
		}
	};
	walk(ast);
	return { node_types: kinds, arguments: [...new Set(args)] };
}

function render(message, locale, values = {}) {
	const f = new IntlMessageFormat(message, locale);
	return f.format(values);
}

// Sample values for the click family's machine-text placeholders: a real command
// name as the catalogue carries it ({label} has no leading slash), its command
// form and one argument, matching the call sites' own spellings.
const CLICK_VALUES = { label: "help", command: "/team", value: " engineering" };

const value = ur[KEY];
const rendered = render(value, "ur");
const enValue = en[KEY];
const enRendered = render(enValue, "en");

const out = {
	tool: "intl-messageformat (repo node_modules, v" + JSON.parse(readFileSync(`${WT}/node_modules/.pnpm/intl-messageformat@12.1.3/node_modules/intl-messageformat/package.json`, "utf8")).version + ")",
	locale: "ur",
	file: "src/i18n/catalogues/ur/ui.chat.pickers.json",
	ur_sha256_on_disk: createHash("sha256").update(urBytes).digest("hex"),
	key_count: Object.keys(ur).length,
	key: KEY,
	value,
	value_sha256: sha256(value),
	value_codepoints_tail: [...value.slice(-4)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")),
	ast_ur: astSummary(value),
	ast_en: astSummary(enValue),
	rendered_identical_to_value: rendered === value,
	rendered,
	en_value: enValue,
	en_rendered: enRendered,
	// The strip, line by line, exactly as the component paints it (two block <p>s).
	strip_lines: [
		{ line: 1, role: "footerText (Enter's meaning)", key: KEY, rendered },
		...CLICK_KEYS.map((k) => ({ line: 2, role: "clickText (the pointer's meaning)", key: k, rendered: render(ur[k], "ur", CLICK_VALUES) })),
	],
	stop_present_on_every_strip_line: [rendered, ...CLICK_KEYS.map((k) => render(ur[k], "ur", CLICK_VALUES))].every((s) => s.endsWith("\u06D4")),
	click_values_used: CLICK_VALUES,
};

console.log(JSON.stringify(out, null, 1));
