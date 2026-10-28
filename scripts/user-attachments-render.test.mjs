/**
 * The canvas Attachments section and the sent-file card, RENDERED.
 *
 *     node --test scripts/user-attachments-render.test.mjs
 *
 * WHY A SECOND FILE BESIDE `user-attachments.test.mjs`. That suite pins the
 * pure projection; the defects agent review round 2 found (PR #1452) sit in
 * the paint and the menu: whether a tile SAYS a picture was moved (R2-2), and
 * whether a backend without `session_attachments` is offered actions that can
 * only 404 (R2-1). Neither is visible in the model, so these tests mount the
 * shipped `CanvasFileViewer` / `SentFileCard` in jsdom (no layout - geometry
 * stays with the real-browser QA pass) and read the DOM and the opened menu.
 *
 * The transport is the one seam: `window.api.desktop.request` records every
 * op, so "nothing calls a route that cannot answer" is an assertion on the
 * request log, not an inference from the menu.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Radix/virtualiser plumbing jsdom lacks; no layout is asserted here.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
window.ResizeObserver = globalThis.ResizeObserver;
window.matchMedia ??= (query) => ({
	matches: false,
	media: query,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.releasePointerCapture ??= () => {};

/** Every desktop op the renderer sent, in order. */
const requests = [];
/** Digest -> stored bytes the media relay answers with (default: a PNG head). */
const mediaBytes = new Map();
/** Every `saveFile` the renderer asked the bridge for (U12 / Q1). */
const saves = [];
window.api = {
	desktop: {
		request: async (request) => {
			requests.push(request.op);
			return { status: 404, body: {} };
		},
		// The transcript's pictures fetch their bytes by digest (Q1 tests).
		media: async (request) => {
			requests.push(request.op);
			const stored = mediaBytes.get(request.digest);
			if (stored) return { kind: "bytes", ...stored };
			return {
				kind: "bytes",
				data: new Uint8Array([137, 80, 78, 71]),
				mimeType: "image/png",
			};
		},
	},
	// The sent-file card's existence probe: every path is present.
	probeFiles: async (paths) =>
		paths.map((path) => ({ resolved: path, exists: true, isFile: true })),
	saveFile: async (path, text) => {
		saves.push({ path, text });
	},
};
// CodeMirror measures text through Range rects, which jsdom does not lay out.
window.Range.prototype.getClientRects ??= () => [];
window.Range.prototype.getBoundingClientRect ??= () => ({
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
});
URL.createObjectURL ??= () => "blob:http://localhost/stub";
URL.revokeObjectURL ??= () => {};
Object.defineProperty(window.navigator, "clipboard", {
	configurable: true,
	value: { writeText: async () => {} },
});

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");

