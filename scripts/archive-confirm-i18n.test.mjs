/**
 * The archive wording follows the interface language: the row/header control's
 * accessible name, the confirmation's question and the confirmation's body.
 *
 * WHY THIS FILE EXISTS. These three strings were English literals in code
 * (`archiveControlLabel` joined a verb to a quoted name; the dialog joined
 * `ARCHIVE_CONFIRM_VERB` + a quote + the title + `?`; the body was a template
 * constant), so a French interface still read "Archive “x”" in the row tooltip
 * and in the dialog. The scanner cannot see a literal assembled by
 * concatenation, so nothing but a test that SWITCHES THE LOCALE can notice the
 * regression coming back.
 *
 * SENTINEL CATALOGUE, NOT A TRANSLATION. `fr` is registered with marker text so
 * the assertions prove WHICH SOURCE each string came from. The real French is the
 * audited catalogue's to carry (and is deliberately not written here). `en` is
 * never registered: the closing assertions prove the store returns to the shipped
 * English rather than to a sentinel laid over it.
 *
 * WHAT THIS CANNOT SAY: that the dialog and the row re-render when the language
 * moves. Those components cannot be mounted in this suite, so the second half of
 * the file pins the source lines the defect would live on (the subscription and
 * the call-during-render shape), and the rendered pass proves the pixels.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/archive-confirm";',
			'export { archiveControlLabel } from "./src/renderer/src/features/chat/chat-archived";',
			/* The i18n door from the SAME bundle as the modules under test, so a
			 * catalogue registered here is the one their `t()` reads. */
			'export { registerCatalogue, setLocale } from "./src/renderer/src/shared/i18n";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	logLevel: "silent",
});
const {
	archiveConfirmMessage,
	archiveConfirmTitleParts,
	archiveControlLabel,
	registerCatalogue,
	setLocale,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const src = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("English is unchanged: the same words the literals produced", () => {
	assert.equal(archiveControlLabel("Q3 plan", false), "Archive “Q3 plan”");
	assert.equal(archiveControlLabel("Q3 plan", true), "Unarchive “Q3 plan”");
	assert.deepEqual(archiveConfirmTitleParts("Q3 plan"), {
		before: "Archive “",
		name: "Q3 plan",
		after: "”?",
	});
	assert.deepEqual(archiveConfirmTitleParts(null), {
		before: "Archive this conversation?",
		name: null,
		after: "",
	});
	assert.equal(
		archiveConfirmMessage(),
		"It leaves your lists. You can undo for 8 seconds; after that, search above your chats, turn on “Include archived”, then Unarchive it.",
	);
});

test("every archive string is catalogue copy resolved per call, not a captured English literal", () => {
	registerCatalogue("fr", {
		"ui.chat.sidebar.row.archive_label": "FR archive «{title}»",
		"ui.chat.sidebar.row.unarchive_label": "FR unarchive «{title}»",
		"ui.chat.sidebar.search.include_archived": "FR include archived",
		"ui.chat.dialogs.archive_title_named": "FR title «{title}» ?",
		"ui.chat.dialogs.archive_title_unnamed": "FR unnamed ?",
		"ui.chat.dialogs.archive_message":
			"FR body {seconds, plural, one {# s} other {# s}} / {include_archived}",
	});
	try {
		// The SAME functions, asked again after the locale moved: a label captured
		// at module load would still answer in English here.
		setLocale("fr");
		assert.equal(archiveControlLabel("T", false), "FR archive «T»");
		assert.equal(archiveControlLabel("T", true), "FR unarchive «T»");
		assert.deepEqual(archiveConfirmTitleParts("T"), {
			before: "FR title «",
			name: "T",
			after: "» ?",
		});
		assert.deepEqual(archiveConfirmTitleParts(null), {
			before: "FR unnamed ?",
			name: null,
			after: "",
		});
		// The body asks the SEARCH CHECKBOX'S OWN key for the name it sends the
		// reader to, so the two cannot disagree in any language.
		assert.equal(archiveConfirmMessage(), "FR body 8 s / FR include archived");
	} finally {
		setLocale("en");
	}
	assert.equal(archiveControlLabel("T", false), "Archive “T”");
});

test("the title is cut at the placeholder wherever the language puts the name", () => {
	registerCatalogue("fr", {
		// A language that puts the name FIRST, with a space at the cut edge: the
		// part before is empty and the space is kept for `whitespace-pre`.
		"ui.chat.dialogs.archive_title_named": "«{title}» à archiver ?",
	});
	try {
		setLocale("fr");
		assert.deepEqual(archiveConfirmTitleParts("T"), {
			before: "«",
			name: "T",
			after: "» à archiver ?",
		});
		registerCatalogue("fr", {
			"ui.chat.dialogs.archive_title_named": "{title} archiver ?",
		});
		assert.deepEqual(archiveConfirmTitleParts("T"), {
			before: "",
			name: "T",
			after: " archiver ?",
		});
		// A defective message that lost its placeholder degrades to the whole
		// sentence with no name - never a crash and never a half-sentence.
		registerCatalogue("fr", {
			"ui.chat.dialogs.archive_title_named": "Archiver ?",
		});
		assert.deepEqual(archiveConfirmTitleParts("T"), {
			before: "Archiver ?",
			name: null,
			after: "",
		});
	} finally {
		setLocale("en");
	}
});

test("a name that contains markup-like or slot-like text is carried verbatim", () => {
	// The name is never spliced into the sentence (the slot is), so no title can
	// shift the cut, whatever characters it holds.
	assert.deepEqual(archiveConfirmTitleParts("a {title} “b” \uE000 c"), {
		before: "Archive “",
		name: "a {title} “b” \uE000 c",
		after: "”?",
	});
});

test("the surfaces ask again when the language moves (source pins, not renders)", () => {
	/*
	 * `archiveControlLabel` and the dialog's parts are resolved when they RUN. A
	 * caller that cached the result (a memo without the locale, a module constant)
	 * would keep the old language. So each caller must (1) subscribe with
	 * `useI18nLocale()` and (2) call the function during render, not capture it.
	 */
	const sidebar = src(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	);
	const header = src(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	const dialog = src(
		"src/renderer/src/features/chat/components/archive-conversation-dialog.tsx",
	);
	for (const [name, source] of [
		["sidebar", sidebar],
		["header", header],
		["dialog", dialog],
	]) {
		assert.match(
			source,
			/\buseI18nLocale\(\);/,
			`${name} lost its locale subscription`,
		);
	}
	assert.match(
		sidebar,
		/aria-label=\{archiveControlLabel\(label, archived\)\}/,
	);
	assert.match(sidebar, /title=\{archiveControlLabel\(label, archived\)\}/);
	assert.match(header, /aria-label=\{archiveControlLabel\(agentName, true\)\}/);
	assert.match(header, /title=\{archiveControlLabel\(agentName, true\)\}/);
	// Neither caller holds the label in a memo or a module-level constant.
	assert.doesNotMatch(
		sidebar + header,
		/(useMemo|const [A-Z_]+ =)[^;\n]*archiveControlLabel/,
	);
	assert.match(
		dialog,
		/const titleParts = archiveConfirmTitleParts\(candidateTitle\);/,
	);
	assert.match(dialog, /\{archiveConfirmMessage\(\)\}/);
});

test("the English literals are gone from the sources", () => {
	const archived = src("src/renderer/src/features/chat/chat-archived.ts");
	const confirm = src("src/renderer/src/features/chat/archive-confirm.ts");
	const strip = (text) =>
		text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
	assert.doesNotMatch(strip(archived), /"Unarchive"|"Archive"/);
	assert.doesNotMatch(
		strip(confirm),
		/It leaves your lists|this conversation|"Archive"/,
	);
});

test("the conversation name sets its own direction so an RTL locale cannot clip its first letters", () => {
	const dialog = src(
		"src/renderer/src/features/chat/components/archive-conversation-dialog.tsx",
	);
	/* `text-overflow` clips from the END of the box's own direction. A name that
	 * inherited an RTL locale's direction (Urdu) lost the first letters of an
	 * English title behind the ellipsis. The truncating box itself carries
	 * `dir="auto"` - a `<bdi>` inside it would not change that box's direction -
	 * and the name is not wrapped a second time in `isolateLtr`. */
	assert.match(
		dialog,
		/<span dir="auto" className="min-w-0 truncate">\s*\{titleParts\.name\}\s*<\/span>/,
	);
	assert.doesNotMatch(dialog, /isolateLtr\(titleParts\.name/);
});
