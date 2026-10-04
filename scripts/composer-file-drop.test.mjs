import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE COMPOSER'S DROP TARGET, driven through the SHIPPED component (issue #789).
 *
 * WHAT THIS PROVES, and why it is a jsdom mount rather than the built app. The
 * evidence rig (`scripts/renderer-driver.mjs --scene composer-drop`) drives a
 * REAL file drag through Chromium's input pipeline and photographs the result,
 * which is the only instrument that can show the gesture landing. Two things it
 * cannot reach are here instead:
 *
 * 1. the REFUSING arm. In chat `isInputDisabled` can only be true through
 *    `unavailable` or `secretAnswer` - the busy term is false on the canonical
 *    path by construction (`chat-content.tsx` passes `currentJobId=null`) and
 *    chat supplies no `hostNotice` - and a conversation this machine has
 *    deleted is not something a rig can create (the daemon exposes no session
 *    delete). Mounted here, `unavailable` is a prop.
 * 2. THE PREDICATE ITSELF, on both arms: what a drop does when the box accepts
 *    and when it refuses, read off the store the send reads rather than off the
 *    pixels. The rig asserts the same facts end to end; this file is where the
 *    arms are both reachable in one process.
 *
 * WHAT IT CANNOT PROVE, said here so no report implies otherwise: jsdom has no
 * drag-and-drop engine and no layout, so the events below are CONSTRUCTED rather
 * than delivered by a browser - `dataTransfer` is a plain object with the two
 * members the handler reads (`files`, `types`), and `dropEffect` is written to,
 * not honoured. Nothing here says what a real OS drag paints or where it lands;
 * that is the rig's and QA's pass on the built app.
 *
 * The world is built BEFORE the bundle is imported, because the stores
 * (`zustand/persist`) read `localStorage` at module scope.
 */

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;

/*
 * The composer's own queries schedule real timers and a jsdom window has no
 * lifecycle that retires them; left alone the process never exits. Same fixture
 * business as `credential-composer.test.mjs`, for the same measured reason.
 */
const tracked =
	(real) =>
	(...args) => {
		const id = real(...args);
		liveTimers.push(id);
		return id;
	};
globalThis.setTimeout = tracked(realSetTimeout);
globalThis.setInterval = tracked(realSetInterval);

for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLTextAreaElement: window.HTMLTextAreaElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	FocusEvent: window.FocusEvent,
	KeyboardEvent: window.KeyboardEvent,
	InputEvent: window.InputEvent,
	MouseEvent: window.MouseEvent,
	ClipboardEvent: window.ClipboardEvent,
	File: window.File,
	FileList: window.FileList,
	FileReader: window.FileReader,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	MutationObserver: window.MutationObserver,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}

/*
 * A hidden document, and it is not decoration: the composer's connectivity
 * probes pause only when the document is not visible, and a jsdom document
 * reports itself visible with no focus, so visible polls never stop.
 */
Object.defineProperty(window.document, "visibilityState", { value: "hidden" });
Object.defineProperty(window.document, "hidden", { value: true });

/* jsdom implements no `matchMedia` at all; one object per query, because it is
 * read through `useSyncExternalStore` and a fresh object per call re-renders
 * forever (measured in `credential-composer.test.mjs`). */
const mediaQueries = new Map();
window.matchMedia = (query) => {
	const key = String(query);
	if (!mediaQueries.has(key)) {
		mediaQueries.set(key, {
			matches: false,
			media: key,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		});
	}
	return mediaQueries.get(key);
};

window.setTimeout = tracked(realSetTimeout);
window.setInterval = tracked(realSetInterval);

window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async () => ({ canceled: true, filePaths: [] }),
	},
};

/*
 * THE BRIDGE THE DROP READS, and the one seam this file turns on and off.
 *
 * `getPathForFile` is what the preload exposes (Electron 44 removed `File.path`);
 * `pathFor` is the rig's answer, so the PATH arm and the FALLBACK arm - a `File`
 * the OS did not back, which the real call answers `""` for - are both reachable
 * from one mount. The whole object is replaced per case by `setPathBridge`.
 */
let pathFor = () => "";
const setPathBridge = (fn) => {
	pathFor = fn;
};
window.api = {
	desktop: {
		request: async () => ({ status: 200, body: { result: {} } }),
	},
	getPathForFile: (file) => pathFor(file),
};

/* ------------------------------------------------------------------ */
/* The bundle                                                          */
/* ------------------------------------------------------------------ */

const bundle = await build({
	stdin: {
		contents: `
			export { MessageInput } from "./src/renderer/src/shared/components/composer/message-input.tsx";
			export { useConversationInputStore } from "./src/renderer/src/shared/store/conversation-input-store";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
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
const bundlePath = new URL(
	`./_composer-drop-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	MessageInput,
	QueryClient,
	QueryClientProvider,
	useConversationInputStore,
} = await import(bundlePath.href);
await unlink(bundlePath);

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;

const client = new QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: 0 } },
});
let root = null;
let mountSeq = 0;

after(() => {
	for (const id of liveTimers) {
		clearTimeout(id);
		clearInterval(id);
	}
	try {
		window.close();
	} catch {
		// jsdom's own teardown; nothing to report.
	}
});

/* ------------------------------------------------------------------ */
/* Driving the composer                                                */
/* ------------------------------------------------------------------ */

/** The composer's band, which is the drop target. */
const band = () => window.document.querySelector("[data-lo-composer-band]");

