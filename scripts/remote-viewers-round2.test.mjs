/**
 * Remote files parity, review round 2: the canvas viewers of a PEER-held file
 * and the transcript tile's Retry.
 *
 * WHAT THIS FILE HOLDS:
 * - R2-1: a remote workbook opens READ-ONLY. The grid used to take edits whose
 *   save `saveBuffer` refuses for a `remote-file:` identifier, silently.
 * - U2-1: the remote text viewer rides the transcript's 504 backoff, names
 *   the device while it waits, tells "still fetching" from "offline", and
 *   offers Retry.
 * - U2-2: pressing Retry on a transcript tile keeps keyboard focus through the
 *   wait and back.
 *
 * REAL: `SpreadsheetPreview` (with the real `xlsx` parse and buffer owner),
 * `ArtifactTextPreview`, `CanonicalImage` with its real attachment resolver,
 * the media relay client (`desktopMedia`), the sessions store and the English
 * catalogue, bundled from source and mounted with React in JSDOM.
 * SUBSTITUTED: `ag-grid-react` (a recorder of the props the grid is given, so
 * editability is read from the column definitions the viewer builds),
 * `@uiw/react-codemirror` (a `<pre>`), the preload bridge
 * (`window.api.desktop.media`, answered here) and the toasts (recorded).
 * Each viewer test has a LOCAL control proving the substitute is wired.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, mock, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import * as XLSX from "xlsx";

const STUBBED =
	/^(ag-grid-react|@uiw\/react-codemirror|@shared\/utils\/toast-manager)$/;
const ONE_REACT = /^(react|react-dom)(\/.*)?$/;
const ANY = /.*/;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class SilentResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = SilentResizeObserver;
dom.window.ResizeObserver = SilentResizeObserver;
let blobId = 0;
URL.createObjectURL = () => `blob:round2-${blobId++}`;
URL.revokeObjectURL = () => {};

/** The media relay, answered per test. */
const MEDIA = [];
let answer = async () => ({ status: 404, kind: "error", detail: "none" });
globalThis.window.api = {
	desktop: {
		media: async (request) => {
			MEDIA.push(request);
			return answer(request);
		},
	},
};
const TOASTS = [];
globalThis.__toasts = TOASTS;
globalThis.__grid = [];

const STUBS = {
	"ag-grid-react": `
		import { createElement } from "react";
		export const AgGridReact = (props) => {
			globalThis.__grid.push(props);
			return createElement("div", { "data-grid": "" });
		};`,
	"@uiw/react-codemirror": `
		import { createElement } from "react";
		export default (props) => createElement("pre", { "data-cm": "" }, props.value);`,
	"@shared/utils/toast-manager": `
		const note = (kind) => (message) => { globalThis.__toasts.push({ kind, message }); return 1; };
		export const showErrorToast = note("error");
		export const showInfoToast = note("info");
		export const showSuccessToast = note("success");
		export const showLoadingToast = note("loading");
		export const showWarningToast = note("warning");
		export const dismissToast = () => {};`,
};

const { act } = await import("react");
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { SpreadsheetPreview } from "./src/renderer/src/features/chat/components/canvas/spreadsheet-preview";
import { ArtifactTextPreview } from "./src/renderer/src/features/chat/components/canvas/artifact-text-preview";
import { CanonicalImage } from "./src/renderer/src/features/chat/canonical/canonical-image";
import { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
export function mount(container, type, props) {
	const root = createRoot(container);
	const component = { sheet: SpreadsheetPreview, text: ArtifactTextPreview, image: CanonicalImage }[type];
	root.render(createElement(component, props));
	return root;
}
export function seedRemoteSession(sessionId, device) {
	useCanonicalSessionsStore.setState({
		sessions: [{ session_id: sessionId, locality: "remote", owner_device_name: device }],
	});
}
`;
const bundle = await build({
	stdin: { contents: ENTRY, resolveDir: process.cwd(), sourcefile: "r2.mjs" },
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@renderer": `${process.cwd()}/src/renderer/src`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
	plugins: [
		{
			name: "round2-edges",
			setup(builder) {
				builder.onResolve({ filter: STUBBED }, (args) => ({
					path: args.path,
					namespace: "stub",
				}));
				// One React for the bundle and the test's own `act` (the
				// chat-image-expand pattern); every other package is bundled, since
				// several ship directory imports Node's ESM loader refuses.
				builder.onResolve({ filter: ONE_REACT }, (args) => ({
					path: args.path,
					external: true,
				}));
				builder.onLoad({ filter: ANY, namespace: "stub" }, ({ path }) => ({
					contents: STUBS[path],
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
	write: false,
});
const bundlePath = new URL(
	`./_remote-viewers-round2-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mount, seedRemoteSession } = await import(bundlePath.href);
