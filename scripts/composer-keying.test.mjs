/**
 * THE COMPOSER SURFACE'S ENGLISH IS KEYED (i18n slice S3).
 *
 * WHY THIS FILE EXISTS. The operator's report was "switching to fr must leave NO
 * English anywhere in the interface ... composers, navigation, sidebars" and "the
 * whole new chat page is still english, composer is english". Most composer
 * strings were keyed already; what was left was the English the repo's literal
 * scanner cannot see: module-level `const X = "sentence"` constants,
 * `Record<kind, string>` copy tables, template-string sentences with spliced
 * fragments, helpers returning English to the UI, ternaries in JSX and the
 * argument of `note(...)` / `setSendError(...)`. Each is now a `t()` call made
 * when the string is read - never at module load, which froze the language of
 * whoever launched the app.
 *
 * WHAT IS PROVEN, and what deliberately is not:
 *
 * 1. THE NAMESPACES ARE WHOLE. Every key in the S3 namespaces resolves through
 *    `t()` under a marker locale (`xx`, values shaped `XX <key>`, a form no
 *    English sentence has) and is referenced by at least one source file, so a
 *    key that exists but is wired to nothing fails here.
 * 2. THE PRODUCERS RESOLVE THROUGH `t()`. A producer from each migrated module
 *    is called under the marker locale and must return catalogue copy and none
 *    of the English it used to return.
 * 3. A STATIC GUARD on every migrated source: no English sentence literal may
 *    remain outside the named by-design list (wire tokens, selectors, console
 *    diagnostics), and a stale list entry fails too.
 * 4. A NEGATIVE CONTROL: the guard is run against planted literals and must
 *    flag them, so it cannot pass by detecting nothing.
 *
 * NOT PROVEN HERE: a real translation. The seven shipped locales carry those in
 * the paired PR; the repo's coverage gate stays red until they land.
 */
import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

const NAMESPACES = [
	"approval",
	"ask_answer",
	"ask_panel",
	"ask_queue",
	"aside",
	"attachment_refusal",
	"composer_notes",
	"credential_notice",
	"device_move",
	"fast_mode",
	"header_menu",
	"interrupt",
	"message_budget",
	"move_cwd",
	"page_chrome",
	"quota_resend",
	"read_ack",
	"session_readout",
	"session_spend",
	"sidebar_notes",
	"slash",
].map((name) => `ui.chat.${name}.`);

const bundle = await build({
	stdin: {
		contents: `
			export { enterFooter, clickFooter, stagedNote, reassembledNote, lockedCommandNote, argumentEmptyCopy } from "./src/renderer/src/features/chat/components/slash-contract";
			export { skillEnterFooter, skillPhaseLabel, skillMissLine } from "./src/renderer/src/features/chat/components/skill-contract";
			export { atUnavailableReason, unreadableCopy } from "./src/renderer/src/features/chat/components/at-contract";
			export { interruptNotice, idleStopNotice, interruptUnavailableNotice } from "./src/renderer/src/features/chat/interrupt-turn";
			export { commandBudgetRefusal, messageBudgetRefusal } from "./src/renderer/src/features/chat/utils/message-budget";
			export { unreadableAttachmentRefusal, imageOverflowRefusal, fileOverflowRefusal } from "./src/renderer/src/features/chat/utils/attachment-read";
			export { quotaResendSentSentence, quotaRefreshSentence } from "./src/renderer/src/features/chat/quota-notice/quota-notice";
			export { READ_ACK_NOTICE_CLAUSE, READ_ACK_NOTICE_DESCRIPTION } from "./src/renderer/src/features/chat/read-ack-notice";
			export { moveReceiptLine, moveUnavailableReason } from "./src/renderer/src/features/chat/move-session";
			export { fastModelPickNotice, fastPickFailure, fastUnavailableSentence } from "./src/renderer/src/features/chat/draft-selection";
			export { askWaitedText, askResponseSummary, askChipLabel, ASK_STATUS_COPY, askExpiredMessage } from "./src/renderer/src/features/chat/ask-queue";
			export { clearedNotice, credentialTypingNotice, unconfirmedChipLabel } from "./src/renderer/src/features/chat/components/credential-capture";
			export { clearRegisteredCatalogues, registerCatalogue, t } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
			export { bundledEnglish } from "./src/i18n/keys.gen";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	// The migrated modules import through the app's path aliases.
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
// Written beside the script (gitignored `_*.bundle.mjs`) so the bundle's bare
// imports resolve from the repository; a data: URL cannot resolve them.
const bundlePath = new URL(
	`./_composer-keying-${process.pid}.bundle.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => rm(bundlePath, { force: true }));
const api = await import(bundlePath.href);
const { registerCatalogue, setLocale, bundledEnglish, t } = api;

const mine = Object.keys(bundledEnglish).filter((key) =>
	NAMESPACES.some((ns) => key.startsWith(ns)),
);

function useMarkerLocale() {
	registerCatalogue(
		"xx",
		Object.fromEntries(
			Object.keys(bundledEnglish).map((key) => [key, `XX ${key}`]),
		),
	);
	setLocale("xx");
}

/** What is left of a producer's output once every marker is removed. */
const residue = (text) => text.replace(/XX ui\.[a-z0-9_.]+/g, "");

async function sourceFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
		else if (
			/\.(ts|tsx)$/.test(entry.name) &&
			!/\.(stories|test)\./.test(entry.name)
		)
			out.push(path);
	}
	return out;
}

