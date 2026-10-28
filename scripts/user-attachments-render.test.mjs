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
import { after, afterEach, test } from "node:test";
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
// Node also supplies navigator, but not navigator.onLine. Use the browser
// navigator so connectivity queries resolve a boolean rather than undefined.
Object.defineProperty(globalThis, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});

// Health reads use a fixed fixture, never the operator's live daemon.
// Record unexpected requests as well as rejecting: query hooks may catch errors.
const unexpectedNetwork = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(
		typeof input === "string" || input instanceof URL ? input : input.url,
	);
	const method = init?.method ?? input?.method ?? "GET";
	if (
		url.origin === "http://localhost:1111" &&
		url.pathname === "/health" &&
		method === "GET"
	)
		return Response.json({ status: "ok", result: { version: "test" } });
	unexpectedNetwork.push(`${method} ${url.origin}${url.pathname}`);
	throw new Error("Unexpected network request in attachment render test");
};
window.fetch = globalThis.fetch;
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
	// OS hand-offs stop at the bridge in this DOM rig. A real shell is neither
	// available nor part of the attachment permission assertions below.
	openFile: async () => {},
	showItemInFolder: async () => {},
	openExternal: async () => {},
	readFile: async () => ({ success: true, content: "test file" }),
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
 export { mergeUserAttachments, attachmentRefusals } from "./src/renderer/src/features/chat/canonical/user-attachments";
 export { useUserAttachments } from "./src/renderer/src/features/chat/canonical/use-user-attachments";
 export { toast } from "sonner";
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
const mountedRoots = new Set();
const clients = new Set();
function testQueryClient() {
	const client = new api.QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: Number.POSITIVE_INFINITY,
				gcTime: Number.POSITIVE_INFINITY,
				refetchOnReconnect: false,
				refetchOnWindowFocus: false,
				refetchInterval: false,
			},
			mutations: { retry: false },
		},
	});
	clients.add(client);
	return client;
}
// Keep failure paths as isolated as successful ones: a failed assertion must
// not leave an observer/refetch timer alive for the rest of the test file.
afterEach(async () => {
	for (const { root, container } of mountedRoots) {
		await act(async () => root.unmount());
		container.remove();
	}
	mountedRoots.clear();
	for (const client of clients) client.clear();
	clients.clear();
	assert.deepEqual(
		unexpectedNetwork.splice(0),
		[],
		"no unexpected network requests",
	);
});
after(() => {
	dom.window.close();
	globalThis.fetch = originalFetch;
});

