/**
 * The pairing sentence's two commands are drawn as CODE SPANS, in every locale.
 *
 *     node --test scripts/chat-device-guidance.test.mjs
 *
 * WHY THIS SUITE EXISTS. `ui.chat.device.sentence.pairing_guidance` names two
 * terminal commands and asks for them verbatim inside backticks, and all seven
 * translations carry those markers. The picker drew the message into a plain
 * `<p>`, so the markers themselves were painted: the only instruction a device
 * in no network gets read as machine punctuation rather than as two commands to
 * run (design review round 1, D1). The fix is a render-path one - split the
 * message on its markers and draw each span as `<code dir="ltr">` - which is
 * precisely the kind of change a value suite cannot see: the model's `guidance`
 * string is correct both before and after.
 *
 * WHAT IS MEASURED, and with which instrument.
 *
 * A. THE PARAGRAPH IS RENDERED. `DeviceGuidance` is the component the picker
 *    mounts, rendered here through `react-dom/server` under each locale's own
 *    resolved message (`pairingGuidance()`, the model's own call). The
 *    assertions read the emitted markup, not the helper.
 *
 * B. TWO SPANS, NO MARKERS LEFT, AND THE COMMANDS INTACT. Exactly two `<code>`
 *    elements, both `dir="ltr"`, their text equal to the message's own
 *    backtick-delimited runs, and the paragraph's visible text is the message
 *    with the markers removed - so the accessible name still reads as one
 *    natural sentence.
 *
 * C. EVERY SHIPPED LOCALE, NOT ONLY THE TWO FRAMED. A translation that drops a
 *    pair of markers (or doubles one) turns this red, which is the catalogue
 *    defect the design review checked by hand in all seven files.
 *
 * D. UNBALANCED INPUT DEGRADES TO TEXT. One unpaired backtick must not throw and
 *    must not emit a half-built `<code>`: the paragraph is the literal string.
 *
 * THE CALL SITE IS READ AS TEXT, following `chat-device-model.test.mjs`'s
 * documented trade: `DeviceGuidance` is correct for whatever string it is
 * given, and handing it a raw `<p>{model.guidance}</p>` again is the caller's
 * mistake - the one this fix exists to close - so the picker's own line is
 * pinned by source.
 *
 * WHAT IT DOES NOT PROVE: pixels. The span must not change the paragraph's fit
 * (3 lines at 310x64.2 before the fix); that is the design round's frame set,
 * not a DOM-free suite's.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { DeviceGuidance, messageRuns } from "./src/renderer/src/features/chat/device/chat-header-device";',
			'export { pairingGuidance } from "./src/renderer/src/features/chat/device/chat-device-model";',
			'export { t } from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	// The component's UI imports carry no stylesheet of their own, but the
	// renderer's tree can reach one; an empty loader keeps this a node bundle.
	loader: { ".css": "empty" },
	// `shared/config` reads `import.meta.env` at import time.
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});

const bundlePath = new URL(
	`./_chat-device-guidance-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const lib = await import(bundlePath.href);
await unlink(bundlePath).catch(() => {});

/** Every locale the catalogue tree ships, read from the tree rather than listed. */
const SHIPPED = readdirSync("src/i18n/catalogues").sort();

/** A marker still in the message: the catalogue defect the spans exist to draw. */
const BACKTICK = /`/;

/** The direction a Latin command keeps inside RTL copy. */
const LTR_DIRECTION = /dir="ltr"/;

/** The picker's own call, read as source (see this file's header, D). */
const PICKER_CALL = /<DeviceGuidance guidance=\{model\.guidance\} \/>/;

/** The two locales design review round 1 framed by name: English and an RTL one. */
const FRAMED = ["en", "ur"];

/** Urdu's own script, for the control that proves the locale actually moved. */
const RTL_SCRIPT = /[\u0600-\u06FF]/;

const ENTITIES = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#x27;": "'",
	"&#39;": "'",
};

/** React escapes text for the document; this suite reads the text back. */
const decode = (text) =>
	text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity]);

/** The visible text of a markup fragment, as a screen reader would read it. */
const textOf = (markup) => decode(markup.replace(/<[^>]*>/g, ""));

/** The message under one locale, resolved through the model's own function. */
const messageFor = (tag) => {
	lib.locale.setLocale(tag);
	return lib.pairingGuidance();
};

/** The paragraph the picker mounts, rendered for one message. */
const paragraph = (message) =>
	renderToStaticMarkup(
		createElement(lib.DeviceGuidance, { guidance: message }),
	);

const codeSpans = (markup) => [
	...markup.matchAll(/<code([^>]*)>([\s\S]*?)<\/code>/g),
];

/** A message's own backtick-delimited runs, in order. */
const declaredRuns = (message) =>
	[...message.matchAll(/`([^`]*)`/g)].map((match) => match[1]);

test("the pairing paragraph draws both commands as code spans, en and ur", () => {
	for (const tag of FRAMED) {
		const message = messageFor(tag);
		assert.match(
			message,
			BACKTICK,
			`${tag}: the catalogue still asks for code spans`,
		);
		const html = paragraph(message);
		const spans = codeSpans(html);

		assert.equal(spans.length, 2, `${tag}: one span per command`);
		for (const [, attributes] of spans) {
			assert.match(
				attributes,
				LTR_DIRECTION,
				`${tag}: a Latin command keeps its own direction inside RTL copy`,
			);
		}
		assert.deepEqual(
			spans.map(([, , inner]) => textOf(inner)),
			declaredRuns(message),
			`${tag}: the command is the catalogue's own text, markers stripped`,
		);

		const visible = textOf(html);
		assert.ok(
			!visible.includes("`"),
			`${tag}: no marker reaches the rendered sentence: ${visible}`,
		);
		assert.equal(
			visible,
			message.replace(/`/g, ""),
			`${tag}: the accessible sentence is the message, unchanged apart from markers`,
		);
		if (tag === "ur") {
			assert.match(visible, RTL_SCRIPT, "ur: the rendered sentence is Urdu");
		}
	}
});

test("every shipped locale keeps exactly two spans", () => {
	for (const tag of SHIPPED) {
		const spans = codeSpans(paragraph(messageFor(tag)));
		assert.equal(spans.length, 2, `${tag}: two commands, two spans`);
	}
});

test("an unclosed marker renders as text, never as half a span", () => {
	const html = paragraph("Join one with `lop network join <token>.");
	assert.equal(
		codeSpans(html).length,
		0,
		"no span is built from an open marker",
	);
	assert.equal(
		textOf(html),
		"Join one with `lop network join <token>.",
		"the message is drawn exactly as written",
	);
	assert.equal(
		lib.messageRuns("no markers at all").join(""),
		"no markers at all",
		"a message without markers is one text run",
	);
});

test("the picker mounts the span-drawing paragraph, not the raw message", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/device/chat-header-device.tsx",
		"utf8",
	);
	assert.match(
		source,
		PICKER_CALL,
		"the picker's pairing line renders DeviceGuidance",
	);
});