/** What the store holds for a conversation, which is what the send reads. */
const staged = (conversationId) =>
	useConversationInputStore.getState().inputByConversation[conversationId]
		?.attachments ?? [];

/**
 * One drag event, as the handler sees it.
 *
 * `dataTransfer` is a plain object rather than a `DataTransfer`: jsdom has none,
 * and the handler reads exactly two members of it (`types` on `dragover`,
 * `files` on `drop`). `dropEffect` is a writable field so the `copy` write can
 * be asserted instead of silently dropped.
 */
const dragEvent = (type, { files = [], types = ["Files"] } = {}) => {
	const event = new window.Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: { files, types, dropEffect: "none" },
	});
	return event;
};

const dragOver = async (options) => {
	let event;
	await act(async () => {
		event = dragEvent("dragover", options);
		band().dispatchEvent(event);
	});
	return event;
};

const drop = async (options) => {
	let event;
	await act(async () => {
		event = dragEvent("drop", options);
		band().dispatchEvent(event);
	});
	// The path arm is synchronous; the fallback arm awaits a FileReader.
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 0));
	});
	return event;
};

/** One paste of a file, through the same `ClipboardEvent` shape the handler reads. */
const pasteFile = async (file) => {
	const field = window.document.querySelector('textarea[aria-label="Message"]');
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: {
			items: [{ kind: "file", type: file.type, getAsFile: () => file }],
		},
	});
	await act(async () => {
		field.dispatchEvent(event);
	});
	await act(async () => {
		await new Promise((resolve) => realSetTimeout(resolve, 0));
	});
};

/** A `File` the rig hands the composer; `bytes` only matters on the fallback arm. */
const rigFile = (name, type = "image/png") =>
	new window.File([new Uint8Array([1, 2, 3, 4])], name, { type });

async function mount({
	unavailable = false,
	conversationId = `drop-${++mountSeq}`,
} = {}) {
	window.localStorage.clear();
	useConversationInputStore.setState({ inputByConversation: {} });
	await act(async () => {
		root?.unmount();
	});
	root = createRoot(window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(MessageInput, {
					isLoading: false,
					messages: [{ id: "m", role: "system", timestamp: new Date(0) }],
					conversationId,
					unavailable,
					onSendMessage: async () => true,
				}),
			),
		);
	});
	assert.ok(band() !== null, "the composer band mounted");
	return conversationId;
}

/* ------------------------------------------------------------------ */
/* The cases                                                           */
/* ------------------------------------------------------------------ */

test("a file dragged over the band is cancelled, so the drop can fire", async () => {
	await mount();
	setPathBridge(() => "/tmp/rig-a.png");
	const event = await dragOver({ files: [rigFile("a.png")] });
	assert.equal(
		event.defaultPrevented,
		true,
		"dragover is cancelled for a file drag - without this the drop event never fires at all, which is the reported defect",
	);
	assert.equal(
		event.dataTransfer.dropEffect,
		"copy",
		"the pointer is told this is a copy",
	);
});

test("a TEXT drag is left alone: only file drags are claimed", async () => {
	await mount();
	const event = await dragOver({ types: ["text/plain", "text/html"] });
	assert.equal(
		event.defaultPrevented,
		false,
		"cancelling every dragover would also kill the browser's own drop-text-into-the-textarea path",
	);
});

test("a dropped file attaches by PATH - the same representation the attach button stores", async () => {
	const conversationId = await mount();
	setPathBridge((file) => `/tmp/rig/${file.name}`);
	const event = await drop({ files: [rigFile("photo.png")] });
	assert.equal(
		event.defaultPrevented,
		true,
		"the drop is cancelled, so the window cannot navigate to the file",
	);
	assert.deepEqual(
		staged(conversationId).map((attachment) => attachment.path),
		["/tmp/rig/photo.png"],
		"the store holds the file's path, not a base64 copy of it",
	);
});

test("several files attach, all of them, in the drag's own order", async () => {
	const conversationId = await mount();
	setPathBridge((file) => `/tmp/rig/${file.name}`);
	await drop({
		files: [rigFile("first.png"), rigFile("second.txt", "text/plain")],
	});
	assert.deepEqual(
		staged(conversationId).map((attachment) => attachment.path),
		["/tmp/rig/first.png", "/tmp/rig/second.txt"],
		"dataTransfer.files is a list: the rule is all of them, in the order the OS listed them",
	);
});

test("a file with no path on disk still lands, by the paste route", async () => {
	const conversationId = await mount();
	setPathBridge(() => "");
	await drop({ files: [rigFile("dragged-out-of-a-page.png")] });
	const [attachment] = staged(conversationId);
	assert.ok(
		attachment,
		"the fallback attached the file rather than dropping it silently",
	);
	assert.match(
		attachment.path,
		/^data:image\/png;base64,/,
		"a File the OS did not back has no path, so its bytes are all the renderer will ever have",
	);
});

test("a refusing box takes no drop, exactly as it takes no paste", async () => {
	const conversationId = await mount({ unavailable: true });
	setPathBridge((file) => `/tmp/rig/${file.name}`);
	const over = await dragOver({ files: [rigFile("photo.png")] });
	assert.equal(
		over.defaultPrevented,
		false,
		"a refused box does not claim the drag, so the OS shows its own 'no drop' cursor",
	);
	await drop({ files: [rigFile("photo.png")] });
	await pasteFile(rigFile("pasted.png"));
	assert.deepEqual(
		staged(conversationId),
		[],
		"neither route attached anything: the drop reads the same isInputDisabled term the paste does",
	);
});
