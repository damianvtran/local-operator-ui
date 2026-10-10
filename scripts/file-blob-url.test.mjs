import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Coverage for the LOCAL FILE path — `use-file-blob-url.ts`.
 *
 * This file exists because the hook became the app's file READER for surfaces
 * that used to ask the backend's `/v1/static/*` routes: the composer's staging
 * tiles, the canvas file list's thumbnails, the message attachments and the
 * video viewer's fallback. Two of its behaviours are load-bearing for exactly
 * that move and had no executable statement before:
 *
 *   - a path that is ALREADY a URL (`data:`, `http(s):`) passes through without
 *     being read, which is what lets those surfaces hand over mixed lists;
 *   - a `file://` spelling and a bare path are ONE cache entry, because the
 *     legacy payloads those surfaces render are split between the two spellings.
 *
 * The accounting half (retain/release, StrictMode's double-invoked initializer,
 * the mid-flight unmount) is the same discipline `attachment-url.test.mjs`
 * pins for the digest-keyed twin, and is pinned here for the path-keyed one
 * because a leaked blob is invisible until memory runs out.
 *
 * ## What is real here and what is substituted
 *
 * REAL: the shipped `use-file-blob-url.ts` and the shipped
 * `blob-url-cache.ts`, bundled from source, plus the `MAX_FILE_READ_BYTES`
 * ceiling from `desktop-contract.ts` — the literal is not repeated here.
 *
 * SUBSTITUTED: React (the runtime below is the one `attachment-url.test.mjs`
 * uses, copied deliberately and stated here rather than hidden: both files need
 * `useState`'s lazy-initializer and `useEffect`'s cleanup ordering and neither
 * adds a DOM test environment to the lockfile), `URL`/`Blob` (a countable blob
 * ledger), and `window.api.readFileBytes` (a queue resolved by hand, so
 * mid-flight races are exact).
 *
 * The substitution bounds the claim the same way it does there: these tests
 * prove the hook's semantics and reference accounting under the mount sequences
 * React performs. They do not prove React performs them.
 */

// ---------------------------------------------------------------- fixtures

/** Blob handles the module creates, so a leak is a countable fact. */
const blobs = { created: 0, revoked: 0, live: new Set() };
let nextBlobId = 0;
globalThis.URL = {
	createObjectURL: () => {
		const url = `blob:test/${nextBlobId++}`;
		blobs.created += 1;
		blobs.live.add(url);
		return url;
	},
	revokeObjectURL: (url) => {
		blobs.revoked += 1;
		blobs.live.delete(url);
	},
};
globalThis.Blob = class Blob {
	constructor(parts) {
		this.parts = parts;
	}
};

/** Pending `readFileBytes` calls, resolved by hand. */
const reads = [];
function installBridge() {
	globalThis.window = {
		api: {
			readFileBytes: (path) =>
				new Promise((resolve) => {
					reads.push({ path, resolve });
				}),
		},
	};
}
installBridge();

/** The no-bridge shape a browser (Storybook) run has: `window.api` absent. */
function removeBridge() {
	globalThis.window = {};
}

function settleLast(result) {
	const pending = reads.pop();
	pending.resolve(result);
	return pending;
}

