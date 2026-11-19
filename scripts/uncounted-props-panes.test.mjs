import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE RIGHT-SLOT PANE LABELS (resize handles, pane names, close controls) now
 * keyed. They were `label="Resize canvas. ..."`, `closeLabel="Close run
 * details"` and so on: props the scanner did not count.
 *
 * WHY THIS IS NOT A MOUNTED-COMPONENT TEST. `ChatContent` needs the canonical
 * stream and cannot be mounted in node (`ask-open-render.test.mjs` records the
 * same limit), so the call sites are pinned by SOURCE (comments stripped) and
 * the keys are resolved through the REAL runtime and the REAL shipped French
 * catalogue. What this proves: every label routes through its key, the key
 * resolves to the locale's value, and English stays character-identical. What
 * it does not: pixels, or that the divider paints the string (the divider
 * forwards `label` to `aria-label`, covered by its own suites).
 *
 * The negative control rewrites one call site back to its literal in the
 * source text and shows the pin goes red.
 */

const SOURCE = "src/renderer/src/features/chat/components/chat-content.tsx";
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/** [call-site fragment, key, English the literal carried]. */
const SITES = [
	[
		"resize_canvas",
		"Resize canvas. Double-click resets the shared pane width.",
	],
	[
		"resize_run_details",
		"Resize run details. Double-click resets the shared pane width.",
	],
	[
		"resize_browser",
		"Resize browser. Double-click resets the shared pane width.",
	],
	[
		"resize_console",
		"Resize console. Double-click resets the shared pane width.",
	],
	[
		"resize_code_review",
		"Resize code review. Double-click resets the shared pane width.",
	],
	["resize_asks", "Resize asks. Double-click resets the shared pane width."],
].map(([id, english]) => [
	`ui.common.layout.chat_layout.${id}_double_click_resets_the_shared_pane_width`,
	english,
]);
const OTHER = [
	["ui.chat.run_details.pane_label", "Run details"],
	["ui.chat.run_details.close_label", "Close run details"],
	["ui.code_review.code_review_pane.code_review", "Code review"],
	["ui.code_review.code_review_pane.close_code_review", "Close code review"],
];

const bundle = await build({
	stdin: {
		contents: 'export * as i18n from "./src/i18n";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { i18n } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const catalogue = (locale, file) =>
	JSON.parse(
		readFileSync(`src/i18n/catalogues/${locale}/${file}.json`, "utf8"),
	);

/** The pin: `source` uses `key` through `t(` and carries no `literal` prop value. */
function pinFailures(source, keys) {
	const stripped = source.replace(COMMENTS, "");
	const failures = [];
	for (const [key, english] of keys) {
		if (!stripped.includes(key)) failures.push(`${key} is not used`);
		if (stripped.includes(`"${english}"`))
			failures.push(`"${english}" is a literal again`);
	}
	return failures;
}

test("every pane label routes through a key, and no literal remains", () => {
	assert.deepEqual(
		pinFailures(readFileSync(SOURCE, "utf8"), [...SITES, ...OTHER]),
		[],
	);
});

test("English is character-identical to the literal each call site carried", () => {
	i18n.setLocale("en");
	for (const [key, english] of [...SITES, ...OTHER]) {
		assert.equal(i18n.t(key), english, `${key} English drifted`);
	}
});

test("French renders the shipped catalogue value for every key that has one", () => {
	const shipped = {
		...catalogue("fr", "ui.common.layout"),
		...catalogue("fr", "ui.chat.run_details"),
		...catalogue("fr", "ui.code_review"),
	};
	const translated = [...SITES, ...OTHER].filter(([key]) => key in shipped);
	// Not vacuous: the resize labels and the run-details names already ship in
	// French, and a catalogue edit that dropped them all must fail here.
	assert.ok(translated.length >= 4, `only ${translated.length} shipped in fr`);
	i18n.setLocale("fr");
	try {
		for (const [key, english] of translated) {
			assert.equal(i18n.t(key), shipped[key]);
			assert.notEqual(i18n.t(key), english, `${key} is still English in fr`);
		}
	} finally {
		i18n.setLocale("en");
	}
});

test("negative control: a reverted call site fails the pin", () => {
	const reverted = readFileSync(SOURCE, "utf8").replace(
		'closeLabel={t("ui.chat.run_details.close_label")}',
		'closeLabel="Close run details"',
	);
	assert.notEqual(reverted, readFileSync(SOURCE, "utf8"));
	const failures = pinFailures(reverted, [...SITES, ...OTHER]);
	assert.ok(failures.length > 0);
	assert.ok(failures.some((line) => line.includes("Close run details")));
});