after(() => unlink(bundlePath));

const flush = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (rounds = 8) => {
	for (let i = 0; i < rounds; i += 1)
		await act(async () => {
			await flush();
		});
};
const render = async (type, props) => {
	const container = document.createElement("div");
	document.body.append(container);
	let root;
	await act(async () => {
		root = mount(container, type, props);
	});
	await settle();
	return { container, root };
};

const DEVICE = "lop-remote-node-2";
const SESSION = "aaaaaaaaaaaa";
const FILE_ID = "00000000000000a1";
const remoteFacts = {
	fileId: FILE_ID,
	sessionId: SESSION,
	deviceName: DEVICE,
	readKind: "path",
	unreadable: null,
	ownerPath: "~/budget.xlsx",
	sizeBytes: 100,
};

const workbookBase64 = () => {
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		book,
		XLSX.utils.aoa_to_sheet([
			["item", "cost"],
			["rent", 42],
		]),
		"Sheet1",
	);
	return XLSX.write(book, { type: "base64", bookType: "xlsx" });
};

// ------------------------------------------------------------------ R2-1

test("R2-1 control: a LOCAL workbook stays editable and has no remote caption", async () => {
	globalThis.__grid.length = 0;
	const { container, root } = await render("sheet", {
		document: {
			id: "local-sheet",
			title: "budget.xlsx",
			path: "/home/me/budget.xlsx",
			content: workbookBase64(),
			type: "spreadsheet",
		},
		conversationId: "c-local",
	});
	const props = globalThis.__grid.at(-1);
	assert.ok(props.columnDefs.length > 0, "the grid got the parsed columns");
	assert.ok(props.columnDefs.every((col) => col.editable === true));
	assert.ok(!container.textContent.includes("read-only"));
	await act(async () => root.unmount());
});

