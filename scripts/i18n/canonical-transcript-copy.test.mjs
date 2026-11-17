import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE REAL TRANSCRIPT'S ENGLISH THAT WAS NEVER A KEY.
 *
 * Switching to French left English in the one place a reader looks at while an
 * agent works, and the string ratchet could not see it, because none of it was
 * JSX text: it was built in code (module constants, template literals, a
 * `${n} tools` expression).
 *
 *   the WORKING LINE   `working-line-model.ts` built `running ${n} tools`,
 *                      `composing a call`, `waiting for the agent`, ... and
 *                      `WorkingLine` printed that string raw.
 *   BROKEN ATTACHMENTS `attachment-frame.tsx` glued `${name} ${COPY}`, three
 *                      constants ("could not be displayed/played ...").
 *   the LINK STRIP     `link-actions.ts` labels (Quote, Copy link, ...), the
 *                      too-large notes and `No file at ${path}`.
 *
 * Three properties, for three readers (same contract as
 * `edit-agent-literals.test.mjs` and `s18d-english-source-copy.test.mjs`):
 *
 * 1. ENGLISH IS BYTE-IDENTICAL to what the code printed before the keys existed.
 *    The expected strings are LITERALS copied from the old source, never read
 *    back from the catalogue, so a catalogue edit cannot quietly move the pin.
 * 2. A REGISTERED PROBE LOCALE REACHES EACH SURFACE, switching LIVE on a tree
 *    that was mounted and driven in English. The probes are markers, not
 *    translations (those live in `src/i18n/catalogues/<locale>/`). `ur` is the
 *    RTL probe: it proves the name, tool and path are isolated for a right-to-
 *    left sentence, and that English never survives under it. There is no real
 *    `ur` assertion yet because translations are a separate step of this work;
 *    the coverage gate is the one that goes red until they land.
 * 3. THE LADDER SPEAKS IN DATA, NOT ENGLISH: `deriveWorkingLine` returns a rung
 *    plus arguments, so nothing downstream (the clock, the child reader's
 *    classification) compares words.
 *
 * THE CONTROL IS REAL: `CANONICAL_TRANSCRIPT_CONTROL_BASE=<sha> node --test
 * <this file>` loads the five touched modules from that commit instead of the
 * working tree. Every surface below is driven through the SHIPPED pipeline
 * (ladder -> `WorkingLine`, `BrokenAttachment`, `linkToolbarModel`) and never
 * through a helper that only exists after the fix, so on the parent of the
 * keying commit the English pins PASS and every probe/structure assertion FAILS:
 * the pins describe the old output and the probes discriminate.
 */

const ROOT = process.cwd();
const controlBase = process.env.CANONICAL_TRANSCRIPT_CONTROL_BASE;
const CHAT = "src/renderer/src/features/chat";
const TOUCHED = new Set([
	`${CHAT}/canonical/working-line-model.ts`,
	`${CHAT}/components/trace/working-line.tsx`,
	`${CHAT}/components/run-details/run-detail-model.ts`,
	`${CHAT}/components/message-item/attachment-frame.tsx`,
	`${CHAT}/utils/link-actions.ts`,
]);