const bundled = await build({
	stdin: {
		contents: `
 export { CanvasFileViewer } from "./src/renderer/src/features/chat/components/canvas/canvas-file-viewer";
 export { SentFileCard } from "./src/renderer/src/features/chat/canonical/sent-file-card";
 export { mergeUserAttachments } from "./src/renderer/src/features/chat/canonical/user-attachments";
 export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
 export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
 export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
 export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
 export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
 export { CanvasContent } from "./src/renderer/src/features/chat/components/canvas/canvas-content";
 export { adoptBuffer, proposeBuffer, saveBuffer, resetBuffers, setBufferPorts } from "./src/renderer/src/features/chat/components/canvas/document-buffers";
 export { useCanvasStore } from "./src/renderer/src/shared/store/canvas-store";
 export { canvasDocumentForPath } from "./src/renderer/src/features/chat/utils/canvas-document";
 `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import"],
	loader: { ".css": "empty", ".png": "empty", ".svg": "empty" },
	// Vite's env object; the config loader enumerates it at import.
	define: { "import.meta.env": "{}" },
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
	// One React for the component and this file's renderer.
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
// A file beside this one, not a data: URL: the externals above must resolve
// from `node_modules` (the `canvas-goals.test.mjs` idiom).
const bundlePath = new URL(
	"./_user-attachments-render.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundled.outputFiles[0].text);
const api = await import(bundlePath.href);
await unlink(bundlePath);
after(() => dom.window.close());

const RETAINED = /Moved or deleted · saved copy kept/;
const SAVED_COPY = /Saved copy/;
const ARTIFACT_PATH = /^artifact:/;
const ENV_BODY = /DEBUG=1/;
const REFUSED_HINT = /Looks like a secret, so file actions are off/;
const BARE_SIZE = /2 KB/;
const PARTIAL = /May be incomplete/;
const LOADING = /Loading/;
const FILE_PATH_CONTROL = /^Copy path$|Actions for/;
const SESSION = "abcdef123456";
const SHOT = "ec18e8fa93ec9e1bf7eacbfa9a5cae99";
const PDF = "894b00b1b8535352f0b5ee73063d7661";
const READY_INDEX = {
	mode: "index",
	state: "ready",
	rows: [],
	total: 0,
	statComplete: true,
	error: null,
	coveredBytes: 0,
	totalBytes: 0,
	loadedRows: 0,
	pendingTotal: 0,
	refresh: () => {},
};

/** A dragged-in picture whose origin is gone while the store kept a copy. */
const movedPicture = {
	message_id: "m-moved",
	ts: 1793117300,
	index: 0,
	kind: "image",
	attachment: SHOT,
	filename: "shot.png",
	mime_type: "image/png",
	bytes: 2048,
	path: "/Users/x/Desktop/shot.png",
	exists: false,
	stored_path: `/Users/x/.local-operator/attachments/${SHOT}.bin`,
	stored: true,
};

function attachmentsState(view, over = {}) {
	return {
		...view,
		state: "ready",
		capable: true,
		retry: () => {},
		...over,
	};
}

async function mount(element) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(element));
	return {
		container,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

const viewer = (attachments) =>
	h(api.CanvasFileViewer, {
		conversationId: SESSION,
		sessionId: SESSION,
		index: READY_INDEX,
		onSwitchToDocumentView: () => {},
		attachments,
	});

/** Open the entry's actions menu and read its item labels. */
async function menuLabels(entry) {
	await act(async () => {
		entry.dispatchEvent(
			new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		);
	});
	return [...document.querySelectorAll('[role="menuitem"]')].map((node) =>
		node.textContent.trim(),
	);
}

test("R2-2: a moved picture's TILE says so - status, not a bare size and date", async () => {
	const view = api.mergeUserAttachments(
		{ state: "ready", items: [movedPicture] },
		[],
	);
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const entry = container.querySelector(`[data-file-id^="attachment:"]`);
	assert.ok(entry, "the attachment renders as a Files entry");
	const text = entry.textContent;
	// A tile's caption is too narrow for the sentence (design R2 D10): it says
	// the card's "Saved copy", and the whole sentence is the tooltip below.
	assert.match(
		text,
		SAVED_COPY,
		`the tile states the retained copy, got: ${text}`,
	);
	assert.doesNotMatch(text, BARE_SIZE, "no bare size that reads as present");
	const button = entry.querySelector("button[title]");
	assert.match(
		button.getAttribute("title"),
		RETAINED,
		"the tooltip carries the status too",
	);
	await unmount();
});

test("R2-1: an older backend offers no materialise-backed action from the canvas", async () => {
	/*
	 * Without `session_attachments` the section is built from loaded rows: a
	 * legacy `{attachment, mime_type}` picture becomes an artifact document,
	 * which is exactly the row that used to grow Open file / Open folder /
	 * Copy file path over a route that 404s.
	 */
	const records = [
		{
			kind: "user",
			id: "u1",
			ts: 5,
			text: "",
			images: [
				{ id: "u1:0", data: null, attachment: SHOT, mimeType: "image/png" },
			],
			documents: [
				{
					id: "u1:doc:0",
					attachment: PDF,
					filename: "a.pdf",
					mimeType: "application/pdf",
					path: null,
					storedPath: `/Users/x/.local-operator/attachments/${PDF}.bin`,
					bytes: 10,
				},
			],
		},
	];
	const view = api.mergeUserAttachments(null, records);
	const run = async (capable) => {
		requests.length = 0;
		const { container, unmount } = await mount(
			viewer(attachmentsState(view, { capable })),
		);
		const entries = [
			...container.querySelectorAll(`[data-file-id^="attachment:"]`),
		];
		assert.equal(entries.length, 2, "both attachments render");
		const labels = [];
		for (const entry of entries) {
			labels.push(...(await menuLabels(entry)));
			await act(async () => {
				document.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				);
			});
			// Clicking the row is the other door to `materialise` (a non-media
			// artifact opens through a copy-out).
			const button = entry.querySelector("button[title]");
			await act(async () => button.click());
		}
		await unmount();
		return { labels, ops: [...requests] };
	};
	const older = await run(false);
	for (const label of ["Open file", "Open folder", "Copy file path"])
		assert.ok(
			!older.labels.includes(label),
			`older backend offers no "${label}" (got ${JSON.stringify(older.labels)})`,
		);
	assert.ok(
		!older.ops.includes("sessions.userAttachments.materialise"),
		`nothing calls the materialise route (sent ${JSON.stringify(older.ops)})`,
	);
	// Negative control: the same rows on a capable backend DO get the entries,
	// so the assertion above measures the gate rather than an empty menu.
	const capable = await run(true);
	assert.ok(
		capable.labels.includes("Copy file path"),
		`capable backend keeps the path actions (got ${JSON.stringify(capable.labels)})`,
	);
});

test("R2-3: loading, older-backend and failed reads caption the section differently", async () => {
	const records = [
		{
			kind: "user",
			id: "u1",
			ts: 5,
			text: "",
			images: [],
			documents: [
				{
					id: "u1:doc:0",
					attachment: PDF,
					filename: "a.pdf",
					mimeType: "application/pdf",
					path: "/tmp/a.pdf",
					storedPath: null,
					bytes: 10,
				},
			],
		},
	];
	const partial = api.mergeUserAttachments(null, records);
	const caption = async (over) => {
		const { container, unmount } = await mount(
			viewer(attachmentsState(partial, over)),
		);
		const header = [...container.querySelectorAll("h3")].find((node) =>
			node.textContent.includes("Attachments"),
		);
		const out = {
			header: header?.textContent ?? "",
			banner: container.textContent.includes("Couldn't load attachments"),
		};
		await unmount();
		return out;
	};
	const older = await caption({ capable: false });
	const loading = await caption({ state: "loading" });
	const failed = await caption({ state: "error" });
	assert.match(older.header, PARTIAL, "older backend: partial");
	assert.doesNotMatch(loading.header, PARTIAL, "loading is not partial");
	assert.match(loading.header, LOADING, "loading says it is loading");
	assert.doesNotMatch(failed.header, PARTIAL, "error is not partial");
	assert.ok(failed.banner, "error keeps its banner");
	assert.notEqual(older.header, loading.header);
});

test("R2-4: without a materialiser the missing card labels the saved-copy path, never 'file path'", async () => {
	const document_ = {
		id: "u1:doc:0",
		attachment: PDF,
		filename: "a.pdf",
		mimeType: "application/pdf",
		path: "/Users/x/Downloads/a.pdf",
		storedPath: `/Users/x/.local-operator/attachments/${PDF}.bin`,
		bytes: 10,
	};
	const labelsOf = async (sessionId) => {
		const { container, unmount } = await mount(
			h(api.SentFileCard, {
				document: document_,
				existence: false,
				storedExistence: true,
				sessionId,
			}),
		);
		const labels = [...container.querySelectorAll("button[aria-label]")].map(
			(node) => node.getAttribute("aria-label"),
		);
		await unmount();
		return labels;
	};
	const incapable = await labelsOf(null);
	assert.ok(
		incapable.includes("Copy saved copy path"),
		`got ${JSON.stringify(incapable)}`,
	);
	assert.ok(
		!incapable.some((label) => FILE_PATH_CONTROL.test(label)),
		`no control presents the .bin as the file path (got ${JSON.stringify(incapable)})`,
	);
	const capable = await labelsOf(SESSION);
	assert.ok(capable.includes("Copy path"), `got ${JSON.stringify(capable)}`);
});

/*
 * Q1 (core PR #3042 QA round 3, cross-PR): the backend LISTS a sensitive
 * attachment (`~/.ssh/id_rsa`, `.env`) with `materialisable: false` and
 * refuses its materialise route. The renderer must offer NO materialise-backed
 * action for it - Open file, Open folder, Copy file path, Show in canvas - on
 * ANY surface, while still painting the row; and a daemon that never sends the
 * field must behave exactly as round 2 did.
 */
const PATH_ACTIONS = ["Open file", "Open folder", "Copy file path"];
const CANVAS_ACTIONS = ["Show in canvas", "Open in canvas"];
const KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const KEY_NAME = /id_rsa/;
const PATH_WORD = /path/i;

/** A credential the person attached, origin still in place, store copy kept. */
const sensitive = (over = {}) => ({
	message_id: "m-key",
	ts: 1793117300,
	index: 0,
	kind: "document",
	attachment: KEY,
	filename: "id_rsa",
	mime_type: "application/octet-stream",
	bytes: 2048,
	path: "/Users/x/.ssh/id_rsa",
	exists: true,
	stored_path: `/Users/x/.local-operator/attachments/${KEY}.bin`,
	stored: true,
	...over,
});
/** A pasted picture (no origin path): only the retained copy can name it. */
const sensitivePicture = (over = {}) => ({
	message_id: "m-shot",
	ts: 1793117301,
	index: 0,
	kind: "image",
	attachment: SHOT,
	filename: null,
	mime_type: "image/png",
	bytes: 2048,
	path: null,
	exists: null,
	stored_path: `/Users/x/.local-operator/attachments/${SHOT}.bin`,
	stored: true,
	...over,
});

const withoutField = ({ materialisable: _drop, ...rest }) => rest;

/** Every menu label the canvas offers across the section's entries, plus the ops a click sent. */
async function canvasOffer(items, { capable = true } = {}) {
	requests.length = 0;
	const view = api.mergeUserAttachments({ state: "ready", items }, []);
	const { container, unmount } = await mount(
		viewer(attachmentsState(view, { capable })),
	);
	const entries = [
		...container.querySelectorAll(`[data-file-id^="attachment:"]`),
	];
	const labels = [];
	const text = entries.map((entry) => entry.textContent);
	for (const entry of entries) {
		labels.push(...(await menuLabels(entry)));
		await act(async () => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		await act(async () => entry.querySelector("button[title]").click());
	}
	await unmount();
	return { count: entries.length, labels, text, ops: [...requests] };
}

test("Q1: a materialisable:false attachment offers no path action in the canvas, but still renders", async () => {
	const refused = await canvasOffer([
		sensitive({ materialisable: false }),
		sensitivePicture({ materialisable: false }),
	]);
	assert.equal(refused.count, 2, "both refused rows are still listed");
	assert.match(refused.text[0] + refused.text[1], KEY_NAME, "named");
	for (const label of [...PATH_ACTIONS, ...CANVAS_ACTIONS])
		assert.ok(
			!refused.labels.includes(label),
			`refused row offers no "${label}" (got ${JSON.stringify(refused.labels)})`,
		);
	assert.ok(
		!refused.ops.includes("sessions.userAttachments.materialise"),
		`no click reaches the refusing route (sent ${JSON.stringify(refused.ops)})`,
	);
	// Control: the SAME rows marked materialisable on a capable backend do get
	// the entries, so the assertion above measures the gate, not an empty menu.
	const allowed = await canvasOffer([
		sensitive({ materialisable: true }),
		sensitivePicture({ materialisable: true }),
	]);
	assert.ok(
		allowed.labels.includes("Copy file path"),
		`materialisable rows keep the path actions (got ${JSON.stringify(allowed.labels)})`,
	);
	assert.ok(
		allowed.labels.includes("Show in canvas"),
		`materialisable rows keep Show in canvas (got ${JSON.stringify(allowed.labels)})`,
	);
});

test("Q1: a row with no materialisable field (older daemon) behaves exactly as before", async () => {
	const items = [sensitive(), sensitivePicture()].map(withoutField);
	const legacy = await canvasOffer(items);
	const explicit = await canvasOffer([
		sensitive({ materialisable: true }),
		sensitivePicture({ materialisable: true }),
	]);
	assert.deepEqual(
		legacy.labels,
		explicit.labels,
		"absent = allowed on a capable backend",
	);
	assert.deepEqual(legacy.ops, explicit.ops);
	// Without the capability the field is irrelevant: absent and `true` give
	// round 2's incapable menu, and nothing reaches the materialise route.
	const older = await canvasOffer(items, { capable: false });
	const olderExplicit = await canvasOffer(
		[
			sensitive({ materialisable: true }),
			sensitivePicture({ materialisable: true }),
		],
		{ capable: false },
	);
	assert.deepEqual(older.labels, olderExplicit.labels);
	assert.ok(!older.ops.includes("sessions.userAttachments.materialise"));
});

/*
 * The transcript surfaces: the sent-file card and the user's picture, mounted
 * through the shipped `CanonicalTranscript` so the verdict travels the real
 * path (inventory -> `refusedAttachments` -> UserRow -> card/picture).
 */
async function transcriptOffer({ refused, capable = true }) {
	requests.length = 0;
	const conversationId = "abcdef123456";
	api.useCanonicalSessionsStore.setState({
		placementFacts: { [conversationId]: { locality: "local" } },
	});
	const records = [
		{
			kind: "user",
			id: "u-key",
			ts: 1793117300000,
			text: "",
			images: [
				{ id: "u-key:0", data: null, attachment: SHOT, mimeType: "image/png" },
			],
			documents: [
				{
					id: "u-key:doc:0",
					attachment: KEY,
					filename: "id_rsa",
					mimeType: "application/octet-stream",
					path: "/Users/x/.ssh/id_rsa",
					storedPath: `/Users/x/.local-operator/attachments/${KEY}.bin`,
					bytes: 2048,
				},
			],
		},
	];
	const client = new api.QueryClient({
		// Infinite gc: a finite one arms a timer that keeps node:test's process
		// alive for minutes after the last test.
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: Number.POSITIVE_INFINITY,
				gcTime: Number.POSITIVE_INFINITY,
			},
		},
	});
	client.setQueryData(api.desktopKeys.capabilities, {
		desktop_available: true,
		features: capable ? { session_attachments: 1 } : {},
	});
	const transcript = {
		...api.EMPTY_TRANSCRIPT,
		records,
		index: new Map(records.map((row, at) => [row.id, at])),
	};
	const props = {
		transcript,
		frontend: null,
		gate: null,
		waiting: false,
		starting: false,
		loadingOlder: false,
		onLoadOlder: async () => true,
		containerRef: { current: null },
		isSmallView: false,
		status: "live",
		failure: null,
		awaitingHydration: false,
		onReconnect: () => {},
		conversationId,
		attachmentScope: { sessionId: conversationId, childId: null },
	};
	if (refused !== undefined) props.refusedAttachments = refused;
	const { container, unmount } = await mount(
		h(api.QueryClientProvider, { client }, h(api.CanonicalTranscript, props)),
	);
	// Let the picture's byte fetch settle so its frame (and menu) paints.
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	const card = container.querySelector('[data-document-id="u-key:doc:0"]');
	const cardButtons = card
		? [...card.querySelectorAll("button[aria-label]")].map((node) =>
				node.getAttribute("aria-label"),
			)
		: [];
	const openMenu = async (trigger) => {
		if (!trigger) return [];
		await act(async () => {
			trigger.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		const labels = [...document.querySelectorAll('[role="menuitem"]')].map(
			(node) => node.textContent.trim(),
		);
		await act(async () => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		return labels;
	};
	const cardMenu = await openMenu(
		card?.querySelector('button[aria-label^="Actions for"]'),
	);
	const pictureTrigger = container.querySelector(
		".file-actions-menu button[aria-haspopup]",
	);
	const pictureMenu = await openMenu(pictureTrigger);
	const named = Boolean(card?.textContent.includes("id_rsa"));
	await unmount();
	client.clear();
	return {
		named,
		cardButtons,
		cardMenu,
		pictureMenu,
		picture: Boolean(pictureTrigger),
	};
}

test("Q1: the transcript's sent-file card and picture offer no path action for a refused digest", async () => {
	const refused = await transcriptOffer({ refused: new Set([KEY, SHOT]) });
	assert.ok(refused.named, "the refused card still names the file");
	for (const label of [...PATH_ACTIONS, ...CANVAS_ACTIONS]) {
		assert.ok(
			!refused.cardMenu.includes(label),
			`card menu: no "${label}" (got ${JSON.stringify(refused.cardMenu)})`,
		);
		assert.ok(
			!refused.pictureMenu.includes(label),
			`picture menu: no "${label}" (got ${JSON.stringify(refused.pictureMenu)})`,
		);
	}
	assert.ok(
		!refused.cardButtons.some((label) => PATH_WORD.test(label)),
		`no inline copy-path control on the card (got ${JSON.stringify(refused.cardButtons)})`,
	);
	assert.ok(
		!requests.includes("sessions.userAttachments.materialise"),
		"nothing called the refusing route",
	);
	// Control: no refusals on a capable backend - the picture gets its path and
	// canvas entries and the card its menu, so the assertions above measure the
	// verdict. The same mount WITHOUT the prop (an older daemon's inventory has
	// no field to build it from) must match exactly.
	const allowed = await transcriptOffer({ refused: new Set() });
	assert.ok(allowed.picture, "the picture painted its menu trigger");
	for (const label of ["Copy file path", "Show in canvas"])
		assert.ok(
			allowed.pictureMenu.includes(label),
			`picture menu keeps "${label}" (got ${JSON.stringify(allowed.pictureMenu)})`,
		);
	assert.ok(
		allowed.cardMenu.includes("Copy file path"),
		`card menu keeps Copy file path (got ${JSON.stringify(allowed.cardMenu)})`,
	);
	const legacy = await transcriptOffer({});
	assert.deepEqual(
		{
			card: legacy.cardMenu,
			picture: legacy.pictureMenu,
			buttons: legacy.cardButtons,
		},
		{
			card: allowed.cardMenu,
			picture: allowed.pictureMenu,
			buttons: allowed.cardButtons,
		},
		"no refusal set behaves exactly as before",
	);
});

/*
 * PR #1452 round-4 remediation: UX R2 U12 / QA R4 Q1 (MAJOR) - pressing a
 * refused text attachment opened an EMPTY, EDITABLE editor, and a save wrote a
 * file named `artifact:<digest>` into the app's cwd. Now: the press opens the
 * stored bytes READ-ONLY, and no save path accepts an `artifact:` document.
 */
const ENV_DIGEST = "7b8f815cdd60938d77c8017839dce188";
const ENV_TEXT = "API_KEY=fixture-not-a-secret\nDEBUG=1\n";
const dotEnv = (over = {}) => ({
	message_id: "m-env",
	ts: 1793117302,
	index: 0,
	kind: "document",
	attachment: ENV_DIGEST,
	filename: ".env",
	mime_type: "text/plain",
	bytes: ENV_TEXT.length,
	path: "/Users/x/proj/.env",
	exists: true,
	stored_path: `/Users/x/.local-operator/attachments/${ENV_DIGEST}.bin`,
	stored: true,
	materialisable: false,
	...over,
});

/** Press the row, then mount what the canvas would show for the opened tab. */
async function pressAndShow(item, { capable = true } = {}) {
	requests.length = 0;
	saves.length = 0;
	mediaBytes.set(ENV_DIGEST, {
		data: new TextEncoder().encode(ENV_TEXT),
		mimeType: "text/plain",
	});
	api.useCanvasStore.setState({ conversations: {} });
	const view = api.mergeUserAttachments({ state: "ready", items: [item] }, []);
	const listing = await mount(viewer(attachmentsState(view, { capable })));
	const entry = listing.container.querySelector(
		`[data-file-id^="attachment:"]`,
	);
	const title = entry.querySelector("button[title]").getAttribute("title");
	await act(async () => entry.querySelector("button[title]").click());
	await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
	await listing.unmount();
	const opened =
		api.useCanvasStore.getState().conversations[SESSION]?.files ?? [];
	if (!opened.length) return { title, opened, ops: [...requests] };
	// The editable editor needs a query client; give it one, so a regression
	// fails on the assertions below rather than on a missing provider.
	const client = new api.QueryClient({
		defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY } },
	});
	const shown = await mount(
		h(
			api.QueryClientProvider,
			{ client },
			h(api.CanvasContent, { document: opened[0], conversationId: SESSION }),
		),
	);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	const editors = [...shown.container.querySelectorAll("[contenteditable]")];
	const out = {
		title,
		opened,
		ops: [...requests],
		text: shown.container.textContent,
		editable: editors.map((node) => node.getAttribute("contenteditable")),
		readonly: Boolean(
			shown.container.querySelector('[data-artifact-readonly="true"]'),
		),
	};
	// The save chord the editor listens for, plus the autosave debounce window.
	await act(async () => {
		window.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "s", metaKey: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 1100));
	});
	out.saves = [...saves];
	await shown.unmount();
	return out;
}

test("U12/Q1: pressing a refused .env opens its stored bytes READ-ONLY, and nothing saves", async () => {
	const pressed = await pressAndShow(dotEnv());
	assert.equal(pressed.opened.length, 1, "the press opens one tab");
	assert.match(pressed.opened[0].path, ARTIFACT_PATH, "opened by digest");
	assert.equal(
		pressed.opened[0].content,
		"",
		"no bytes enter the persisted store",
	);
	assert.ok(pressed.readonly, "the read-only artifact viewer is what shows");
	assert.ok(
		!pressed.editable.includes("true"),
		`no editable surface (got ${JSON.stringify(pressed.editable)})`,
	);
	assert.match(pressed.text, ENV_BODY, "the stored bytes, not an empty buffer");
	assert.ok(
		pressed.ops.includes("sessions.attachment"),
		`bytes read by digest (sent ${JSON.stringify(pressed.ops)})`,
	);
	assert.ok(!pressed.ops.includes("sessions.userAttachments.materialise"));
	assert.deepEqual(pressed.saves, [], "Cmd+S and the autosave write nothing");
	// The OLDER-DAEMON arm (no capability, no verdict): a MOVED text file opens
	// by digest too, and reaches the same read-only viewer. (A present one opens
	// its origin by path, as before - that is the editable file itself.)
	const older = await pressAndShow(
		dotEnv({ materialisable: undefined, exists: false }),
		{ capable: false },
	);
	assert.ok(older.readonly, "older daemon: read-only too");
	assert.ok(!older.editable.includes("true"));
	assert.deepEqual(older.saves, []);
});

test("U12/Q1: the editor's save path refuses any artifact: document; a file still saves", async () => {
	saves.length = 0;
	api.resetBuffers();
	api.setBufferPorts({
		probe: async () => ({ exists: true, isFile: true, mtimeMs: 1 }),
		write: async (path, text) => saves.push({ path, text }),
	});
	api.adoptBuffer({
		documentId: "artifact:doc",
		path: `artifact:${ENV_DIGEST}`,
		text: "",
		mtimeMs: 1,
	});
	api.proposeBuffer("artifact:doc", "typed-by-ux");
	const explicit = await api.saveBuffer("artifact:doc", { explicit: true });
	const automatic = await api.saveBuffer("artifact:doc");
	assert.equal(explicit.status, "unavailable");
	assert.equal(automatic.status, "unavailable");
	assert.deepEqual(saves, [], "no write reached the bridge");
	// Control: the same owner writes a real path, so the refusal is the guard.
	api.adoptBuffer({
		documentId: "file",
		path: "/tmp/a.txt",
		text: "",
		mtimeMs: 1,
	});
	api.proposeBuffer("file", "words");
	const written = await api.saveBuffer("file", { explicit: true });
	assert.equal(written.status, "written");
	assert.deepEqual(
		saves.map((save) => save.path),
		["/tmp/a.txt"],
	);
	api.resetBuffers();
	api.setBufferPorts(null);
});

test("U12 control: an ordinary text file still opens in the EDITABLE editor", async () => {
	const document_ = api.canvasDocumentForPath("/tmp/notes.txt", {
		content: "hello",
	});
	const client = new api.QueryClient({
		defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY } },
	});
	const shown = await mount(
		h(
			api.QueryClientProvider,
			{ client },
			h(api.CanvasContent, { document: document_, conversationId: SESSION }),
		),
	);
	const editable = [
		...shown.container.querySelectorAll("[contenteditable]"),
	].map((node) => node.getAttribute("contenteditable"));
	await shown.unmount();
	assert.ok(editable.includes("true"), `got ${JSON.stringify(editable)}`);
});

