import assert from "node:assert/strict";
import { unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE QUICK-SEND STRIP'S ADMISSION, mounted — the image-only send (issue #790).
 *
 * WHY THIS FILE IS BEHAVIOURAL RATHER THAN A FRAME. The strip refused an
 * image-only message in its own predicate: `canSend` was text-only, so a
 * pasted screenshot armed nothing and Send stayed dead — and the refusal was
 * silent, because there was no route for the paste to arrive on at all. A
 * still of the dead control is the symptom; only a driven mount shows what
 * arms it and what the send seam then carries.
 *
 * THE THREE CASES:
 *
 *  1. A pasted screenshot alone arms Send, draws as a preview tile, and rides
 *     the seam as an attachment (the #790 reproduction — red against the
 *     text-only predicate, green once the paste route and the predicate
 *     agree with the wire's own rule: text OR images is a message).
 *  2. Text alone still sends with an empty attachment list — the behaviour
 *     the fix must not disturb.
 *  3. A non-image paste stages nothing. This strip's route carries images
 *     only: where the composer's paste path also takes `kind === "file"`,
 *     the strip has no file dialog and no Files-panel record beside it, and
 *     the encoder leaves non-image paths out of the body by design — staging
 *     one would arm Send for a message that cannot carry it.
 *
 * WHAT IS REAL: the shipped `ProjectQuickSend`. What is faked, and only that:
 * `onSend`, a recorder — the component's contract is with that prop, and the
 * admission store behind it is `admitChatDraft`'s own territory. The
 * end-to-end play (a real clipboard paste into the running app) is the
 * renderer driver's scenario, not this file's.
 *
 * WHAT IT IS NOT: pixel evidence. jsdom has no layout engine, so the preview
 * tile is asserted as a node and its source, never as a measurement — that
 * half belongs to the design round's frames.
 */

// React DOM feature-detects input events at import time, so the document has
// to exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/projects",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM
		// globals this file needs are the ones already copied above.
	}
}
/*
 * THE EVENT AND FILE CONSTRUCTORS MUST COME FROM JSDOM'S REALM, not Node's
 * (the `projects-card-click.test.mjs` note): React's synthetic event system
 * reads `instanceof` against the globals the component's realm sees, and
 * jsdom refuses `dispatchEvent` with a foreign realm's event. `File` /
 * `FileReader` / `Blob` are forced too because Node has its own `File` and
 * `Blob` globals now, and a mixed pair makes `readAsDataURL` throw inside
 * the component's own paste route.
 */
for (const name of [
	"Event",
	"CustomEvent",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"ClipboardEvent",
	"File",
	"FileReader",
	"Blob",
]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* No backend may be reached from a test run. */
globalThis.fetch = () =>
	Promise.reject(new Error("no backend in this harness"));
/* Radix's layers schedule frames; jsdom has none without `pretendToBeVisual`. */
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
/*
 * A STORAGE THAT ANSWERS, because ui-kit modules rehydrate persisted snapshots
 * at import time and a jsdom window without storage throws inside them before
 * any test runs.
 */
const storage = new Map();
Object.defineProperty(dom.window, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
		clear: () => storage.clear(),
		key: (index) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		},
	},
});
globalThis.localStorage = dom.window.localStorage;
dom.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
globalThis.matchMedia = dom.window.matchMedia;
process.on("exit", () => {
	try {
		dom.window.close();
	} catch {
		// The window may already be torn down by a completed run.
	}
});

const ROOT = process.cwd();

/* -------------------------------------------------- bundle: the shipped strip */

/*
 * BUNDLED RATHER THAN IMPORTED (`projects-request-update.test.mjs`'s recipe):
 * the strip is TypeScript in the renderer tree, and the app's tsconfig does
 * not run here. `packages: "external"` keeps node_modules out of the bundle
 * so the runtime resolves the SAME React instance the test drives.
 */
const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { createRoot } from "react-dom/client";
			import { ProjectQuickSend } from "./src/renderer/src/features/projects/components/project-quick-send";

			export function mount(container, props) {
				const root = createRoot(container);
				root.render(createElement(ProjectQuickSend, props));
				return root;
			}
		`,
		resolveDir: ROOT,
		sourcefile: "projects-quick-send.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	/*
	 * `import.meta.env` IS VITE'S, and the config singleton validates it at
	 * import time (`load-config.ts`); Node ESM has no such key, so an
	 * undefended import throws before any case runs. An empty object is the
	 * honest stand-in — every schema field is optional-with-default, and no
	 * test here dials a service (the `agents-composer-mount.test.mjs`
	 * recipe, verbatim).
	 */
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
const bundlePath = new URL(
	`./_projects-quick-send-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(bundlePath.pathname);
	} catch {
		// already gone
	}
});
const { mount } = await import(bundlePath.href);

/* ------------------------------------------------------------- the fixture */