const baseSource = (path) =>
	execFileSync("git", ["show", `${controlBase}:${path}`], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

/* Hoisted: biome's `useTopLevelRegex`. */
const TS_FILE = /\.tsx?$/;

const controlPlugin = {
	name: "pre-fix-canonical-transcript-control",
	setup(builder) {
		builder.onLoad({ filter: TS_FILE }, ({ path }) => {
			const rel = relative(ROOT, path);
			if (!TOUCHED.has(rel)) return undefined;
			return {
				contents: baseSource(rel),
				loader: rel.endsWith(".tsx") ? "tsx" : "ts",
				resolveDir: dirname(path),
			};
		});
	},
};

/* jsdom BEFORE the bundle is imported: shared modules touch `window` at import. */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"Element",
	"Node",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"HTMLElement",
	"SVGElement",
	"DocumentFragment",
	"MutationObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* On the WINDOW as well: `useMediaQuery` reads `window.matchMedia`, and jsdom has none. */
globalThis.matchMedia ??= dom.window.matchMedia ??= (query) => ({
	matches: false,
	media: query,
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	for (const name of ["window", "document", "localStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const bundle = await build({
	stdin: {
		contents: `export { WorkingLine } from "./${CHAT}/components/trace/working-line";
export { deriveWorkingLine, workingLineInputFor } from "./${CHAT}/canonical/working-line-model";
export { deriveChildWorkingLine } from "./${CHAT}/components/run-details/run-detail-model";
export * as frame from "./${CHAT}/components/message-item/attachment-frame";
export { linkToolbarModel, missingNote } from "./${CHAT}/utils/link-actions";
export { setLocale, registerCatalogue, clearRegisteredCatalogues, t } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	plugins: controlBase ? [controlPlugin] : [],
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
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
// A FILE, not a data: URL: `react` stays external and a data: module cannot
// resolve a bare specifier.
const bundlePath = new URL(
	"./_canonical-transcript-copy.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	WorkingLine,
	deriveWorkingLine,
	workingLineInputFor,
	deriveChildWorkingLine,
	frame,
	linkToolbarModel,
	missingNote,
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
	t,
} = mod;

const catalogue = (ns) =>
	JSON.parse(
		readFileSync(join(ROOT, `src/i18n/catalogues/en/${ns}.json`), "utf8"),
	);
const sidecar = (ns) =>
	JSON.parse(
		readFileSync(
			join(ROOT, `src/i18n/catalogues/en/${ns}.context.json`),
			"utf8",
		),
	);

const WL = "ui.chat.canonical.working_line.";
const LA = "ui.chat.canonical.link_actions.";
const AT = "ui.chat.attachments.";

/* key -> [namespace file, params, the English the OLD code printed]. */
const KEYS = {
	[`${WL}thinking`]: ["ui.chat.canonical", {}, "thinking"],
	[`${WL}responding`]: ["ui.chat.canonical", {}, "responding"],
	[`${WL}waiting_for_agent`]: [
		"ui.chat.canonical",
		{},
		"waiting for the agent",
	],
	[`${WL}starting_session`]: ["ui.chat.canonical", {}, "starting the session"],
	[`${WL}compacting`]: ["ui.chat.canonical", {}, "compacting context"],
	[`${WL}stopping`]: ["ui.chat.canonical", {}, "stopping the turn"],
	[`${WL}running_tool`]: [
		"ui.chat.canonical",
		{ tool: "bash" },
		"running bash",
	],
	[`${WL}running_tools`]: [
		"ui.chat.canonical",
		{ count: 3, count_display: "3" },
		"running 3 tools",
	],
	[`${WL}composing`]: [
		"ui.chat.canonical",
		{ count: 1, count_display: "1" },
		"composing a call",
	],
	[`${WL}queued`]: [
		"ui.chat.canonical",
		{ count: 2, count_display: "2" },
		"waiting to run 2 calls",
	],
	[`${AT}broken_moved`]: [
		"ui.chat.attachments",
		{ name: "a.png" },
		"a.png could not be displayed. It may have been moved, renamed, or deleted.",
	],
	[`${AT}broken_unavailable`]: [
		"ui.chat.attachments",
		{ name: "a.png" },
		"a.png could not be displayed. Its stored copy is not available to this reader.",
	],
	[`${AT}broken_media_unavailable`]: [
		"ui.chat.attachments",
		{ name: "a.mp4" },
		"a.mp4 could not be played. Its stored copy is not available to this reader.",
	],
	[`${LA}quote`]: ["ui.chat.canonical", {}, "Quote"],
	[`${LA}copy_link`]: ["ui.chat.canonical", {}, "Copy link"],
	[`${LA}open_in_browser`]: ["ui.chat.canonical", {}, "Open in browser"],
	[`${LA}copy_path`]: ["ui.chat.canonical", {}, "Copy path"],
	[`${LA}open`]: ["ui.chat.canonical", {}, "Open"],
	[`${LA}open_in_canvas`]: ["ui.chat.canonical", {}, "Open in canvas"],
	[`${LA}open_in_default_app`]: [
		"ui.chat.canonical",
		{},
		"Open in default app",
	],
	[`${LA}open_folder`]: ["ui.chat.canonical", {}, "Open folder"],
	[`${LA}too_large_note`]: [
		"ui.chat.canonical",
		{},
		"Too large for the canvas preview",
	],
	[`${LA}too_large_title`]: [
		"ui.chat.canonical",
		{},
		"Too large for the canvas preview, so Open uses the default app",
	],
	[`${LA}missing_file`]: [
		"ui.chat.canonical",
		{ path: "/tmp/a.pdf" },
		"No file at /tmp/a.pdf",
	],
};

test("every key this surface reads exists, has a context entry, and renders the old English", () => {
	setLocale("en");
	for (const [key, [ns, args, english]] of Object.entries(KEYS)) {
		assert.ok(key in catalogue(ns), `${key} is in ${ns}.json`);
		const context = sidecar(ns)[key];
		assert.ok(context, `${key} has a context entry`);
		assert.deepEqual(
			Object.keys(context.placeholders ?? {}).sort(),
			Object.keys(args).sort(),
			`${key}'s sidecar documents exactly its placeholders`,
		);
		assert.equal(t(key, args), english, key);
	}
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* Markers, not translations: each carries the key's last segment (UPPER case,
 * so the word never collides with the English it must replace) so a surface
 * wired to the WRONG key fails, and the placeholder value so a dropped
 * argument fails. */
const probe = (locale) =>
	Object.fromEntries(
		Object.entries(KEYS).map(([key, [, args]]) => [
			key,
			/* The same placeholders the English takes, as ICU arguments. */
			`${locale.toUpperCase()}[${key.split(".").slice(-1)[0].toUpperCase()}]${Object.keys(
				args,
			)
				.filter((name) => name !== "count")
				.map((name) => `{${name}}`)
				.join("|")}`,
		]),
	);

async function switchTo(locale, messages = probe(locale)) {
	await act(async () => {
		registerCatalogue(locale, messages);
		setLocale(locale);
		await flush();
	});
}

async function backToEnglish() {
	await act(async () => {
		clearRegisteredCatalogues();
		setLocale("en");
		await flush();
	});
}

async function mount(element) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(element);
		await flush();
	});
	return {
		host,
		text: () => host.textContent,
		/* The working line's WORDS: the spinner glyph and the clock slot are
		 * separate spans beside it and are not copy. */
		label: () =>
			host.querySelector("[data-lo-working-line]")?.children[1]?.textContent,
		async unmount() {
			await act(async () => {
				root.unmount();
				await flush();
			});
			host.remove();
		},
	};
}

