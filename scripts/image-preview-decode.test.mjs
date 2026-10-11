import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";

/*
 * The canvas image viewer's failure sentences, executable.
 *
 * WHY THIS FILE EXISTS (QA round 1, Q1). The viewer has always had copy for the
 * failures it could name: a read refused over the cap, a file that is gone, a
 * read that threw. The failure it had no sentence for was the bytes ARRIVING and
 * the element refusing to paint them - a 0-byte file, a text file with a `.png`
 * name, a truncated write - where Chromium's broken-image glyph was the whole
 * answer: no title, no reason, indistinguishable from a picture still arriving.
 * The composer's tile had a sentence for the same file and the video viewer had
 * one for the same failure, so this viewer was the one surface out of step with
 * its siblings. The fix reads the element's own `error` and states the reason;
 * this file mounts the shipped component and delivers that error, so the state is
 * entered the way the browser enters it rather than by a prop.
 *
 * REAL: the shipped `image-preview.tsx` and `file-viewer-state.tsx`, the shipped
 * `use-file-blob-url.ts` and blob cache, and the app's own UI kit, bundled from
 * source and mounted on a real DOM under this tree's own react/react-dom
 * (18.3.1) with `act`, as `transcript-paging-hook.test.mjs` does.
 *
 * SUBSTITUTED, and only these: `window.api.readFileBytes` (a hand-written
 * outcome, so each state is reachable exactly), `URL.createObjectURL` (a
 * countable ledger of `blob:` URLs, since node has no object-URL registry) and
 * the image DECODE - jsdom has no image decoder, so the element's verdict is
 * delivered by hand. That last substitution is the honest boundary: this file
 * proves the viewer responds to a decode failure, not that Chromium reports one
 * for a given file, which is QA's frame to show.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "image-preview-decode");

const bundle = await build({
	stdin: {
		contents: [
			'export { ImagePreview } from "./src/renderer/src/features/chat/components/canvas/image-preview";',
			'export { MAX_FILE_READ_BYTES } from "./src/shared/desktop-contract";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "image-preview.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);

// React DOM feature-detects its host at import time, so the document has to
// exist before it is loaded (the bootstrap `browser-queue-expiry.test.mjs` uses).
const bootstrapDOM = new JSDOM("<!doctype html><body></body>");
const { window } = bootstrapDOM;
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = (callback) =>
	window.setTimeout(() => callback(Date.now()), 0);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { ImagePreview, MAX_FILE_READ_BYTES } = await import(
	new URL(`file://${bundlePath}`).href
);

after(() => {
	bootstrapDOM.window.close();
	// `Reflect.deleteProperty` rather than `delete`, which the lint contract
	// forbids: the property has to be genuinely gone, not set to `undefined`.
	Reflect.deleteProperty(globalThis, "window");
	Reflect.deleteProperty(globalThis, "document");
	Reflect.deleteProperty(globalThis, "requestAnimationFrame");
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

// ---------------------------------------------------------------- fixtures

/** Reads the viewer asked for, so "this state must not read at all" is checkable. */
const reads = [];
let nextBlobUrl = 0;

function installBridge(outcome) {
	reads.length = 0;
	nextBlobUrl = 0;
	globalThis.window.api = {
		readFileBytes: async (path, cap) => {
			reads.push({ path, cap });
			return typeof outcome === "function" ? outcome(path, cap) : outcome;
		},
		openFile: async () => ({ ok: true }),
	};
	Object.defineProperty(globalThis.URL, "createObjectURL", {
		configurable: true,
		writable: true,
		value: () => `blob:image-preview/${nextBlobUrl++}`,
	});
	Object.defineProperty(globalThis.URL, "revokeObjectURL", {
		configurable: true,
		writable: true,
		value: () => {},
	});
}

/*
 * One document per case, with distinct paths: the blob cache is module state
 * shared across a process, so two cases on one path would share one entry and
 * the second case's read would never be issued.
 */
const canvasDocument = (name, overrides) => ({
	path: `/tmp/q1/${name}`,
	title: name,
	type: "image",
	lastAgentModified: 1,
	sizeBytes: 2,
	...overrides,
});

/** A whole turn of the event loop, so a read that resolves in a microtask lands. */
const settle = () =>
	act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	});

