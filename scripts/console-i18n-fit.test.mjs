/** Source-only contracts for the follow-up. These do NOT prove rendered geometry.
 * Kept dependency-free so the host's resource hold does not prevent checking the
 * localization lifecycle. Browser/real-xterm validation remains a separate gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const component = (name) =>
	readFileSync(
		`src/renderer/src/features/console/components/${name}.tsx`,
		"utf8",
	);
const messages = (locale) =>
	JSON.parse(
		readFileSync(`src/i18n/catalogues/${locale}/ui.console.json`, "utf8"),
	);

test("close cancellation is explicitly keyed in both catalogues", () => {
	assert.match(
		component("console-close-dialog"),
		/cancelText=\{t\("ui\.console\.close\.cancel"\)\}/,
	);
	assert.equal(messages("en")["ui.console.close.cancel"], "Cancel");
	assert.equal(messages("fr")["ui.console.close.cancel"], "Annuler");
});

test("locale subscription relabels an existing terminal without replacing output", () => {
	const source = component("console-mirror");
	const setup = source.slice(
		source.indexOf("Terminal.strings.promptLabel ="),
		source.indexOf("const term = new Terminal("),
	);
	const subscription = source.match(
		/const offLocale = subscribeLocale\(\(\) => \{([\s\S]*?)\n\t\t\}\);/,
	);
	assert.ok(
		subscription,
		"live terminals must subscribe, not just localize the next construction",
	);
	const Terminal = { strings: {} };
	let locale = "en";
	const t = (key) => messages(locale)[key];
	const attributes = new Map();
	const output = ["retained output"];
	const term = {
		textarea: { setAttribute: (key, value) => attributes.set(key, value) },
		output,
	};
	new Function("Terminal", "t", setup)(Terminal, t);
	assert.equal(Terminal.strings.promptLabel, "Terminal input");
	assert.equal(
		Terminal.strings.tooMuchOutput,
		"Too much output to announce, navigate to rows manually to read",
	);
	const update = new Function("Terminal", "t", "term", subscription[1]);
	for (locale of ["fr", "en"]) {
		update(Terminal, t, term);
		assert.equal(
			attributes.get("aria-label"),
			t("ui.console.terminal.prompt_label"),
		);
		assert.equal(
			Terminal.strings.tooMuchOutput,
			t("ui.console.terminal.too_much_output"),
		);
		assert.equal(term.output, output);
	}
	assert.doesNotMatch(
		subscription[1],
		/new Terminal|\.dispose\(|\.reset\(|\.clear\(/,
	);
	assert.match(source, /return \(\) => \{\s*offLocale\(\);/);
	assert.match(
		source,
		/\}, \[constructionMode\]\);/,
		"locale (and a mode transition) must not recreate the terminal effect",
	);
});

test("header reserves command cells while only summary text yields", () => {
	const source = component("console-pane");
	assert.match(source, /min-w-\[3ch\] max-w-\[40%\] shrink-0/);
	assert.match(source, /min-w-\[3ch\] truncate text-ink-muted text-mono-sm/);
	assert.match(source, /flex min-w-0 flex-1 items-center justify-end gap-1/);
	assert.match(source, /min-w-0 shrink whitespace-nowrap px-1 text-xs/);
	assert.match(source, /aria-label=\{capacityDescription\}/);
	assert.match(source, /<span className="min-w-0 truncate">/);
	assert.equal(
		(source.match(/\$\{capacityDescription\}\. /g) ?? []).length,
		2,
		"both tooltip branches must retain the complete summary",
	);
	const description = source.slice(
		source.indexOf("const capacityDescription"),
		source.indexOf("const capacityDescription") + 400,
	);
	for (const key of ["summary", "archived", "full"])
		assert.ok(description.includes(`ui.console.capacity.${key}`));
});

test("onboarding footer actions can wrap instead of escaping their lane", () => {
	const source = readFileSync(
		"src/renderer/src/features/onboarding/components/onboarding-modal.tsx",
		"utf8",
	);
	assert.match(
		source,
		/className="flex flex-wrap items-center justify-end gap-3"/,
	);
});