/* ---------------------------------------------------------------- ladder */

const toolRow = (over = {}) => ({
	kind: "tool",
	id: "t1",
	ts: 1,
	toolCallId: "t1",
	toolName: "bash",
	intent: null,
	args: null,
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt: 1_000,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	...over,
});

const pane = (over = {}) => ({
	waiting: true,
	compacting: false,
	starting: false,
	gate: false,
	unavailable: false,
	records: [],
	...over,
});

/* label -> [the pane that reaches the rung, the English the old code printed,
 * the structured value, the probe marker (locale fr)]. */
const RUNGS = {
	thinking: [pane(), "thinking", { kind: "thinking" }, "FR[THINKING]"],
	responding: [
		pane({
			records: [
				{
					kind: "assistant",
					id: "a1",
					ts: 1,
					text: "Streaming",
					streaming: true,
					stopReason: null,
					error: false,
				},
			],
		}),
		"responding",
		{ kind: "responding" },
		"FR[RESPONDING]",
	],
	"waiting for the agent": [
		pane({ waiting: false, starting: true }),
		"waiting for the agent",
		{ kind: "waiting_for_agent" },
		"FR[WAITING_FOR_AGENT]",
	],
	"starting the session": [
		pane({ waiting: false, starting: true, startingSession: true }),
		"starting the session",
		{ kind: "starting_session" },
		"FR[STARTING_SESSION]",
	],
	"compacting context": [
		pane({ waiting: false, compacting: true }),
		"compacting context",
		{ kind: "compacting" },
		"FR[COMPACTING]",
	],
	"stopping the turn": [
		pane({ stopping: true }),
		"stopping the turn",
		{ kind: "stopping" },
		"FR[STOPPING]",
	],
	"running one tool": [
		pane({ records: [toolRow()] }),
		"running bash",
		{ kind: "running_tool", tool: "bash" },
		"FR[RUNNING_TOOL]bash",
	],
	"running a batch": [
		pane({
			records: [toolRow(), toolRow({ id: "t2" }), toolRow({ id: "t3" })],
		}),
		"running 3 tools",
		{ kind: "running_tools", count: 3 },
		"FR[RUNNING_TOOLS]3",
	],
	"composing one call": [
		pane({ records: [toolRow({ phase: "composing", startedAt: null })] }),
		"composing a call",
		{ kind: "composing", count: 1 },
		"FR[COMPOSING]1",
	],
	"composing two calls": [
		pane({
			records: [
				toolRow({ phase: "composing", startedAt: null }),
				toolRow({ id: "t2", phase: "composing", startedAt: null }),
			],
		}),
		"composing 2 calls",
		{ kind: "composing", count: 2 },
		"FR[COMPOSING]2",
	],
	"waiting to run a call": [
		pane({ records: [toolRow({ phase: "queued", startedAt: null })] }),
		"waiting to run a call",
		{ kind: "queued", count: 1 },
		"FR[QUEUED]1",
	],
	"waiting to run calls": [
		pane({
			records: [
				toolRow({ phase: "queued", startedAt: null }),
				toolRow({ id: "t2", phase: "queued", startedAt: null }),
			],
		}),
		"waiting to run 2 calls",
		{ kind: "queued", count: 2 },
		"FR[QUEUED]2",
	],
};