test("R2-1: a REMOTE workbook is read-only, says so, and Ctrl+S saves nothing", async () => {
	globalThis.__grid.length = 0;
	TOASTS.length = 0;
	const { container, root } = await render("sheet", {
		document: {
			id: "remote-sheet",
			title: "budget.xlsx",
			path: `remote-file:${SESSION}/${FILE_ID}/budget.xlsx`,
			content: workbookBase64(),
			type: "spreadsheet",
			remote: remoteFacts,
		},
		conversationId: "c-remote",
	});
	const props = globalThis.__grid.at(-1);
	assert.ok(props.columnDefs.length > 0, "the workbook still shows");
	assert.ok(
		props.columnDefs.every((col) => col.editable === false),
		"no cell takes an edit whose save cannot reach the owner",
	);
	assert.ok(
		container.textContent.includes(`From ${DEVICE} · read-only`),
		"the remote viewers' caption (U1-3)",
	);
	const save = new dom.window.KeyboardEvent("keydown", {
		key: "s",
		ctrlKey: true,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => {
		window.dispatchEvent(save);
	});
	await settle();
	assert.equal(save.defaultPrevented, false, "Ctrl+S is not taken over");
	assert.deepEqual(TOASTS, [], "and nothing claims a save");
	await act(async () => root.unmount());
});

// ------------------------------------------------------------------ U2-1

const remoteText = (fileId) => ({
	id: `remote-text-${fileId}`,
	title: "notes.md",
	path: `remote-file:${SESSION}/${fileId}/notes.md`,
	content: "",
	type: "markdown",
	sizeBytes: 5,
	remote: { ...remoteFacts, fileId, ownerPath: "~/notes.md", sizeBytes: 5 },
});
const refused504 = (code) => ({
	status: 504,
	kind: "error",
	detail: "Owner slow.",
	refusal: { code },
});
const textBytes = (text) => ({
	status: 200,
	kind: "bytes",
	mimeType: "text/markdown",
	data: new TextEncoder().encode(text),
});

test("U2-1: a remote text file waits under the device's name, then says 'still fetching' with Retry, and Retry reads again", async () => {
	MEDIA.length = 0;
	let release;
	answer = () =>
		new Promise((resolve) => {
			release = () => resolve(refused504("attachment_fetch_pending"));
		});
	const { container, root } = await render("text", {
		document: remoteText("00000000000000b1"),
		retryDelays: [0],
	});
	assert.ok(
		container.textContent.includes(`Fetching from ${DEVICE}…`),
		`not "Opening…": ${container.textContent}`,
	);
	answer = async () => refused504("attachment_fetch_pending");
	await act(async () => release());
	// The zero-delay wait is a real `setTimeout` (>= 1 ms); `setImmediate`
	// rounds alone can all run before it fires.
	await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
	await settle();
	assert.equal(MEDIA.length, 2, "the 504 was asked again on the backoff");
	assert.ok(
		container.textContent.includes(
			`Still fetching from ${DEVICE}. Try again in a moment.`,
		),
		container.textContent,
	);
	assert.ok(!container.textContent.includes("isn't answering"), "not offline");
	const retry = container.querySelector("[data-remote-text-retry]");
	assert.ok(retry, "a Retry action");
	answer = async () => textBytes("# hi");
	await act(async () => {
		retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
	assert.equal(container.querySelector("[data-cm]")?.textContent, "# hi");
	assert.ok(container.textContent.includes(`From ${DEVICE} · read-only`));
	await act(async () => root.unmount());
});

test("U2-1: an owner the backend calls unreachable gets the offline sentence, with Retry", async () => {
	answer = async () => refused504("attachment_owner_unreachable");
	const { container, root } = await render("text", {
		document: remoteText("00000000000000b2"),
		retryDelays: [0],
	});
	// Past the zero-delay backoff's real `setTimeout` (see the test above).
	await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
	await settle();
	assert.equal(MEDIA.filter((r) => r.fileId === "00000000000000b2").length, 2);
	assert.ok(
		container.textContent.includes(
			`${DEVICE} isn't answering. Try again when it's online.`,
		),
		container.textContent,
	);
	assert.ok(container.querySelector("[data-remote-text-retry]"));
	await act(async () => root.unmount());
});

// ------------------------------------------------------------------ U2-2

test("U2-2: Retry on a transcript tile keeps keyboard focus through the wait and back", async (t) => {
	mock.timers.enable({ apis: ["setTimeout"] });
	t.after(() => mock.timers.reset());
	seedRemoteSession(SESSION, DEVICE);
	answer = async () => ({ status: 504, kind: "error", detail: "slow" });
	const { container, root } = await render("image", {
		image: {
			data: null,
			attachment: "c".repeat(64),
			mimeType: "image/png",
		},
		scope: { sessionId: SESSION, childId: null },
		label: "shot.png",
		size: "thumbnail",
	});
	// The resolver's own 2/4/8/16 s backoff, to its click-to-retry state.
	const exhaust = async () => {
		for (const delay of [2000, 4000, 8000, 16000]) {
			await settle(4);
			await act(async () => mock.timers.tick(delay));
		}
		await settle();
	};
	await exhaust();
	const retry = container.querySelector("[data-attachment-retryable]");
	assert.ok(retry, "the Retry tile");
	retry.focus();
	// Identity as a boolean: an assertion message that inspects two JSDOM
	// nodes walks the whole document and exhausts memory.
	assert.ok(document.activeElement === retry);
	await act(async () => {
		retry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
	});
	await settle(4);
	const pending = container.querySelector("[data-attachment-pending]");
	assert.ok(pending, "the labelled wait");
	assert.ok(
		document.activeElement === pending,
		"focus moved with the swap, not to the document",
	);
	await exhaust();
	const again = container.querySelector("[data-attachment-retryable]");
	assert.ok(again, "the Retry tile is back");
	assert.ok(document.activeElement === again, "and focus is on it");
	await act(async () => root.unmount());
});