async function mount(document) {
	const host = window.document.createElement("div");
	window.document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(createElement(ImagePreview, { document }));
	});
	await settle();
	return {
		host,
		text: () => host.textContent ?? "",
		buttons: () => [...host.querySelectorAll("button")],
		rerender: async (next) => {
			await act(async () => {
				root.render(createElement(ImagePreview, { document: next }));
			});
			await settle();
		},
		unmount: () =>
			act(async () => {
				root.unmount();
				host.remove();
			}),
	};
}

test("bytes that land paint the picture, and bytes that cannot say why (Q1)", async () => {
	installBridge(() => ({
		success: true,
		data: new Uint8Array([0xde, 0xad]),
		sizeBytes: 2,
	}));
	const mounted = await mount(canvasDocument("zero.png"));

	const img = mounted.host.querySelector("img");
	assert.ok(img, "a landed read renders the picture from its blob URL");
	assert.match(img.getAttribute("src") ?? "", /^blob:/);
	assert.doesNotMatch(
		mounted.text(),
		/This image could not be shown/,
		"and nothing has failed yet",
	);

	// The element's own verdict that it cannot paint these bytes - the event
	// Chromium fires for a 0-byte or non-image file. jsdom has no decoder, so it
	// is delivered here rather than awaited.
	await act(async () => {
		img.dispatchEvent(new window.Event("error"));
	});

	// Compared as a BOOLEAN on purpose: `assert.equal(<jsdom element>, null)` makes
	// a failing run build its message with `util.inspect` over the element, and
	// jsdom's window graph is large enough that the runner dies of heap exhaustion
	// instead of reporting the assertion (measured on this host before the shape
	// was changed).
	assert.equal(
		mounted.host.querySelector("img") === null,
		true,
		"the element that cannot paint the bytes is not left on screen",
	);
	assert.match(
		mounted.text(),
		/This image could not be shown/,
		"the state carries a titled reason, as its siblings do",
	);
	assert.match(
		mounted.text(),
		/\/tmp\/q1\/zero\.png/,
		"and names the file, because the path is what the reader can act on",
	);
	assert.ok(
		mounted.buttons().some((b) => (b.textContent ?? "").includes("Open")),
		"with the same way out the other states offer",
	);

	await mounted.unmount();
});

test("a rewritten file is judged afresh rather than condemned by the old bytes", async () => {
	installBridge(() => ({
		success: true,
		data: new Uint8Array([1]),
		sizeBytes: 1,
	}));
	const mounted = await mount(canvasDocument("rewritten.png"));
	await act(async () => {
		mounted.host.querySelector("img").dispatchEvent(new window.Event("error"));
	});
	assert.match(mounted.text(), /This image could not be shown/);

	// The canvas hands a new document with a new mtime, which is a new cache key
	// and a new blob URL: the latch is keyed on the URL it describes.
	await mounted.rerender(
		canvasDocument("rewritten.png", { lastAgentModified: 2 }),
	);

	assert.ok(
		mounted.host.querySelector("img"),
		"the new version's bytes get their own attempt",
	);
	assert.doesNotMatch(mounted.text(), /This image could not be shown/);

	await mounted.unmount();
});

test("an over-cap file is stated without a read, as it was before", async () => {
	installBridge(() => {
		throw new Error("an over-cap file must not be read to be refused");
	});
	const mounted = await mount(
		canvasDocument("huge.png", { sizeBytes: MAX_FILE_READ_BYTES + 1 }),
	);

	assert.match(mounted.text(), /Too large to preview/);
	assert.equal(reads.length, 0, "nothing crossed the bridge for the refusal");
	assert.ok(
		mounted.buttons().some((b) => (b.textContent ?? "").includes("Open")),
	);

	await mounted.unmount();
});

test("a read that fails keeps its own reason and its own sentence", async () => {
	installBridge(() => ({
		success: false,
		code: "unreadable",
		error: "EACCES: permission denied, open '/tmp/q1/zero.png'",
	}));
	const mounted = await mount(canvasDocument("denied.png"));

	assert.match(mounted.text(), /This image could not be opened/);
	assert.match(
		mounted.text(),
		/EACCES: permission denied/,
		"the reason is the code's, not the decode sentence's",
	);
	assert.doesNotMatch(mounted.text(), /This image could not be shown/);

	await mounted.unmount();
});