const bytes = (size = 3) => ({
	success: true,
	data: new Uint8Array(size),
	sizeBytes: size,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------ hook runtime

/**
 * The minimal React the hook needs. `strict` double-invokes the render body
 * (and therefore every `useState` initializer) and double-invokes effects as
 * mount/cleanup/mount, which is what `React.StrictMode` does in development.
 * Same runtime as `attachment-url.test.mjs`; see the header for why it is a
 * copy rather than a shared import.
 */
let current = null;

function useState(initial) {
	const instance = current;
	const slot = instance.hookIndex++;
	if (!(slot in instance.states)) {
		instance.states[slot] = typeof initial === "function" ? initial() : initial;
	} else if (instance.probing && typeof initial === "function") {
		// StrictMode's second pass re-runs the initializer and DISCARDS the
		// result. An initializer with a side effect therefore lands twice, which
		// is exactly the leak this runtime exists to expose.
		initial();
	}
	const setState = (value) => {
		const next =
			typeof value === "function" ? value(instance.states[slot]) : value;
		if (Object.is(next, instance.states[slot])) return;
		instance.states[slot] = next;
		if (!instance.unmounted) instance.render();
	};
	return [instance.states[slot], setState];
}

function useEffect(fn, deps) {
	const instance = current;
	const slot = instance.hookIndex++;
	if (instance.probing) return;
	const previous = instance.effects[slot];
	const changed =
		!previous ||
		!deps ||
		!previous.deps ||
		deps.length !== previous.deps.length ||
		deps.some((dep, i) => !Object.is(dep, previous.deps[i]));
	instance.effects[slot] = { fn, deps, cleanup: previous?.cleanup };
	if (changed) instance.pending.push(slot);
}

function mount(hook, props, { strict = false } = {}) {
	const instance = {
		states: [],
		effects: [],
		pending: [],
		hookIndex: 0,
		unmounted: false,
		probing: false,
		rendering: false,
		rerenderQueued: false,
		props,
		value: undefined,
	};
	/*
	 * A setState issued WHILE a render is being committed (from an effect's fn,
	 * which is where a cold mount's `setState({status:"loading"})` lands) does
	 * not re-enter — React schedules it and flushes after the current pass. This
	 * runtime tracks that with `rendering`/`rerenderQueued` instead of recursing,
	 * because recursing would replace the effects slot mid-loop and the cleanup
	 * the effect is about to install would land on the abandoned entry (measured:
	 * the release never ran). The digest-keyed twin's state setters happen to be
	 * value-stable so its copy of this runtime never distinguishes the two.
	 */
	instance.render = () => {
		if (instance.rendering) {
			instance.rerenderQueued = true;
			return;
		}
		instance.rendering = true;
		try {
			do {
				instance.rerenderQueued = false;
				const previous = current;
				current = instance;
				instance.hookIndex = 0;
				instance.pending = [];
				instance.value = hook(instance.props);
				if (strict) {
					// The double render. State slots are already committed, so only the
					// initializers re-run — React's own behaviour.
					instance.probing = true;
					instance.hookIndex = 0;
					hook(instance.props);
					instance.probing = false;
				}
				current = previous;
				for (const slot of instance.pending) {
					const effect = instance.effects[slot];
					effect.cleanup?.();
					effect.cleanup = effect.fn() ?? undefined;
					if (strict) {
						// StrictMode mounts, tears down, and mounts again. A cleanup that
						// does not undo its own setup shows up here.
						effect.cleanup?.();
						effect.cleanup = effect.fn() ?? undefined;
					}
				}
			} while (instance.rerenderQueued && !instance.unmounted);
		} finally {
			instance.rendering = false;
		}
	};
	instance.unmount = () => {
		instance.unmounted = true;
		for (const effect of instance.effects) effect?.cleanup?.();
	};
	instance.render();
	return instance;
}

// ------------------------------------------------------------------ bundle

const bundle = await build({
	stdin: {
		contents: [
			'export { useFileBlobUrl } from "./src/renderer/src/shared/hooks/use-file-blob-url";',
			'export { MAX_FILE_READ_BYTES } from "./src/shared/desktop-contract";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "hook-runtime",
			setup(builder) {
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "fixture",
				}));
				/*
				 * REAL, not stubbed: the shipped refcounted blob cache. Bundling the shipped
				 * module is what keeps these tests honest about the accounting they pin.
				 */
				builder.onResolve({ filter: /^@shared\/lib\/blob-url-cache$/ }, () => ({
					path: resolve(
						process.cwd(),
						"src/renderer/src/shared/lib/blob-url-cache.ts",
					),
				}));
				builder.onLoad({ filter: /^react$/, namespace: "fixture" }, () => ({
					contents:
						"export const useState = (...a) => globalThis.__useState(...a);" +
						"export const useEffect = (...a) => globalThis.__useEffect(...a);",
					loader: "js",
				}));
			},
		},
	],
});
globalThis.__useState = useState;
globalThis.__useEffect = useEffect;
const { useFileBlobUrl, MAX_FILE_READ_BYTES } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The module holds its cache module-wide and offers no reset, so each test
 * works in a fresh path namespace instead of clearing it.
 */