const rung = (label) => deriveWorkingLine(workingLineInputFor(RUNGS[label][0]));

/* The one place a rung becomes pixels is `WorkingLine`, mounted with whatever
 * the ladder derived (an opaque pass-through, so the control mode's old string
 * and the new structured value both go through the same line of the test). */
const lineOf = (state) =>
	React.createElement(WorkingLine, {
		activity: state.activity,
		phase: state.phase,
		clock: false,
	});

for (const label of Object.keys(RUNGS)) {
	const [, english, structured, frMarker] = RUNGS[label];

	test(`working line (${label}): English is byte-identical`, async () => {
		setLocale("en");
		const m = await mount(lineOf(rung(label)));
		try {
			assert.equal(m.label(), english);
		} finally {
			await m.unmount();
		}
	});

	test(`working line (${label}): the ladder derives data, not English`, () => {
		assert.deepEqual(rung(label).activity, structured);
	});

	test(`working line (${label}): follows a live switch to a probe locale, and to RTL ur`, async () => {
		setLocale("en");
		const state = rung(label);
		const m = await mount(lineOf(state));
		try {
			assert.equal(m.label(), english);
			await switchTo("fr");
			assert.equal(m.label(), frMarker, "fr probe");
			assert.ok(!m.label().includes(english), "no English under fr");
			await switchTo("ur");
			const seen = m.label();
			assert.ok(seen.startsWith("UR["), `ur probe: ${JSON.stringify(seen)}`);
			assert.ok(!seen.includes(english), "no English under ur");
			/* A tool identifier is LTR inside an RTL sentence: isolated, exactly
			 * where the sentence is not English. */
			if (structured.kind === "running_tool")
				assert.ok(seen.includes("\u2066bash\u2069"), JSON.stringify(seen));
		} finally {
			await m.unmount();
			await backToEnglish();
		}
	});
}

test("working line: the model's own intent and a relay's words are shown as written, in every language", async () => {
	setLocale("en");
	const state = deriveWorkingLine(
		workingLineInputFor(
			pane({
				records: [toolRow({ intent: "Auditing tickets against merged MRs" })],
			}),
		),
	);
	const m = await mount(lineOf(state));
	try {
		assert.equal(m.label(), "Auditing tickets against merged MRs");
		await switchTo("fr");
		assert.equal(m.label(), "Auditing tickets against merged MRs");
	} finally {
		await m.unmount();
		await backToEnglish();
	}
});

/* The child reader: the wire carries English words; only the two the relay's
 * own constants put there are keyed. */
const childRow = (activity) => ({
	id: "c1",
	status: "running",
	activity,
});

for (const [wire, kind, phase, frMarker] of [
	["thinking", "thinking", "thinking", "FR[THINKING]"],
	["responding", "responding", "responding", "FR[RESPONDING]"],
	[undefined, "thinking", "thinking", "FR[THINKING]"],
	["running 3 tools", "text", "running", "running 3 tools"],
	["running read_file", "text", "running", "running read_file"],
]) {
	test(`child reader (${wire ?? "no activity"}): classified from the wire word, painted in the active language`, async () => {
		setLocale("en");
		const state = deriveChildWorkingLine(childRow(wire));
		assert.equal(state.phase, phase);
		if (typeof state.activity === "object")
			assert.equal(state.activity.kind, kind);
		const m = await mount(lineOf(state));
		try {
			assert.equal(m.label(), wire ?? "thinking");
			await switchTo("fr");
			assert.equal(m.label(), frMarker);
		} finally {
			await m.unmount();
			await backToEnglish();
		}
	});
}

/* ------------------------------------------------------ broken attachment */

/* The props that select a sentence differ across the fix (`detail=<constant>`
 * before, `kind=` after); resolving them from the bundle keeps the English pins
 * runnable against the control. */