test("U13: a refused row's tooltip says why it has no actions; an allowed one does not", async () => {
	const refused = await pressAndShow(dotEnv());
	assert.match(refused.title, REFUSED_HINT);
	const allowed = await canvasOffer([sensitive({ materialisable: true })]);
	const { container, unmount } = await mount(
		viewer(
			attachmentsState(
				api.mergeUserAttachments(
					{ state: "ready", items: [sensitive({ materialisable: true })] },
					[],
				),
			),
		),
	);
	const title = container
		.querySelector(`[data-file-id^="attachment:"] button[title]`)
		.getAttribute("title");
	await unmount();
	assert.ok(allowed.count === 1);
	assert.doesNotMatch(title, REFUSED_HINT);
});

test("R4-U1: a refused row with no stored bytes offers nothing and its press does nothing", async () => {
	const bare = dotEnv({
		attachment: null,
		stored: false,
		stored_path: null,
	});
	const offer = await canvasOffer([bare]);
	assert.equal(offer.count, 1, "still listed");
	assert.deepEqual(
		offer.labels,
		[],
		`no menu (got ${JSON.stringify(offer.labels)})`,
	);
	assert.deepEqual(offer.ops, [], "the press sent nothing");
	// Control: the same row, not refused, keeps its origin-path actions.
	const allowed = await canvasOffer([{ ...bare, materialisable: true }]);
	assert.ok(
		allowed.labels.includes("Open file"),
		`got ${JSON.stringify(allowed.labels)}`,
	);
});

test("U11: Retry shows the loading line while in flight, and the error again if it fails", async () => {
	const view = api.mergeUserAttachments(
		{ state: "ready", items: [dotEnv()] },
		[],
	);
	let state = "error";
	let retried = 0;
	const render = () =>
		viewer(
			attachmentsState(view, {
				state,
				retry: () => {
					retried += 1;
				},
			}),
		);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(render()));
	const retry = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === "Retry",
	);
	assert.ok(retry, "the error banner offers Retry");
	await act(async () => retry.click());
	assert.equal(retried, 1);
	// The hook moves a retried listing to `loading`; the banner slot says so.
	state = "loading";
	await act(async () => root.render(render()));
	const banner = [...container.querySelectorAll("output")].map(
		(node) => node.textContent,
	);
	assert.ok(
		banner.some((text) => LOADING.test(text)),
		`in flight: ${JSON.stringify(banner)}`,
	);
	assert.ok(!container.textContent.includes("Couldn't load attachments"));
	// It fails again: the error is back.
	state = "error";
	await act(async () => root.render(render()));
	assert.ok(container.textContent.includes("Couldn't load attachments"));
	await act(async () => root.unmount());
	container.remove();
});