let namespace = 0;
function reset() {
	namespace += 1;
	reads.length = 0;
	blobs.created = 0;
	blobs.revoked = 0;
	blobs.live.clear();
	installBridge();
}

/** A fresh path, so a module-wide cache cannot leak state between tests. */
const pathFor = (name) => `/Users/dana/file-blob-url-test/${namespace}/${name}`;

const mountFile = (
	path,
	options = { mimeType: "image/png" },
	mountOptions = {},
) =>
	mount(
		({ path: p, options: o }) => useFileBlobUrl(p, o),
		{ path, options },
		mountOptions,
	);

// ------------------------------------------------------------------- tests

test("bytes come from the bridge and the blob is revoked on unmount", async () => {
	reset();
	const path = pathFor("a.png");
	const view = mountFile(path);
	assert.equal(reads.length, 1, "the bridge is asked once");
	assert.equal(reads[0].path, path, "with the bare path as written");

	settleLast(bytes());
	await tick();
	assert.equal(view.value.status, "ready");
	assert.equal(blobs.live.size, 1, "the viewer is showing one blob");
	assert.equal(blobs.created, 1);

	view.unmount();
	// The last release revokes at the end of the task (blob-url-cache rule 3),
	// so the ledger only settles after a tick — one is past the microtask.
	await tick();
	assert.equal(blobs.live.size, 0, "unmount revokes the last holder");
	assert.equal(blobs.revoked, 1);
});

test("the bytes are cached: a second holder reads nothing", async () => {
	reset();
	const path = pathFor("b.png");
	const first = mountFile(path);
	settleLast(bytes());
	await tick();
	const url = first.value.url;

	const second = mountFile(path);
	assert.equal(
		second.value.status,
		"ready",
		"a warm mount paints on its first frame",
	);
	assert.equal(second.value.url, url, "and with the same blob");
	assert.equal(reads.length, 0, "a cached path is never refetched");

	// Two holders, one blob: the first unmount must not revoke under the second.
	first.unmount();
	assert.equal(blobs.live.size, 1, "one holder still rendering");
	second.unmount();
	await tick();
	assert.equal(blobs.live.size, 0, "the last unmount revokes");
	assert.equal(blobs.revoked, 1, "exactly once, not twice");
});

test("`file://` and a bare path are one cache entry", async () => {
	reset();
	const path = pathFor("c.png");
	const withScheme = mountFile(`file://${path}`);
	assert.equal(reads.length, 1);
	assert.equal(
		reads[0].path,
		path,
		"the bridge is handed the bare path, not the scheme spelling",
	);
	settleLast(bytes());
	await tick();
	const url = withScheme.value.url;
	withScheme.unmount();

	const bare = mountFile(path);
	assert.equal(bare.value.status, "ready", "the other spelling is warm");
	assert.equal(bare.value.url, url);
	assert.equal(reads.length, 0, "and does not re-read");
	bare.unmount();
	await tick();
});

test("an already-URL path passes through without a read", async () => {
	reset();
	const dataUri = "data:image/png;base64,iVBORw0KGgo=";
	const webUrl = "https://example.invalid/chart.png";

	for (const [spelling, path] of [
		["data:", dataUri],
		["http(s):", webUrl],
	]) {
		const view = mountFile(path);
		assert.equal(view.value.status, "ready", `${spelling} is ready on mount`);
		assert.equal(view.value.url, path, `${spelling} is used as written`);
		assert.equal(blobs.created, 0, `${spelling} creates no blob to leak`);
		view.unmount();
	}
	assert.equal(reads.length, 0, "nothing was read from disk");
	assert.equal(blobs.created, 0, "and nothing was created");
});