test("the S3 namespaces are populated, resolve through t(), and every key is referenced", async () => {
	assert.ok(mine.length >= 400, `expected the S3 keys, found ${mine.length}`);
	useMarkerLocale();
	for (const key of mine) assert.equal(t(key), `XX ${key}`.replace(/\s+$/, ""));
	const haystack = (await sourceFiles("src/renderer/src"))
		.map((file) => file)
		.concat(await sourceFiles("src/shared"));
	const corpus = (
		await Promise.all(haystack.map((file) => readFile(file, "utf8")))
	).join("\n");
	// A key may be built from a prefix (`${A}.title`), so a key counts as wired
	// when its full text, or the text up to its last dot segment's parent, appears.
	const orphans = mine.filter((key) => {
		if (corpus.includes(`"${key}"`) || corpus.includes(`\`${key}\``))
			return false;
		const parent = key.slice(0, key.lastIndexOf("."));
		return !corpus.includes(`${parent}.\${`) && !corpus.includes(`"${parent}.`);
	});
	assert.deepEqual(orphans, [], "keys no source references");
});

test("producers return catalogue copy under a marker locale, and none of the English they used to", () => {
	useMarkerLocale();
	const cases = {
		enterStages: api.enterFooter({
			matched: true,
			phase: "command",
			unambiguous: true,
			runs: true,
			arms: false,
			takesDraft: false,
			hoists: false,
			label: "n1",
			paneHasSession: true,
		}),
		clickFooter: api.clickFooter({
			matched: true,
			phase: "command",
			runs: true,
			arms: false,
			takesDraft: false,
			hoists: false,
			label: "n1",
			command: "n1",
			value: "",
			nameThenMessage: false,
		}),
		staged: api.stagedNote("/n1", "session.goal", true),
		stagedRefused: api.reassembledNote("/n1", false),
		locked: api.lockedCommandNote("n1", { dialog: true, undo: true }, true),
		emptyList: api.argumentEmptyCopy({
			rows: [],
			loading: true,
			error: null,
			needsSession: false,
		}),
		skillFooter: api.skillEnterFooter("n1"),
		skillPhase: api.skillPhaseLabel(),
		atUnavailable: api.atUnavailableReason(),
		unreadable: api.unreadableCopy("EACCES"),
		interruptIdle: api.idleStopNotice(),
		interruptJobs: api.interruptNotice({
			status: "interrupted",
			children_running: 0,
			background_jobs: 2,
		}),
		interruptOld: api.interruptUnavailableNotice(true, false),
		budgetCommand: api.commandBudgetRefusal("n1", "x".repeat(2_000_000)),
		budgetMessage: api.messageBudgetRefusal("x".repeat(2_000_000), []),
		attachmentRead: api.unreadableAttachmentRefusal(["/n1/f1"]),
		imageOverflow: api.imageOverflowRefusal(2),
		fileOverflow: api.fileOverflowRefusal(1),
		quotaSent: api.quotaResendSentSentence(),
		quotaRefresh: api.quotaRefreshSentence("failed"),
		readAckClause: api.READ_ACK_NOTICE_CLAUSE.pending,
		readAckDescription: api.READ_ACK_NOTICE_DESCRIPTION.unsettled,
		moveReceipt: api.moveReceiptLine(
			{ outcome: "unchanged", label: "n1" },
			false,
		),
		moveUnavailable: api.moveUnavailableReason(),
		fastNotice: api.fastModelPickNotice(true, "on"),
		fastFailure: api.fastPickFailure(new Error("n1")),
		fastUnavailable: api.fastUnavailableSentence(),
		askWaited: api.askWaitedText(125),
		askResponse: api.askResponseSummary({ askId: "n1", status: "declined" }),
		askStatus: api.ASK_STATUS_COPY.timed_out,
		askExpired: api.askExpiredMessage(),
		credentialCleared: api.clearedNotice("n1", 1, "n2"),
		credentialTyping: api.credentialTypingNotice(),
		credentialChip: api.unconfirmedChipLabel("n1"),
	};
	for (const [name, text] of Object.entries(cases)) {
		assert.match(
			text,
			/XX ui\./,
			`${name} did not resolve through t(): ${text}`,
		);
		// Placeholders arrive as values (digits, `n1`); any English word left over
		// is copy that bypassed the catalogue.
		assert.doesNotMatch(
			residue(text),
			/[A-Za-z]{4,}/,
			`${name} still carries English: ${text}`,
		);
	}
});