const unavailableProps = () =>
	"kind" in (frame.BrokenAttachment.defaultProps ?? {}) ||
	frame.ATTACHMENT_UNAVAILABLE_COPY === undefined
		? { kind: "unavailable" }
		: { detail: frame.ATTACHMENT_UNAVAILABLE_COPY };
const mediaProps = () =>
	frame.VIDEO_UNAVAILABLE_COPY === undefined
		? { kind: "media_unavailable" }
		: { detail: frame.VIDEO_UNAVAILABLE_COPY };

const BROKEN = {
	moved: [
		() => ({}),
		"a.png",
		"a.png could not be displayed. It may have been moved, renamed, or deleted.",
		"FR[BROKEN_MOVED]a.png",
	],
	unavailable: [
		unavailableProps,
		"a.png",
		"a.png could not be displayed. Its stored copy is not available to this reader.",
		"FR[BROKEN_UNAVAILABLE]a.png",
	],
	"media unavailable": [
		mediaProps,
		"a.mp4",
		"a.mp4 could not be played. Its stored copy is not available to this reader.",
		"FR[BROKEN_MEDIA_UNAVAILABLE]a.mp4",
	],
};

for (const [label, [propsFor, name, english, frMarker]] of Object.entries(
	BROKEN,
)) {
	for (const compact of [false, true]) {
		const shape = compact ? "compact tile" : "full card";
		test(`broken attachment (${label}, ${shape}): English is byte-identical`, async () => {
			setLocale("en");
			const m = await mount(
				React.createElement(frame.BrokenAttachment, {
					name,
					compact,
					...propsFor(),
				}),
			);
			try {
				if (compact) {
					const tile = m.host.querySelector("[role='img']");
					assert.equal(tile.getAttribute("aria-label"), english);
					assert.equal(tile.getAttribute("title"), english);
				} else assert.equal(m.text().trim(), english);
			} finally {
				await m.unmount();
			}
		});

		test(`broken attachment (${label}, ${shape}): one whole message, live-switched, name isolated for RTL`, async () => {
			setLocale("en");
			const m = await mount(
				React.createElement(frame.BrokenAttachment, {
					name,
					compact,
					...propsFor(),
				}),
			);
			const read = () =>
				compact
					? [
							m.host.querySelector("[role='img']").getAttribute("aria-label"),
							m.host.querySelector("[role='img']").getAttribute("title"),
						]
					: [m.text().trim()];
			try {
				await switchTo("fr");
				for (const seen of read()) assert.equal(seen, frMarker);
				await switchTo("ur");
				for (const seen of read()) {
					assert.equal(
						seen,
						`${frMarker.replace("FR", "UR").replace(name, `\u2066${name}\u2069`)}`,
					);
					assert.ok(!seen.includes("could not be"), "no English under ur");
				}
			} finally {
				await m.unmount();
				await backToEnglish();
			}
		});
	}
}

/* ------------------------------------------------------------ link strip */

const LINK_ENGLISH = [
	[
		"url",
		{ kind: "url", target: "https://example.com/x", probe: null },
		["Quote", "Copy link", "Open in browser"],
		null,
	],
	[
		"file with a canvas viewer",
		{
			kind: "file",
			target: "/tmp/a/notes.md",
			probe: null,
			canOpenInCanvas: true,
		},
		[
			"Quote",
			"Copy path",
			"Open in canvas",
			"Open in default app",
			"Open folder",
		],
		null,
	],
	[
		"file without a canvas viewer",
		{
			kind: "file",
			target: "/tmp/a/archive.bin",
			probe: null,
			canOpenInCanvas: false,
		},
		["Quote", "Copy path", "Open", "Open folder"],
		null,
	],
	[
		"directory",
		{
			kind: "file",
			target: "/tmp/a",
			probe: { exists: true, isFile: false, sizeBytes: null, mtimeMs: null },
			canOpenInCanvas: false,
		},
		["Quote", "Copy path", "Open"],
		null,
	],
	[
		"missing file",
		{
			kind: "file",
			target: "/tmp/lo-link-missing/report-2026-09-17.pdf",
			probe: { exists: false },
			canOpenInCanvas: false,
		},
		["Quote", "Copy path"],
		[
			"No file at report-2026-09-17.pdf",
			"No file at /tmp/lo-link-missing/report-2026-09-17.pdf",
		],
	],
	[
		"file over the read ceiling",
		{
			kind: "file",
			target: "/tmp/a/big.md",
			probe: {
				exists: true,
				isFile: true,
				sizeBytes: Number.MAX_SAFE_INTEGER,
				mtimeMs: null,
			},
			canOpenInCanvas: true,
		},
		["Quote", "Copy path", "Open", "Open folder"],
		[
			"Too large for the canvas preview",
			"Too large for the canvas preview, so Open uses the default app",
		],
	],
];