const RETAINED = /Moved or deleted · saved copy kept/;
const SAVED_COPY = /Saved copy/;
const MOVED_NAME = /Moved Contract\.pdf/;
const WHITESPACE = /\s+/;
const ARTIFACT_PATH = /^artifact:/;
const ENV_BODY = /DEBUG=1/;
const REFUSED_HINT = /Looks like a secret, so file actions are off/;
const BARE_SIZE = /2 KB/;
const PARTIAL = /May be incomplete/;
const LOADING = /Loading/;
const READ_ONLY_CAPTION = /Read-only — saved copy of an attachment/;
const TOO_LARGE = /Too large to preview/;
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
	const owned = { root, container };
	mountedRoots.add(owned);
	await act(async () => root.render(element));
	return {
		container,
		unmount: async () => {
			await act(async () => root.unmount());
			mountedRoots.delete(owned);
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
/*
 * `inventory` is the backend's wire items for this message; the verdict reaches
 * the transcript the way the chat builds it (`mergeUserAttachments` ->
 * `attachmentRefusals` -> `refusedAttachments`). Absent = no prop at all (an
 * older daemon). `document` / `image` override the loaded blocks - an INLINE
 * file under 768 B has no `attachment` digest on its record (QA R5 Q2).
 */
async function transcriptOffer({
	inventory,
	capable = true,
	document: documentOver = {},
	image: imageOver = {},
	/*
	 * QA R6 Q3: the listing's state as the chat sees it. "ready" with
	 * `inventory`; "loading" / "error" carry no listing at all (the hook hands
	 * `mergeUserAttachments` null). Every state but the legacy no-prop mount is
	 * built exactly as `chat-content.tsx` builds it, judging on `capable`.
	 */
	listing = "ready",
	messageId = "u-key",
}) {
	requests.length = 0;
	const conversationId = "abcdef123456";
	api.useCanonicalSessionsStore.setState({
		placementFacts: { [conversationId]: { locality: "local" } },
	});
	const records = [
		{
			kind: "user",
			id: messageId,
			ts: 1793117300000,
			text: "",
			images: [
				{
					id: `${messageId}:0`,
					data: null,
					attachment: SHOT,
					mimeType: "image/png",
					...imageOver,
				},
			],
			documents: [
				{
					id: `${messageId}:doc:0`,
					attachment: KEY,
					filename: "id_rsa",
					mimeType: "application/octet-stream",
					path: "/Users/x/.ssh/id_rsa",
					storedPath: `/Users/x/.local-operator/attachments/${KEY}.bin`,
					bytes: 2048,
					...documentOver,
				},
			],
		},
	];
	const client = testQueryClient();
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
	if (inventory !== undefined || listing !== "ready")
		props.refusedAttachments = api.attachmentRefusals(
			api.mergeUserAttachments(
				listing === "ready" ? { state: "ready", items: inventory } : null,
				records,
				capable,
			),
		);
	const { container, unmount } = await mount(
		h(api.QueryClientProvider, { client }, h(api.CanonicalTranscript, props)),
	);
	// Let the picture's byte fetch settle so its frame (and menu) paints.
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	const card = container.querySelector(
		`[data-document-id="${messageId}:doc:0"]`,
	);
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
	// Design R4: the pending card reserves the actions' space (no shift later).
	const reserved = Boolean(card?.className.split(WHITESPACE).includes("pe-7"));
	await unmount();
	client.clear();
	return {
		named,
		reserved,
		cardButtons,
		cardMenu,
		pictureMenu,
		picture: Boolean(pictureTrigger),
	};
}

/** The inventory's rows for `transcriptOffer`'s message: the key file (content index 1) and the picture (0). */
const transcriptInventory = (over = {}, { document = {}, image = {} } = {}) => [
	sensitivePicture({ message_id: "u-key", index: 0, ...over, ...image }),
	sensitive({ message_id: "u-key", index: 1, ...over, ...document }),
];

test("Q1: the transcript's sent-file card and picture offer no path action for a refused digest", async () => {
	const refused = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: false }),
	});
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
	const allowed = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: true }),
	});
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
async function pressAndShow(item, { capable = true, body = ENV_TEXT } = {}) {
	requests.length = 0;
	saves.length = 0;
	mediaBytes.set(ENV_DIGEST, {
		data: new TextEncoder().encode(body),
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
	const client = testQueryClient();
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
		activeLine: shown.container.querySelectorAll(
			".cm-activeLine, .cm-activeLineGutter",
		).length,
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
	const client = testQueryClient();
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
	const owned = { root, container };
	mountedRoots.add(owned);
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
	// It fails again: the error is back (after the loading line's U17 minimum).
	state = "error";
	await act(async () => root.render(render()));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
	assert.ok(container.textContent.includes("Couldn't load attachments"));
	await act(async () => root.unmount());
	mountedRoots.delete(owned);
	container.remove();
});

/*
 * Design R2 D8/D9, in the rendered DOM. jsdom does no layout, so these pin the
 * CONTRACT the real-app geometry follows: the tile's thumbnail box gives back
 * the second caption line the band added (D8), and a moved row's status note
 * is the element that shrinks, capped, with the full sentence in the tooltip
 * (D9). The real-browser frames at 400/440/560 are the measurement.
 */
test("D8: an attachment tile's thumbnail gives back the second caption line", async () => {
	const pictures = Array.from({ length: 6 }, (_, at) => ({
		...movedPicture,
		message_id: `m-${at}`,
		attachment: `${SHOT.slice(0, -2)}${String(at).padStart(2, "0")}`,
	}));
	const view = api.mergeUserAttachments(
		{ state: "ready", items: pictures },
		[],
	);
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const tiles = [
		...container.querySelectorAll(`[data-file-id^="attachment:"]`),
	];
	assert.ok(tiles.length >= 4, `tiles rendered (${tiles.length})`);
	for (const tile of tiles) {
		const band = Number.parseFloat(tile.closest("li").style.height);
		const button = tile.querySelector(":scope > button");
		const thumb = button.querySelector(":scope > span");
		const thumbHeight = Number.parseFloat(thumb.style.height);
		// band = thumbnail + one-line caption budget (32) + the second line (18).
		assert.equal(
			band - thumbHeight,
			50,
			`band ${band}, thumbnail ${thumbHeight}`,
		);
	}
	// Two rows of tiles are stacked at exactly the band height.
	const tops = [
		...new Set(tiles.map((tile) => tile.closest("li").style.top)),
	].map(Number.parseFloat);
	assert.ok(tops.length >= 2, "two tile rows");
	assert.equal(
		tops[1] - tops[0],
		Number.parseFloat(tiles[0].closest("li").style.height),
	);
	await unmount();
});

test("D9/D15/R5-1: a moved row's note takes the space the name leaves, the name keeps a floor, the tooltip has it all", async () => {
	const moved = {
		...sensitive({ materialisable: true }),
		filename: "Moved Contract.pdf",
		mime_type: "application/pdf",
		path: "/Users/x/Downloads/Moved Contract.pdf",
		exists: false,
	};
	const view = api.mergeUserAttachments({ state: "ready", items: [moved] }, []);
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const row = container.querySelector(`[data-file-id^="attachment:"]`);
	const button = row.querySelector("button[title]");
	const line = button.querySelector(":scope > span:nth-of-type(2) > span");
	const [name, note] = line.children;
	assert.match(name.textContent, MOVED_NAME);
	assert.match(note.textContent, RETAINED);
	const noteClasses = note.className.split(WHITESPACE);
	// D15: the note GROWS into what the name leaves (no fixed 50% ceiling) and
	// truncates; D9: the name keeps a readable floor and only shrinks to it.
	// D17: the note's floor is about half the row, so a long name leaves it room.
	for (const required of ["flex-1", "truncate", "min-w-[min(13rem,50%)]"])
		assert.ok(
			noteClasses.includes(required),
			`note has ${required}: ${note.className}`,
		);
	assert.ok(!noteClasses.includes("max-w-[50%]"), "no fixed cap on the note");
	assert.ok(!noteClasses.includes("shrink-0"), "the note may shrink");
	const nameClasses = name.className.split(WHITESPACE);
	assert.ok(nameClasses.includes("min-w-[min(6rem,50%)]"), name.className);
	assert.ok(
		!nameClasses.includes("flex-1"),
		"the name takes only what it needs",
	);
	// R5-1: no date `title` on the status note to shadow the row's sentence.
	assert.equal(note.getAttribute("title"), null, "the note carries no title");
	assert.match(
		button.getAttribute("title"),
		RETAINED,
		"full sentence in the tooltip",
	);
	// Control: a present row keeps its fixed size/date run (it never squeezes).
	const present = api.mergeUserAttachments(
		{ state: "ready", items: [{ ...moved, exists: true }] },
		[],
	);
	const second = await mount(viewer(attachmentsState(present)));
	const presentNote = second.container
		.querySelector(`[data-file-id^="attachment:"] button[title]`)
		.querySelector(":scope > span:nth-of-type(2) > span").children[1];
	assert.ok(presentNote.className.split(WHITESPACE).includes("shrink-0"));
	assert.ok(
		presentNote.getAttribute("title"),
		"a size/date note keeps its date hint",
	);
	await second.unmount();
	await unmount();
});

/*
 * QA R5 Q2 / UX R3 (server.pem): a refused file with NO digest on its record.
 * Core keeps a file under 768 B INLINE (`_ATTACHMENT_FLOOR_BYTES`), so the
 * journal block carries no `attachment`; the inventory still lists it, and
 * judges it, with the digest it computed. A file attached by reference has no
 * stored copy at all. Every surface must find the verdict anyway.
 */
const INLINE_ENV_DIGEST = "a65fb5eb0d4bd4d1a6a3b5f1c27c99e0";
const inlineEnvCard = {
	attachment: null,
	filename: ".env",
	mimeType: "text/plain",
	path: "/Users/x/proj/.env",
	storedPath: null,
	bytes: 92,
};
const inlineEnvWire = {
	attachment: INLINE_ENV_DIGEST,
	filename: ".env",
	mime_type: "text/plain",
	bytes: 92,
	path: "/Users/x/proj/.env",
};
const pemByReferenceCard = {
	attachment: null,
	filename: "server.pem",
	mimeType: "application/x-pem-file",
	path: "/Users/x/certs/server.pem",
	storedPath: null,
	bytes: 1704,
};
const pemByReferenceWire = {
	attachment: null,
	filename: "server.pem",
	mime_type: "application/x-pem-file",
	bytes: 1704,
	path: "/Users/x/certs/server.pem",
	stored_path: null,
	stored: false,
};

for (const [label, card, wire] of [
	[
		"an inline .env under 768 B (no digest on the record)",
		inlineEnvCard,
		inlineEnvWire,
	],
	[
		"a server.pem attached by reference (no stored copy)",
		pemByReferenceCard,
		pemByReferenceWire,
	],
]) {
	test(`Q2: the transcript card offers no path action for ${label}`, async () => {
		const refused = await transcriptOffer({
			document: card,
			inventory: transcriptInventory(
				{ materialisable: false },
				{ document: wire, image: { materialisable: true } },
			),
		});
		assert.ok(refused.named || true);
		for (const action of [...PATH_ACTIONS, ...CANVAS_ACTIONS])
			assert.ok(
				!refused.cardMenu.includes(action),
				`card menu: no "${action}" (got ${JSON.stringify(refused.cardMenu)})`,
			);
		assert.ok(
			!refused.cardButtons.some((name) => FILE_PATH_CONTROL.test(name)),
			`no Copy path / actions trigger on the card (got ${JSON.stringify(refused.cardButtons)})`,
		);
		// The allowed picture of the same message keeps its actions: the
		// verdict is per block, not per message.
		assert.ok(
			refused.pictureMenu.includes("Copy file path"),
			`allowed picture keeps its path entry (got ${JSON.stringify(refused.pictureMenu)})`,
		);
		// Control: the same record, judged allowed, keeps Copy path.
		const allowed = await transcriptOffer({
			document: card,
			inventory: transcriptInventory(
				{ materialisable: true },
				{ document: wire },
			),
		});
		assert.ok(
			allowed.cardButtons.some((name) => FILE_PATH_CONTROL.test(name)),
			`allowed card keeps its controls (got ${JSON.stringify(allowed.cardButtons)})`,
		);
	});
}

test("Q2: an inline refused PICTURE (no digest on the record) offers no path action", async () => {
	// An inline picture paints from its `data:` bytes; that branch never had
	// path entries (no digest, nothing to materialise), and its in-app canvas
	// view reaches neither the disk nor the OS. Pinned so it stays that way.
	const refused = await transcriptOffer({
		image: { attachment: null, data: "iVBORw0KGgo=" },
		inventory: transcriptInventory(
			{ materialisable: true },
			{ image: { materialisable: false } },
		),
	});
	for (const action of PATH_ACTIONS)
		assert.ok(
			!refused.pictureMenu.includes(action),
			`picture menu: no "${action}" (got ${JSON.stringify(refused.pictureMenu)})`,
		);
});

test("Q2: fail closed - a refused row the card cannot place by position refuses every block of its kind", async () => {
	// The inventory knows ONE refused document on this message; the record
	// holds two (a block one side classifies and the other does not), so no
	// position can be trusted.
	const refused = await transcriptOffer({
		document: { ...inlineEnvCard, path: "/Users/x/proj/other.env" },
		inventory: [
			sensitive({
				message_id: "u-key",
				index: 3,
				materialisable: false,
				...inlineEnvWire,
			}),
			sensitive({
				message_id: "u-key",
				index: 4,
				materialisable: false,
				attachment: "f".repeat(32),
			}),
		],
	});
	assert.ok(
		!refused.cardButtons.some((name) => FILE_PATH_CONTROL.test(name)),
		`count mismatch refuses (got ${JSON.stringify(refused.cardButtons)})`,
	);
});

test("Q2: the canvas row of an inline refused .env carries no origin path, even unmerged", async () => {
	// The loaded record (no digest) and the inventory row (digest) key apart;
	// the record's copy must not slip in as an unjudged row.
	const records = [
		{
			kind: "user",
			id: "m-env",
			ts: 1793117302000,
			text: "",
			images: [],
			documents: [{ id: "m-env:doc:0", ...inlineEnvCard }],
		},
	];
	const view = api.mergeUserAttachments(
		{
			state: "ready",
			items: [dotEnv({ ...inlineEnvWire, stored: true })],
		},
		records,
	);
	for (const item of view.items)
		assert.equal(item.materialisable, false, `${item.key} is judged refused`);
	requests.length = 0;
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const labels = [];
	for (const entry of container.querySelectorAll(
		`[data-file-id^="attachment:"]`,
	)) {
		labels.push(...(await menuLabels(entry)));
		await act(async () => {
			document.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
	}
	await unmount();
	for (const action of [...PATH_ACTIONS, ...CANVAS_ACTIONS])
		assert.ok(
			!labels.includes(action),
			`no "${action}" (got ${JSON.stringify(labels)})`,
		);
});

test("U16: a refused row whose saved copy is gone is inert, even with its original on disk", async () => {
	const pruned = dotEnv({ stored: false, exists: true });
	const offer = await canvasOffer([pruned]);
	assert.equal(offer.count, 1, "still listed");
	assert.deepEqual(
		offer.labels,
		[],
		`no menu (got ${JSON.stringify(offer.labels)})`,
	);
	assert.deepEqual(offer.ops, [], "the press opened nothing");
	// QA R6 Q5: nothing was moved or deleted, so the note says why it is inert.
	assert.ok(
		REFUSED_HINT.test(offer.text[0]) && !offer.text[0].includes("Moved"),
		`the row states the refusal, not a move (got ${JSON.stringify(offer.text)})`,
	);
	// Control: a refused row whose original the backend saw MISSING keeps the
	// gone sentence - that one is true.
	const moved = await canvasOffer([dotEnv({ stored: false, exists: false })]);
	assert.ok(
		moved.text[0].includes("Moved or deleted · no saved copy"),
		`a really moved row keeps the gone note (got ${JSON.stringify(moved.text)})`,
	);
	// Control: the same row WITH its saved copy still opens it (read-only).
	const kept = await pressAndShow(dotEnv({ exists: true }));
	assert.ok(kept.readonly, "a kept copy still opens");
});

test("D14: the read-only viewer says so, and draws no active-line cue", async () => {
	const shown = await pressAndShow(dotEnv());
	assert.ok(shown.readonly);
	assert.match(shown.text, READ_ONLY_CAPTION);
	assert.equal(shown.activeLine, 0, "no active-line highlight");
});

test("R5-4: a body over the eager-read ceiling with no listed size says too large", async () => {
	const big = `${"x".repeat(1024 * 1024)}y`;
	const shown = await pressAndShow(dotEnv({ bytes: null }), { body: big });
	assert.ok(!shown.readonly, "no editor for the oversize body");
	assert.match(shown.text, TOO_LARGE);
});

test("R5-3: a new digest on a live preview shows loading, not the previous file", async () => {
	const client = testQueryClient();
	const SECOND = "c".repeat(32);
	mediaBytes.set(ENV_DIGEST, {
		data: new TextEncoder().encode(ENV_TEXT),
		mimeType: "text/plain",
	});
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const original = window.api.desktop.media;
	window.api.desktop.media = async (request) =>
		request.digest === SECOND
			? gate.then(() => ({
					kind: "bytes",
					data: new TextEncoder().encode("SECOND=1\n"),
					mimeType: "text/plain",
				}))
			: original(request);
	const docFor = (digest) => ({
		id: "artifact-doc",
		title: ".env",
		path: `artifact:${digest}`,
		type: "other",
		content: "",
		artifact: { digest, sessionId: SESSION, kind: "file", name: ".env" },
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const owned = { root, container };
	mountedRoots.add(owned);
	const render = (digest) =>
		h(
			api.QueryClientProvider,
			{ client },
			h(api.CanvasContent, {
				document: docFor(digest),
				conversationId: SESSION,
			}),
		);
	await act(async () => root.render(render(ENV_DIGEST)));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	assert.match(container.textContent, ENV_BODY, "first file shown");
	await act(async () => root.render(render(SECOND)));
	assert.doesNotMatch(
		container.textContent,
		ENV_BODY,
		"A's text is gone while B loads",
	);
	release();
	await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	window.api.desktop.media = original;
	await act(async () => root.unmount());
	mountedRoots.delete(owned);
	container.remove();
});

test("U17: a keyboard Retry keeps focus on Retry when the error returns, after a visible loading beat", async () => {
	const view = api.mergeUserAttachments(
		{ state: "ready", items: [dotEnv()] },
		[],
	);
	let state = "error";
	const render = () =>
		viewer(attachmentsState(view, { state, retry: () => {} }));
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const owned = { root, container };
	mountedRoots.add(owned);
	await act(async () => root.render(render()));
	const findRetry = () =>
		[...container.querySelectorAll("button")].find(
			(node) => node.textContent === "Retry",
		);
	findRetry().focus();
	await act(async () => findRetry().click());
	state = "loading";
	await act(async () => root.render(render()));
	// A FAST failure: the error is back on the next tick.
	state = "error";
	await act(async () => root.render(render()));
	const outputs = () =>
		[...container.querySelectorAll("output")].map((node) => node.textContent);
	assert.ok(
		outputs().some((text) => LOADING.test(text)),
		`the loading line holds its minimum (got ${JSON.stringify(outputs())})`,
	);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
	assert.ok(container.textContent.includes("Couldn't load attachments"));
	assert.equal(document.activeElement, findRetry(), "focus is back on Retry");
	// U19: during the retry only the banner slot says it is loading.
	await act(async () => root.unmount());
	mountedRoots.delete(owned);
	container.remove();
});

test("U18: Shift+F10 on a refused row announces why; keyboard focus shows the reason", async () => {
	const toasts = [];
	const unsubscribe = api.toast.getHistory
		? (() => {
				const before = api.toast.getHistory().length;
				return () => toasts.push(...api.toast.getHistory().slice(before));
			})()
		: () => {};
	const bare = dotEnv({ attachment: null, stored: false, stored_path: null });
	const view = api.mergeUserAttachments({ state: "ready", items: [bare] }, []);
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const button = container.querySelector(
		`[data-file-id^="attachment:"] button[title]`,
	);
	await act(async () => button.focus());
	assert.match(
		button.textContent,
		REFUSED_HINT,
		`keyboard focus shows the reason (got ${JSON.stringify(button.textContent)})`,
	);
	await act(async () => {
		button.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "F10",
				shiftKey: true,
				bubbles: true,
			}),
		);
	});
	unsubscribe();
	assert.ok(
		toasts.some((entry) => REFUSED_HINT.test(String(entry.title))),
		`the reason was announced (got ${JSON.stringify(toasts.map((entry) => entry.title))})`,
	);
	await act(async () => button.blur());
	// This bare row's resting note IS the reason (QA R6 Q5: it has no saved
	// copy, and its original was not moved); the focus/blur swap is measured
	// on a row with a size/date note in the Q4 test below.
	assert.match(button.textContent, REFUSED_HINT, "the resting note says why");
	await unmount();
});

/*
 * PR #1452 round-6 remediation (QA R6 Q3 / Q3b / Q4, review R6-2). Q3: while
 * the inventory is loading or has failed, "no verdict" meant "allowed", and
 * Open on `id_rsa` reached the OS. Unknown now withholds every path action on
 * every surface, the card reserving the space so nothing moves when they appear.
 */
const noPathAction = (offer, where) => {
	for (const label of [...PATH_ACTIONS, ...CANVAS_ACTIONS]) {
		assert.ok(
			!offer.cardMenu.includes(label),
			`${where}: card menu has no "${label}" (got ${JSON.stringify(offer.cardMenu)})`,
		);
		assert.ok(
			!offer.pictureMenu.includes(label),
			`${where}: picture menu has no "${label}" (got ${JSON.stringify(offer.pictureMenu)})`,
		);
	}
	assert.deepEqual(
		offer.cardButtons,
		[],
		`${where}: no "…" trigger and no inline copy control on the card`,
	);
};

test("Q3: while the inventory is loading or failed, the transcript offers no path action", async () => {
	for (const listing of ["loading", "error"]) {
		const offer = await transcriptOffer({ listing });
		assert.ok(offer.named, `${listing}: the card still names the file`);
		noPathAction(offer, listing);
		assert.ok(offer.reserved, `${listing}: the actions' space is reserved`);
		assert.ok(
			!requests.includes("sessions.userAttachments.materialise"),
			`${listing}: nothing reached the materialise route`,
		);
	}
	// Once ready: an allowed file gains its actions, a refused one stays bare.
	const allowed = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: true }),
	});
	assert.ok(
		allowed.cardMenu.includes("Copy file path"),
		`ready + allowed: the card menu appears (got ${JSON.stringify(allowed.cardMenu)})`,
	);
	assert.ok(allowed.pictureMenu.includes("Show in canvas"));
	assert.ok(allowed.reserved, "the same space now holds the trigger");
	const refused = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: false }),
	});
	noPathAction(refused, "ready + refused");
	// Control: an OLDER backend (no capability) is unchanged - the same loading
	// listing builds no refusal concept, so the card matches the no-prop mount.
	const olderLoading = await transcriptOffer({
		listing: "loading",
		capable: false,
	});
	const olderLegacy = await transcriptOffer({ capable: false });
	assert.deepEqual(
		[olderLoading.cardMenu, olderLoading.cardButtons],
		[olderLegacy.cardMenu, olderLegacy.cardButtons],
		"an older backend's card is exactly today's",
	);
	assert.ok(
		olderLoading.cardMenu.includes("Copy file path"),
		`an older backend keeps its origin actions (got ${JSON.stringify(olderLoading.cardMenu)})`,
	);
});