/** One linked session, the fields the strip reads. */
const LINK = {
	session_id: "s1",
	exists: true,
	title: "Payments cutover",
	created_at: null,
	archived: false,
	runtime: { state: "live", busy: false, heartbeat_age_s: 1, pid: 1 },
	subagents: null,
	todos: null,
};

/** Bytes with a PNG signature; the reader only has to round-trip them. */
const PNG_BYTES = [
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
];
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 10));
};

const input = (host) =>
	host.querySelector('[aria-label="Message the selected session"]');
const sendControl = (host) =>
	host.querySelector('[data-tour-tag="project-quick-send"]');

/** The composer's own typing shape: the value, then the event a key sends. */
const type = async (host, text) => {
	const box = input(host);
	assert.ok(box, "the strip's box is mounted");
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	)?.set;
	await act(async () => {
		setter?.call(box, text);
		box.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	return box;
};

const pasteItems = async (host, items) => {
	const box = input(host);
	assert.ok(box, "the strip's box is mounted");
	await act(async () => {
		const event = new dom.window.Event("paste", {
			bubbles: true,
			cancelable: true,
		});
		Object.defineProperty(event, "clipboardData", { value: { items } });
		box.dispatchEvent(event);
		await settle();
	});
};

/** One image item, as a clipboard hands it over. */
const imageItem = (bytes = PNG_BYTES) => {
	const file = new dom.window.File([new Uint8Array(bytes)], "screenshot.png", {
		type: "image/png",
	});
	return { type: "image/png", kind: "file", getAsFile: () => file };
};

const mountStrip = async (props = {}) => {
	const host = document.createElement("div");
	document.body.append(host);
	const sent = [];
	let root;
	await act(async () => {
		root = mount(host, {
			links: [LINK],
			target: "s1",
			onTargetChange: () => {},
			onSend: async (...args) => {
				sent.push(args);
				return true;
			},
			focusTick: 0,
			...props,
		});
	});
	return { host, root, sent };
};

const unmount = async (root) => {
	await act(async () => root.unmount());
};

/* ------------------------------------------------------------------ cases */

test("a pasted screenshot alone arms Send and rides the seam as an attachment", async () => {
	const { host, root, sent } = await mountStrip();
	try {
		assert.equal(
			sendControl(host).disabled,
			true,
			"an empty strip cannot send",
		);
		await pasteItems(host, [imageItem()]);
		assert.equal(
			sendControl(host).disabled,
			false,
			"the image alone arms Send — issue #790: this used to stay dead until text appeared",
		);
		const tile = host.querySelector("img");
		assert.ok(tile, "the pasted image is drawn as a preview tile");
		assert.equal(tile.getAttribute("src"), PNG_DATA_URL);
		await act(async () => {
			sendControl(host).dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			await settle();
		});
		assert.equal(sent.length, 1, "exactly one send left the strip");
		assert.deepEqual(
			sent[0],
			["s1", "", "prompt", [PNG_DATA_URL]],
			"the seam receives the pasted image as the strip's attachment list",
		);
		assert.equal(input(host).value, "", "the delivered text is spent");
		assert.equal(
			host.querySelector("img"),
			null,
			"and the delivered attachment is spent with it",
		);
	} finally {
		await unmount(root);
	}
});

test("text alone still sends, and an empty strip still cannot", async () => {
	const { host, root, sent } = await mountStrip();
	try {
		assert.equal(sendControl(host).disabled, true, "empty stays disabled");
		await type(host, "  steer it back  ");
		assert.equal(sendControl(host).disabled, false);
		await act(async () => {
			sendControl(host).dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			await settle();
		});
		assert.equal(sent.length, 1);
		assert.deepEqual(sent[0], ["s1", "steer it back", "prompt", []]);
	} finally {
		await unmount(root);
	}
});

test("a non-image paste stages nothing — the strip's route carries images only", async () => {
	const { host, root, sent } = await mountStrip();
	try {
		const file = new dom.window.File([new Uint8Array([1, 2, 3])], "notes.pdf", {
			type: "application/pdf",
		});
		await pasteItems(host, [
			{ type: "application/pdf", kind: "file", getAsFile: () => file },
		]);
		assert.equal(
			sendControl(host).disabled,
			true,
			"a non-image paste does not arm Send",
		);
		assert.equal(host.querySelector("img"), null, "nothing is drawn for it");
		assert.equal(sent.length, 0);
	} finally {
		await unmount(root);
	}
});

/*
 * D3 of design round 1 on issue #790: the clipboard is the strip's only image
 * route, so the placeholder is the surface's one affordance for it - without
 * it the capability is discoverable only by someone who happens to try
 * pasting, which is the silence the strip was fixed for. Pinned as copy:
 * the line is the contract.
 */
test("the strip's empty box names its clipboard route", async () => {
	const { host, root } = await mountStrip();
	try {
		assert.match(
			input(host).getAttribute("placeholder") ?? "",
			/paste an image/,
			"the placeholder must name pasting an image (design round 1, D3)",
		);
	} finally {
		await unmount(root);
	}
});
