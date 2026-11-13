import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * S17a: the chat transcript's trace vocabulary is catalogue copy.
 *
 * Before this slice the trace row's verbs (`Read`, `Wrote`, `Ran code`,
 * `Delegated work` ... and their running forms), the `N files` object, the
 * `send` delivery words/hovers/spoken labels/notes, the `Attempted` verb and the
 * tool detail's `Output` / `Error` / `Interrupted` heading were English
 * literals, so a French transcript still said `Ran code`. They are now keys in
 * `ui.chat.trace`, resolved by `t()` at CALL time. Three locks:
 *
 * 1. ENGLISH BYTE-IDENTITY. The `EN_*` literals below are the exact strings the
 *    pre-S17a source held (origin/main 87cc0d95e18); the English catalogue must
 *    still produce them character for character.
 * 2. LOOKUP IS PROVEN, NOT ASSUMED. A marker catalogue is registered for `fr`
 *    through `registerCatalogue` (the seam served catalogues use) and the
 *    locale is switched WITHOUT re-importing the module: every surface must
 *    print the marker. That is the regression a module-scope `t()` would
 *    reintroduce - it would keep printing English after the switch.
 * 3. SOURCE GUARD. The keyed files hold none of the old literals, every
 *    `ui.chat.trace` key is used and has a context entry for translators.
 */