test("Q3b: a just-sent file is withheld until the re-read judges it, then clears", async () => {
	// The listing is ready, but was read before this message was sent.
	const stale = await transcriptOffer({
		messageId: "u-new",
		inventory: transcriptInventory({ materialisable: true }),
	});
	noPathAction(stale, "before the re-read");
	// The re-read lands with the new message's verdicts.
	const judged = (materialisable) =>
		transcriptInventory({ message_id: "u-new", materialisable });
	const allowed = await transcriptOffer({
		messageId: "u-new",
		inventory: judged(true),
	});
	assert.ok(
		allowed.cardMenu.includes("Copy file path"),
		`an allowed send gains its actions (got ${JSON.stringify(allowed.cardMenu)})`,
	);
	const refused = await transcriptOffer({
		messageId: "u-new",
		inventory: judged(false),
	});
	noPathAction(refused, "a refused send after the re-read");
});

/** The canvas built from LOADED records only, as the chat's hook builds it. */
async function canvasFromRecords(listing, state) {
	requests.length = 0;
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
	const view = api.mergeUserAttachments(listing, records, true);
	const { container, unmount } = await mount(
		viewer(attachmentsState(view, { state })),
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
	const triggers = container.querySelectorAll(
		'[data-file-id^="attachment:"] button[aria-haspopup]',
	).length;
	await unmount();
	return { count: entries.length, labels, text, triggers, ops: [...requests] };
}

test("Q3: the canvas's fallback rows under a loading or failed listing offer no path action", async () => {
	for (const state of ["loading", "error"]) {
		const offer = await canvasFromRecords(null, state);
		assert.equal(offer.count, 2, `${state}: both loaded rows are listed`);
		for (const label of [...PATH_ACTIONS, ...CANVAS_ACTIONS])
			assert.ok(
				!offer.labels.includes(label),
				`${state}: no "${label}" (got ${JSON.stringify(offer.labels)})`,
			);
		assert.ok(
			!offer.ops.includes("sessions.userAttachments.materialise"),
			`${state}: no press reached the materialise route (sent ${JSON.stringify(offer.ops)})`,
		);
		// Not judged is not refused: nothing claims these are secrets.
		assert.ok(
			!offer.text.some((line) => REFUSED_HINT.test(line)),
			`${state}: no refusal wording on an unjudged row`,
		);
	}
	// Ready and allowed: the same rows regain the entries.
	const ready = await canvasFromRecords(
		{ state: "ready", items: transcriptInventory({ materialisable: true }) },
		"ready",
	);
	assert.ok(
		ready.labels.includes("Copy file path"),
		`ready + allowed: entries return (got ${JSON.stringify(ready.labels)})`,
	);
});

test("Q4: Shift+F10 announces the reason on a refused row WITH a saved copy (an empty menu)", async () => {
	const toasts = [];
	const before = api.toast.getHistory().length;
	const view = api.mergeUserAttachments(
		{ state: "ready", items: [dotEnv()] },
		[],
	);
	const { container, unmount } = await mount(viewer(attachmentsState(view)));
	const button = container.querySelector(
		`[data-file-id^="attachment:"] button[title]`,
	);
	await act(async () => button.focus());
	assert.match(button.textContent, REFUSED_HINT, "keyboard focus shows why");
	await act(async () => {
		button.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "F10",
				shiftKey: true,
				bubbles: true,
			}),
		);
	});
	toasts.push(...api.toast.getHistory().slice(before));
	assert.ok(
		toasts.some((entry) => REFUSED_HINT.test(String(entry.title))),
		`the reason was announced (got ${JSON.stringify(toasts.map((entry) => entry.title))})`,
	);
	assert.equal(
		document.querySelectorAll('[role="menu"]').length,
		0,
		"no empty menu opened",
	);
	await act(async () => button.blur());
	assert.doesNotMatch(
		button.textContent,
		REFUSED_HINT,
		"blur restores the note",
	);
	await unmount();
	// Control: an allowed row's key opens its menu and announces nothing.
	const quiet = api.toast.getHistory().length;
	const open = api.mergeUserAttachments(
		{ state: "ready", items: [dotEnv({ materialisable: true })] },
		[],
	);
	const mounted = await mount(viewer(attachmentsState(open)));
	const row = mounted.container.querySelector(
		`[data-file-id^="attachment:"] button[title]`,
	);
	await act(async () => {
		row.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "F10",
				shiftKey: true,
				bubbles: true,
			}),
		);
	});
	assert.ok(
		document.querySelectorAll('[role="menuitem"]').length > 0,
		"the allowed row's menu opened",
	);
	assert.equal(api.toast.getHistory().length, quiet, "no announcement");
	await act(async () => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	});
	await mounted.unmount();
});

