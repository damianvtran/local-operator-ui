import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// A fixture-only pass misses a forgotten generated import. Exercise the actual
// bundled catalogues so locale publication cannot silently remain English.
const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
			'export * as keys from "./src/i18n/keys.gen";',
		].join("\n"),
		resolveDir: new URL("../../", import.meta.url).pathname,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { messages, locale, keys } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const MANUAL_BIDI = /[\u200e\u200f\u2066\u2067\u2068\u2069]/;
const FORBIDDEN_SCRIPT = /[\u0964\u0900-\u097f\u0643\u064a\u0629\u0649]/;

/*
 * URDU IS THE RTL LOCALE. Two properties matter beyond ordinary activation:
 *
 * 1. The stored string is LOGICAL ORDER and carries no bidi controls of its
 *    own. This UI has no client-side FSI/PDI wrapper: `messages.ts` passes the
 *    catalogue value straight to the DOM. The no-manual-controls rule therefore
 *    keeps storage clean; a surface that does isolate (the TUI's documented
 *    contract) adds its own wrapping, so a second set here would be the bug.
 *    The hygiene test below scans the real bundled Urdu bundle, not a fixture,
 *    so a stray RLM cannot ship.
 * 2. Urdu punctuation and script are part of the copy, not presentation: no
 *    Hindi danda, no Devanagari, and no Arabic-only yeh/kaf/teh-marbuta. The
 *    mechanical checker covers source files; this pins the generated bundle.
 */
test("shipped Urdu covers settings, console, onboarding and the wider UI, then switches back to English", () => {
	locale.setLocale("ur");
	assert.equal(messages.t("ui.settings.page.title"), "ترتیبات");
	assert.equal(messages.t("ui.console.pane.label"), "کنسول");
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", { current: 2, total: 5 }),
		"5 میں سے قدم 2",
	);
	// A namespace beyond the three early locales: proves the full UI bundle
	// imported, not just the onboarding tranche.
	assert.equal(messages.t("ui.common.actions.retry"), "دوبارہ کوشش کریں");
	assert.equal(messages.t("ui.chat.tags.label"), "ٹیگز");
	// The v3 footer and picker replaced Move to tag…; prove their CURRENT
	// audited Urdu strings are bundled rather than restoring a retired key or
	// letting the missing-key spelling satisfy an obsolete activation contract.
	assert.equal(messages.t("ui.chat.tags.new_tag"), "نیا ٹیگ");
	assert.equal(messages.t("ui.chat.tags.show_under"), "اس گروہ میں رکھیں");
	assert.equal(messages.t("ui.library.filter.scope_final"), "حتمی فائلیں");
	console.log(
		`ur: ${messages.t("ui.settings.page.title")} | ${messages.t("ui.console.pane.label")} | ${messages.t("ui.onboarding.modal.step_of", { current: 2, total: 5 })}`,
	);
	locale.setLocale("en");
	assert.equal(messages.t("ui.settings.page.title"), "Settings");
	assert.equal(messages.t("ui.console.pane.label"), "Console");
	console.log("en: Settings | Console");
});

test("counts render ungrouped and the two remediated count messages agree", () => {
	locale.setLocale("ur");
	// The count sinks carry ::group-off exactly as the English source has since
	// #1131: 1 / >1 / >=1000 all render the raw number.
	for (const [live, limit, expected] of [
		[1, 3, "1/3"],
		[64, 128, "64/128"],
		[1234567, 2000000, "1234567/2000000"],
	]) {
		assert.equal(
			messages.t("ui.console.capacity.summary_compact_bare", { live, limit }),
			expected,
		);
	}
	const formatted = messages.t("ui.console.capacity.summary_compact_bare", {
		live: 1234567,
		limit: 2000000,
	});
	const number = new Intl.NumberFormat("ur");
	assert.notEqual(
		formatted,
		`${number.format(1234567)}/${number.format(2000000)}`,
		"the group-off token must suppress Urdu grouping at >= 1000",
	);
	assert.equal(
		messages.t("ui.onboarding.modal.step_of", {
			current: 1234567,
			total: 2000000,
		}),
		"2000000 میں سے قدم 1234567",
	);
	// The done-gate count fragment: singular and plural must each agree with the
	// framing sentence that interpolates them (agent-review MAJOR S4-1).
	assert.equal(
		messages.t("ui.projects.count.milestones_are", { count: 1 }),
		"1 سنگ میل ابھی نامکمل ہے",
	);
	assert.equal(
		messages.t("ui.projects.count.milestones_are", { count: 2 }),
		"2 سنگ میل ابھی نامکمل ہیں",
	);
	// Canvas is now carried by Urdu; the plural has one/other arms and the
	// ::group-off number skeleton from English.
	assert.equal(messages.t("ui.canvas.files.count", { count: 1 }), "1 فائل");
	assert.equal(messages.t("ui.canvas.files.count", { count: 3 }), "3 فائلیں");
	assert.equal(
		messages.t("ui.canvas.files.count", { count: 1234567 }),
		"1234567 فائلیں",
	);
	// Mesh's singular branch is a different message from its plural branch.
	assert.equal(
		messages.t("ui.mesh.mesh_node.show_all_conversations", { count: 1 }),
		"1 گفتگو دکھائیں",
	);
	console.log(`ur counts ungrouped: ${formatted}`);
});

test("the bundled Urdu catalogue carries no manual bidi controls or forbidden script", () => {
	const urdu = keys.bundledCatalogues.ur;
	assert.ok(urdu, "the generated bundle has no ur catalogue");
	assert.ok(
		Object.keys(urdu).length > 3000,
		"the bundled ur catalogue is unexpectedly small",
	);
	const problems = [];
	for (const [key, value] of Object.entries(urdu)) {
		if (MANUAL_BIDI.test(value)) problems.push(`${key}: manual bidi control`);
		if (FORBIDDEN_SCRIPT.test(value))
			problems.push(`${key}: forbidden script or punctuation`);
		if (value.normalize("NFC") !== value) problems.push(`${key}: not NFC`);
	}
	assert.deepEqual(problems, []);
	console.log(`ur bundled values checked: ${Object.keys(urdu).length}`);
});