const modelFor = (input) =>
	linkToolbarModel({ quotable: false, canOpenInCanvas: false, ...input });

for (const [label, input, labels, notes] of LINK_ENGLISH) {
	test(`link strip (${label}): English is byte-identical`, () => {
		setLocale("en");
		const model = modelFor(input);
		/* Quote sits last when nothing is highlighted; order is not what is pinned. */
		assert.deepEqual(
			[...model.actions.map((a) => a.label)].sort(),
			[...labels].sort(),
		);
		assert.equal(model.note, notes?.[0] ?? null);
		assert.equal(model.noteTitle, notes?.[1] ?? null);
	});

	test(`link strip (${label}): follows a live switch to a probe locale, and RTL ur`, async () => {
		setLocale("en");
		const english = modelFor(input);
		await switchTo("fr", {
			...probe("fr"),
			"ui.chat.canonical.link_actions.missing_file": "FR[MISSING]{path}",
		});
		try {
			const fr = modelFor(input);
			assert.ok(
				fr.actions.every((a) => a.label.startsWith("FR[")),
				JSON.stringify(fr.actions.map((a) => a.label)),
			);
			assert.equal(fr.actions.length, english.actions.length);
			if (notes) {
				assert.ok(fr.note.startsWith("FR["), JSON.stringify(fr.note));
				assert.ok(fr.noteTitle.startsWith("FR["), JSON.stringify(fr.noteTitle));
			}
			await switchTo("ur", {
				...probe("ur"),
				"ui.chat.canonical.link_actions.missing_file": "UR[MISSING]{path}",
			});
			const ur = modelFor(input);
			assert.ok(ur.actions.every((a) => a.label.startsWith("UR[")));
			if (notes) {
				assert.ok(ur.note.startsWith("UR["), JSON.stringify(ur.note));
				assert.ok(!ur.note.includes("No file at"), "no English under ur");
			}
		} finally {
			await backToEnglish();
		}
	});
}

test("link strip: a path is isolated for RTL, and only for RTL", async () => {
	setLocale("en");
	const target = "/tmp/lo-link-missing/report-2026-09-17.pdf";
	assert.ok(
		!missingNote(target).title.includes("\u2066"),
		"LTR carries no controls",
	);
	await switchTo("ur", {
		"ui.chat.canonical.link_actions.missing_file": "UR[MISSING]{path}",
	});
	try {
		const { note, title } = missingNote(target);
		assert.equal(title, `UR[MISSING]\u2066${target}\u2069`);
		assert.equal(note, "UR[MISSING]\u2066report-2026-09-17.pdf\u2069");
	} finally {
		await backToEnglish();
	}
});

test("link strip: the missing-note budget chooses between whole messages, never slices a translated one", async () => {
	setLocale("en");
	/* English, unchanged: fits with its directory, else falls to the base name. */
	assert.deepEqual(missingNote("/tmp/out/a.pdf"), {
		note: "No file at …/out/a.pdf",
		title: "No file at /tmp/out/a.pdf",
	});
	/* A frame several times longer than English's, the shape fr/ru/vi/hi can
	 * produce: with a directory it no longer fits the slot, so the base-name
	 * message is chosen WHOLE, and the base name is intact at its end. */
	const long = "Aucun fichier n'existe à l'emplacement {path}";
	await switchTo("fr", {
		"ui.chat.canonical.link_actions.missing_file": long,
	});
	try {
		const target = "/tmp/out/a.pdf";
		const { note, title } = missingNote(target);
		assert.equal(note, "Aucun fichier n'existe à l'emplacement a.pdf");
		assert.equal(
			title,
			"Aucun fichier n'existe à l'emplacement /tmp/out/a.pdf",
		);
		assert.ok(
			note.endsWith("a.pdf"),
			"the base name is the last thing given up",
		);
		/* A short frame keeps its directory, as English does. */
		await switchTo("fr", {
			"ui.chat.canonical.link_actions.missing_file": "Absent : {path}",
		});
		assert.equal(missingNote(target).note, "Absent : …/out/a.pdf");
	} finally {
		await backToEnglish();
	}
});