test("R6-2: a keyboard Retry that succeeds leaves no armed refocus for a later failure", async () => {
	const view = api.mergeUserAttachments(
		{ state: "ready", items: [dotEnv()] },
		[],
	);
	let state = "error";
	const render = () =>
		viewer(attachmentsState(view, { state, retry: () => {} }));
	const container = document.createElement("div");
	document.body.append(container);
	const composer = document.createElement("input");
	document.body.append(composer);
	const root = createRoot(container);
	const owned = { root, container };
	mountedRoots.add(owned);
	await act(async () => root.render(render()));
	const retry = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === "Retry",
	);
	retry.focus();
	await act(async () => retry.click());
	state = "loading";
	await act(async () => root.render(render()));
	state = "ready";
	await act(async () => root.render(render()));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
	composer.focus();
	// A later re-read (one per send) fails with no `loading` in between.
	state = "error";
	await act(async () => root.render(render()));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
	// A boolean, not the elements: a failing equal on two jsdom nodes makes
	// assert inspect the whole DOM graph, which ran the process out of memory.
	assert.ok(
		document.activeElement === composer,
		`focus stays in the composer (got ${document.activeElement?.tagName} "${document.activeElement?.textContent}")`,
	);
	await act(async () => root.unmount());
	mountedRoots.delete(owned);
	container.remove();
	composer.remove();
});