const ROOT = process.cwd();
const bundle = await build({
	stdin: {
		contents: `export { getTraceLabel } from "./src/renderer/src/features/chat/components/trace/trace-labels";
export { deliveryWord, deliveryTitle, deliveryLabel, deliveryNote, deliverySettledVerb } from "./src/renderer/src/features/chat/components/trace/tool-row-model";
export { setLocale, registerCatalogue, clearRegisteredCatalogues } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	define: { "import.meta.env": "{}" },
	external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
});
// A FILE, not a data: URL: externals are bare specifiers a data: module cannot
// resolve (see tool-state-copy.test.mjs).
const bundlePath = new URL("./_trace-vocabulary.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}

const NS = "ui.chat.trace";
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const en = JSON.parse(read(`src/i18n/catalogues/en/${NS}.json`));
const context = JSON.parse(read(`src/i18n/catalogues/en/${NS}.context.json`));

const EN_VERBS = {
	READ: ["Read", "Reading"],
	WRITE: ["Wrote", "Writing"],
	EDIT: ["Edited", "Editing"],
	CODE: ["Ran code", "Running code"],
	DELEGATE: ["Delegated work", "Delegating work"],
	DONE: ["Finished", "Finishing"],
	ASK: ["Asked", "Asking"],
	BYE: ["Ended the conversation", "Ending"],
	[undefined]: ["Worked on the request", "Working on the request"],
};

const snapshot = () => {
	const verbs = {};
	for (const action of Object.keys(EN_VERBS)) {
		const label = mod.getTraceLabel(
			action === "undefined" ? undefined : action,
		);
		verbs[action] = [label.verb, label.runningVerb];
	}
	const states = ["mailbox", "unconfirmed", "failed", "delivered"];
	const per = (fn) => Object.fromEntries(states.map((s) => [s, fn(s, "send")]));
	return {
		verbs,
		files: mod.getTraceLabel("READ", undefined, ["a.txt", "b.txt", "c.txt"])
			.object,
		manyFiles: mod.getTraceLabel(
			"READ",
			undefined,
			Array.from({ length: 1234 }, (_, i) => `f${i}`),
		).object,
		word: per(mod.deliveryWord),
		title: per(mod.deliveryTitle),
		label: per(mod.deliveryLabel),
		note: per(mod.deliveryNote),
		settled: per((s) => mod.deliverySettledVerb(s)),
	};
};

test("English: every keyed trace string is byte-identical to the pre-S17a literal", () => {
	mod.clearRegisteredCatalogues();
	mod.setLocale("en");
	const s = snapshot();
	assert.deepEqual(s.verbs, Object.fromEntries(Object.entries(EN_VERBS)));
	assert.equal(s.files, "3 files");
	// `${n} files` never grouped digits; `::group-off` keeps that.
	assert.equal(s.manyFiles, "1234 files");
	// One concrete file names its path, not a count; data: URIs do not count.
	assert.equal(mod.getTraceLabel("READ", undefined, ["a.txt"]).object, "a.txt");
	assert.equal(
		mod.getTraceLabel("READ", undefined, ["data:x", "a.txt"]).object,
		"a.txt",
	);
	assert.deepEqual(s.word, {
		mailbox: "wake unconfirmed",
		unconfirmed: "delivery unconfirmed",
		failed: "not delivered",
		delivered: null,
	});
	assert.deepEqual(s.title, {
		mailbox:
			"In their mailbox. The wake got no answer, so they will read it on their next turn.",
		unconfirmed:
			"No wake answer and not yet in their transcript — it may still arrive. Check before resending.",
		failed: undefined,
		delivered: undefined,
	});
	assert.deepEqual(s.label, {
		mailbox: "delivered, wake unconfirmed",
		unconfirmed:
			"delivery unconfirmed — it may still arrive, so check before resending",
		failed: null,
		delivered: null,
	});
	assert.deepEqual(s.note, {
		mailbox:
			"Delivered to their mailbox. The wake got no answer, so they will read the message on their next turn. Do not send it again.",
		unconfirmed:
			"Not confirmed: there was no answer and the message is not in their transcript. It may still arrive, so check before resending.",
		failed:
			"Nothing was delivered. Fix the cause named below, or retry the send.",
		delivered: null,
	});
	assert.deepEqual(s.settled, {
		mailbox: null,
		unconfirmed: null,
		failed: "Attempted",
		delivered: null,
	});
});

/** Marker catalogue: proves lookup and live repaint, not wording. */
const markerCatalogue = () => {
	const out = {};
	for (const key of Object.keys(en))
		out[key] =
			key === `${NS}.object.file_count`
				? "{count, plural, one {fr:file:#} other {fr:files:#}}"
				: `fr:${key.slice(NS.length + 1)}`;
	return out;
};

test("a locale switch repaints every trace surface with no re-import (resolved at call time)", () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", markerCatalogue());
	try {
		mod.setLocale("en");
		assert.equal(mod.getTraceLabel("CODE").verb, "Ran code");
		mod.setLocale("fr");
		const s = snapshot();
		assert.deepEqual(s.verbs.CODE, [
			"fr:action.code.settled",
			"fr:action.code.running",
		]);
		assert.deepEqual(s.verbs.undefined, [
			"fr:action.fallback.settled",
			"fr:action.fallback.running",
		]);
		for (const [action, pair] of Object.entries(s.verbs))
			for (const v of pair)
				assert.match(v, /^fr:action\./, `${action} verb still English: ${v}`);
		assert.equal(s.files, "fr:files:3");
		assert.equal(s.word.mailbox, "fr:send.delivery.mailbox.word");
		assert.equal(s.title.unconfirmed, "fr:send.delivery.unconfirmed.title");
		assert.equal(s.label.mailbox, "fr:send.delivery.mailbox.label");
		assert.equal(s.note.failed, "fr:send.delivery.failed.note");
		assert.equal(s.settled.failed, "fr:send.delivery.failed.verb");
		mod.setLocale("en");
		assert.equal(mod.getTraceLabel("CODE").verb, "Ran code");
	} finally {
		mod.setLocale("en");
		mod.clearRegisteredCatalogues();
	}
});

test("source guard: the keyed files hold none of the old English literals", () => {
	const labels = read(
		"src/renderer/src/features/chat/components/trace/trace-labels.ts",
	);
	// A verb slot may only hold a catalogue key. (Matched as a property value,
	// not a bare quote, so the doc comment's `"Read"` example is not a hit.)
	const literalVerb = /\b(?:verb|runningVerb):\s*"(?!ui\.chat\.trace\.)/;
	assert.doesNotMatch(labels, literalVerb);
	// Negative control: the pre-S17a shape is a hit.
	assert.match('READ: { verb: "Read", runningVerb: "Reading" }', literalVerb);
	assert.ok(
		!labels.includes("} files`"),
		"trace-labels.ts still builds `N files`",
	);
	const detail = read(
		"src/renderer/src/features/chat/components/trace/tool-detail.tsx",
	);
	for (const word of ["Interrupted", "Error", "Output"])
		assert.ok(
			!detail.includes(`"${word}"`),
			`tool-detail.tsx still holds "${word}"`,
		);
	const model = read(
		"src/renderer/src/features/chat/components/trace/tool-row-model.ts",
	);
	for (const literal of [
		'"wake unconfirmed"',
		'"delivery unconfirmed"',
		'"not delivered"',
		'"Attempted"',
		'"delivered, wake unconfirmed"',
	])
		assert.ok(
			!model.includes(literal),
			`tool-row-model.ts still holds ${literal}`,
		);
	// Negative control: the guard can see a literal when one is there.
	assert.ok('verb: "Read",'.includes('"Read"'));
});

test("every ui.chat.trace key is used by source and described for translators", () => {
	const sources = [
		"src/renderer/src/features/chat/components/trace/trace-labels.ts",
		"src/renderer/src/features/chat/components/trace/tool-row-model.ts",
		"src/renderer/src/features/chat/components/trace/tool-detail.tsx",
	]
		.map(read)
		.join("\n");
	assert.deepEqual(Object.keys(context).sort(), Object.keys(en).sort());
	for (const key of Object.keys(en)) {
		assert.ok(sources.includes(`"${key}"`), `${key} is not used`);
		const c = context[key];
		assert.ok(
			c.role && c.tone && c.note && c.length,
			`${key} context incomplete`,
		);
	}
	assert.ok(Object.keys(en).length <= 45, "slice cap is 45 keys");
});