/**
 * Candidate English sentences in a source file: a string or template literal
 * with two adjacent words, outside comments and outside `t("...")` key
 * arguments. Class lists, selectors and identifiers (lowercase, no sentence
 * punctuation) are not sentences.
 */
function englishLiterals(source) {
	const found = [];
	let inBlock = false;
	source.split("\n").forEach((raw, index) => {
		let line = raw;
		if (inBlock) {
			const end = line.indexOf("*/");
			if (end === -1) return;
			inBlock = false;
			line = line.slice(end + 2);
		}
		line = line.replace(/\/\*.*?\*\//g, "");
		const start = line.indexOf("/*");
		if (start !== -1) {
			inBlock = true;
			line = line.slice(0, start);
		}
		line = line.replace(/(^|\s)\/\/.*$/, "$1");
		if (/^\s*(import|export\b.*\bfrom)\b/.test(line)) return;
		line = line.replace(/\bt\(\s*(["`])[^"`]*\1/g, "t()");
		for (const match of line.matchAll(/(["`])((?:\\.|(?!\1).)*)\1/g)) {
			const text = match[2];
			if (!/[A-Za-z]{3,} [A-Za-z]{2,}/.test(text)) continue;
			if (/^[a-z0-9@[\]:/_.%()*>&!,=#' -]+$/.test(text) && !/[.…:]$/.test(text))
				continue;
			found.push({ line: index + 1, text });
		}
	});
	return found;
}

/** Every module whose English this slice moved behind `t()`. */
const MIGRATED = [
	"src/renderer/src/features/chat/ask-answer.ts",
	"src/renderer/src/features/chat/ask-queue.ts",
	"src/renderer/src/features/chat/aside.ts",
	"src/renderer/src/features/chat/interrupt-turn.ts",
	"src/renderer/src/features/chat/read-ack-notice.ts",
	"src/renderer/src/features/chat/move-session.ts",
	"src/renderer/src/features/chat/draft-selection.ts",
	"src/renderer/src/features/chat/quota-notice/quota-notice.ts",
	"src/renderer/src/features/chat/session-status/session-cost.ts",
	"src/renderer/src/features/chat/session-status/session-context.ts",
	"src/renderer/src/features/chat/session-status/session-model.ts",
	"src/renderer/src/features/chat/utils/message-budget.ts",
	"src/renderer/src/features/chat/utils/attachment-read.ts",
	"src/renderer/src/features/chat/device/chat-device-model.ts",
	"src/renderer/src/features/chat/components/slash-contract.ts",
	"src/renderer/src/features/chat/components/slash-dispatch.ts",
	"src/renderer/src/features/chat/components/slash-argument-rows.ts",
	"src/renderer/src/features/chat/components/skill-contract.ts",
	"src/renderer/src/features/chat/components/at-contract.ts",
	"src/renderer/src/features/chat/components/credential-capture.ts",
	"src/renderer/src/features/chat/components/trace/agent-question.tsx",
];

/**
 * English that is deliberately NOT copy. [file, literal prefix, reason].
 */
const ENGLISH_BY_DESIGN = [
	[
		"src/renderer/src/features/chat/ask-queue.ts",
		"<not provided>",
		"The wire sentinel the backend writes into a masked secret cell; compared, never shown as prose.",
	],
	[
		"src/renderer/src/features/chat/aside.ts",
		"The request has invalid fields.",
		"The owner's exact refusal string, matched to detect an owner that predates a field; changing it breaks the match.",
	],
	[
		"src/renderer/src/features/chat/components/slash-argument-rows.ts",
		"Stored credential",
		"The accounts route's sentinel for 'no label found', compared against, never rendered.",
	],
	[
		"src/renderer/src/features/chat/components/credential-capture.ts",
		"[credential",
		"Citations the app writes INTO the message the AGENT reads (and parses back); model-facing protocol text, rendered to the user as a chip. Not UI copy.",
	],
	[
		"src/renderer/src/features/chat/components/credential-capture.ts",
		"bash and eval as",
		"Second half of the same model-facing citation; see the entry above.",
	],
];

test("the literal guard catches an English sentence and spares keyed copy (negative control)", () => {
	assert.equal(
		englishLiterals('const X = "Your answer was not sent.";').length,
		1,
	);
	assert.equal(
		englishLiterals("return `Moved to ${name} - all done now.`;").length,
		1,
	);
	assert.equal(
		englishLiterals('return t("ui.chat.aside.not_answered");').length,
		0,
	);
	assert.equal(englishLiterals('// "A comment sentence like this."').length, 0);
	assert.equal(
		englishLiterals('className="flex items-center gap-2"').length,
		0,
	);
});

test("no migrated module carries an English sentence outside the by-design list", async () => {
	const used = new Set();
	for (const file of MIGRATED) {
		const source = await readFile(file, "utf8");
		for (const { line, text } of englishLiterals(source)) {
			const index = ENGLISH_BY_DESIGN.findIndex(
				([entryFile, prefix]) => entryFile === file && text.startsWith(prefix),
			);
			assert.notEqual(
				index,
				-1,
				`${file}:${line} is an English literal that may reach the UI - key it with t(), or add it to ENGLISH_BY_DESIGN with a reason: ${text.slice(0, 90)}`,
			);
			used.add(index);
		}
	}
	ENGLISH_BY_DESIGN.forEach((entry, index) =>
		assert.ok(
			used.has(index),
			`stale ENGLISH_BY_DESIGN entry: ${entry[0]} ${entry[1]}`,
		),
	);
});

test("the character cap is formatted in the MESSAGE's locale, like the count beside it", () => {
	/*
	 * m1 (review round 1). `limit` came from `Number#toLocaleString()`, whose
	 * locale is the RUNTIME's - en-US in CI and on most machines - while the
	 * `{count}` in the same clause is ICU-formatted in the locale that ANSWERED.
	 * A French refusal therefore read "200 001 caracteres, plus que les 200,000
	 * caracteres": two grouping styles in one sentence, in every non-en locale.
	 * Both halves now come from `formatNumber`, and U+202F is fr's own group
	 * separator (`Intl.NumberFormat("fr").format(200000)`).
	 */
	setLocale("fr");
	try {
		const message = api.messageBudgetRefusal("x".repeat(200_001), []);
		assert.ok(
			message.includes("200\u202f001"),
			`the count is ICU's: ${message}`,
		);
		assert.ok(
			message.includes("200\u202f000"),
			`the cap must use the message locale's digits: ${message}`,
		);
		assert.ok(
			!message.includes("200,000"),
			`the cap was formatted in the runtime's locale: ${message}`,
		);
		// The sibling arm, so a fix applied to one call site cannot leave the
		// command refusal on the old spelling.
		const command = api.commandBudgetRefusal("model", "x".repeat(200_001));
		assert.ok(
			!command.includes("200,000") && command.includes("200\u202f000"),
			`command arm: ${command}`,
		);
	} finally {
		// The rest of this file reads copy through the marker locale.
		useMarkerLocale();
	}
});