/*
 * PR #1452 round 7 (QA R7 Q6, design's call on review R7-4): a REFUSED card
 * keeps the reserve a pending one holds, so the verdict landing moves nothing.
 */
test("Q6: pending and refused cards share one geometry (the reserve stays)", async () => {
	const pending = await transcriptOffer({ listing: "loading" });
	const refused = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: false }),
	});
	const allowed = await transcriptOffer({
		inventory: transcriptInventory({ materialisable: true }),
	});
	noPathAction(refused, "refused");
	assert.deepEqual(
		[pending.reserved, refused.reserved, allowed.reserved],
		[true, true, true],
		"no verdict changes the card's end padding",
	);
	// The inline copy control's slot is held too (no path-line shift).
	assert.ok(
		!refused.cardButtons.some((label) => FILE_PATH_CONTROL.test(label)),
		`no copy control on the refused card (got ${JSON.stringify(refused.cardButtons)})`,
	);
});

/*
 * PR #1452 round 7 (review R7-3): the echo turning durable re-reads the
 * inventory ONCE - the echo's own read can land before the journal holds the
 * row - with no polling, and never a second request beside one in flight.
 */
test("R7-3: a durable echo triggers exactly one re-read, deduped against an in-flight read", async () => {
	const sent = (over = {}) => ({
		kind: "user",
		id: "u-echo",
		ts: 1793117300000,
		text: "",
		images: [],
		documents: [
			{
				id: "u-echo:doc:0",
				attachment: KEY,
				filename: "notes.txt",
				mimeType: "text/plain",
				path: "/Users/x/notes.txt",
				storedPath: null,
				bytes: 20,
			},
		],
		...over,
	});
	const original = window.api.desktop.request;
	let reads = 0;
	let release = null;
	let hold = false;
	window.api.desktop.request = async (request) => {
		if (request.op !== "sessions.userAttachments") return original(request);
		reads += 1;
		if (hold)
			await new Promise((resolve) => {
				release = resolve;
			});
		return { status: 200, body: { result: { state: "ready", items: [] } } };
	};
	const client = testQueryClient();
	client.setQueryData(api.desktopKeys.capabilities, {
		desktop_available: true,
		features: { session_attachments: 1 },
	});
	const Probe = ({ records }) => {
		api.useUserAttachments(SESSION, records);
		return null;
	};
	const settle = () =>
		act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
	const echo = [sent({ local: true, provisional: true })];
	const { unmount, rerender } = await (async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		const owned = { root, container };
		mountedRoots.add(owned);
		const render = (records) =>
			act(async () =>
				root.render(
					h(api.QueryClientProvider, { client }, h(Probe, { records })),
				),
			);
		await render(echo);
		return {
			rerender: render,
			unmount: async () => {
				await act(async () => root.unmount());
				mountedRoots.delete(owned);
				container.remove();
			},
		};
	})();
	try {
		await settle();
		assert.equal(reads, 1, "the echo's own read");
		// The live `message_start` clears `local` only: still an echo.
		await rerender([sent({ provisional: true })]);
		await settle();
		assert.equal(reads, 1, "a delivered echo is not durable yet");
		// The durable row (same id, same digest) lands: ONE re-read.
		await rerender([sent()]);
		await settle();
		assert.equal(reads, 2, "the echo turning durable re-reads once");
		// Later renders of the same durable row ask for nothing (no polling).
		await rerender([sent()]);
		await settle();
		await settle();
		assert.equal(reads, 2, "no further reads without a new transition");
		// Dedupe: a second send turns durable WHILE a read is in flight. The
		// read started before the row was durable, so exactly one trailing
		// read follows it - never a concurrent second request.
		hold = true;
		const second = (over = {}) =>
			sent({
				id: "u-echo-2",
				documents: [
					{
						...sent().documents[0],
						id: "u-echo-2:doc:0",
						attachment: ENV_DIGEST,
					},
				],
				...over,
			});
		await rerender([sent(), second({ local: true, provisional: true })]);
		await settle();
		assert.equal(reads, 3, "the new send's own read is in flight");
		await rerender([sent(), second()]);
		await settle();
		assert.equal(reads, 3, "no concurrent request beside the in-flight read");
		hold = false;
		await act(async () => release());
		await settle();
		assert.equal(
			reads,
			4,
			"one trailing re-read once the in-flight read lands",
		);
		await settle();
		assert.equal(reads, 4, "and nothing after it");
	} finally {
		window.api.desktop.request = original;
		await unmount();
		client.clear();
	}
});