test("a file over the read cap is refused WITHOUT a read", async () => {
	reset();
	const path = pathFor("huge.png");
	const view = mountFile(path, {
		mimeType: "image/png",
		sizeBytes: MAX_FILE_READ_BYTES + 1,
	});
	assert.equal(view.value.status, "unavailable");
	assert.equal(view.value.code, "too-large");
	assert.equal(reads.length, 0, "main would refuse it anyway; nobody asked");
	view.unmount();
	await tick();
});

test("a rewrite is a different cache entry (the mtime is the key)", async () => {
	reset();
	const path = pathFor("edited.png");
	const first = mountFile(path, { mimeType: "image/png", mtimeMs: 1 });
	settleLast(bytes());
	await tick();
	const url = first.value.url;
	first.unmount();
	await tick();
	assert.equal(blobs.live.size, 0, "the old bytes are gone");

	const rewritten = mountFile(path, { mimeType: "image/png", mtimeMs: 2 });
	assert.equal(rewritten.value.status, "loading", "a new mtime is a cold key");
	assert.equal(reads.length, 1, "and re-reads");
	settleLast(bytes(7)); // a different byte count, so a stale serve would show
	await tick();
	assert.equal(rewritten.value.status, "ready");
	assert.notEqual(rewritten.value.url, url, "new bytes, new blob URL");
	rewritten.unmount();
	await tick();
});

test("a viewer closed mid-read leaks nothing", async () => {
	reset();
	const path = pathFor("d.png");
	const view = mountFile(path);
	assert.equal(reads.length, 1, "the read is in flight");
	view.unmount();

	settleLast(bytes());
	await tick();
	/*
	 * The hook checks liveness BEFORE building a blob (`if (!live) return` right
	 * after the await), so the bytes that landed for nobody never become a URL at
	 * all — not even for the microtask a revoke would take. Nothing is stranded.
	 */
	assert.equal(blobs.created, 0, "the discarded read built no blob");
	assert.equal(blobs.live.size, 0, "and nothing is live");
	assert.equal(blobs.revoked, 0, "nothing to revoke");
});

test("no bridge is a stated state, not a hang", async () => {
	reset();
	removeBridge();
	const view = mountFile(pathFor("e.png"));
	assert.equal(view.value.status, "unavailable");
	assert.equal(view.value.code, "no-bridge");
	assert.equal(reads.length, 0, "there was nothing to call");
	view.unmount();
	await tick();
});

test("a bridge refusal is carried through as its own code", async () => {
	reset();
	const path = pathFor("f.png");
	const view = mountFile(path);
	settleLast({
		success: false,
		code: "not-found",
		error: `No file at ${path}`,
	});
	await tick();
	assert.equal(view.value.status, "unavailable");
	assert.equal(view.value.code, "not-found");
	assert.equal(blobs.created, 0, "no blob for refused bytes");
	view.unmount();
	await tick();
});

test("StrictMode's double mount leaks nothing", async () => {
	reset();
	const path = pathFor("g.png");
	const view = mountFile(path, { mimeType: "image/png" }, { strict: true });
	/*
	 * The double mount issues its read twice (development-only; nothing collapses
	 * across mounts here, unlike the digest path's `inflight` map). Settle both:
	 * the first lands after its own effect already tore down, so its bytes must be
	 * discarded BEFORE a blob is built rather than strand an entry no unmount can
	 * release.
	 */
	assert.equal(reads.length, 2, "the double mount reads twice");
	const [first, second] = reads;
	reads.length = 0;
	first.resolve(bytes());
	second.resolve(bytes());
	await tick();
	assert.equal(view.value.status, "ready");
	assert.equal(blobs.created, 1, "the torn-down read built no blob");
	assert.equal(blobs.live.size, 1, "exactly one blob holds the viewer");

	view.unmount();
	await tick();
	assert.equal(blobs.live.size, 0, "the holder's unmount revokes it");
	assert.equal(blobs.revoked, 1, "once");
});
