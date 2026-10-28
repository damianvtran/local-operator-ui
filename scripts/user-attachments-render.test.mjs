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
window.api = {
	desktop: {
		request: async (request) => {
			requests.push(request.op);
			return { status: 404, body: {} };
		},
	},
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");

const bundled = await build({
	stdin: {
		contents: `
 export { CanvasFileViewer } from "./src/renderer/src/features/chat/components/canvas/canvas-file-viewer";
 export { SentFileCard } from "./src/renderer/src/features/chat/canonical/sent-file-card";
 export { mergeUserAttachments } from "./src/renderer/src/features/chat/canonical/user-attachments";
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
	assert.match(
		text,
		RETAINED,
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
