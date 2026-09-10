import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Coverage for the DURABLE image path — `use-attachment-url.ts`.
 *
 * This file exists because of what its absence cost. Round 1 of review found
 * three defects in this PR (two blockers), and all three were on the durable
 * half; a `grep` across `scripts/` for `use-attachment-url` returned nothing.
 * The live path, which the frames and the reducer tests cover, was sound
 * throughout. The lesson is not the two fixes, it is that a refcounted cache of
 * `URL.createObjectURL` handles — where every bug is invisible until memory
 * runs out — had no executable statement of its invariants.
 *
 * ## What is real here and what is substituted
 *
 * REAL: the shipped `use-attachment-url.ts` module, bundled from source. Its
 * module-level `cache` and `inflight` maps, `retain`/`release`/`peek`,
 * `fetchAttachment`/`abandonFetch`, and the effect body are the code under
 * test. Nothing is transcribed — a test that re-implements the semantics it is
 * checking proves only that the author held one idea twice.
 *
 * SUBSTITUTED: React itself, and `desktopMedia`. React is replaced by the
 * ~90-line hook runtime below because this repo has no DOM test environment
 * (no jsdom, no react-test-renderer) and adding one would change the lockfile.
 * The runtime implements exactly the three behaviours these invariants turn on:
 * `useState` with a lazy initializer, `useEffect` with dependency comparison
 * and cleanup ordering, and StrictMode's deliberate DOUBLE-INVOCATION of both.
 * That last one is not a detail — it is the mechanism of the R1 leak, and the
 * app really does mount under `StrictMode` (`main.tsx`).
 *
 * The substitution is stated rather than hidden because it bounds the claim:
 * these tests prove the hook's REFERENCE ACCOUNTING is correct under the mount
 * sequences React performs. They do not prove React performs those sequences.
 * QA's Q-16 covers that end — 10 session-switch cycles in the real app, blob
 * `created:1 revoked:0 live:1`, flat.
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

/** Pending `desktopMedia` calls, resolved by hand so mid-flight races are exact. */
const requests = [];
globalThis.__desktopMedia = (request) =>
	new Promise((resolve) => {
		requests.push({ request, resolve });
	});

function settleLast(mimeType = "image/png") {
	const pending = requests.pop();
	pending.resolve({ kind: "bytes", data: new Uint8Array([1]), mimeType });
	return pending;
}

// ------------------------------------------------------------ hook runtime

/**
 * The minimal React the hook needs. `strict` double-invokes the render body
 * (and therefore every `useState` initializer) and double-invokes effects as
 * mount/cleanup/mount, which is what `React.StrictMode` does in development.
 */
let current = null;

function useState(initial) {
	const instance = current;
	const slot = instance.hookIndex++;
	if (!(slot in instance.states)) {
		instance.states[slot] =
			typeof initial === "function" ? initial() : initial;
	} else if (instance.probing && typeof initial === "function") {
		// StrictMode's second pass re-runs the initializer and DISCARDS the
		// result. An initializer with a side effect therefore lands twice, which
		// is exactly the leak this file exists to pin.
		initial();
	}
	const setState = (value) => {
		const next = typeof value === "function" ? value(instance.states[slot]) : value;
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
		props,
		value: undefined,
	};
	instance.render = () => {
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
		contents:
			'export { useAttachmentUrl } from "./src/renderer/src/features/chat/canonical/use-attachment-url";',
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
				builder.onResolve(
					{ filter: /@shared\/api\/local-operator\/desktop-api/ },
					() => ({ path: "media", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /^react$/, namespace: "fixture" }, () => ({
					contents:
						"export const useState = (...a) => globalThis.__useState(...a);" +
						"export const useEffect = (...a) => globalThis.__useEffect(...a);",
					loader: "js",
				}));
				builder.onLoad({ filter: /^media$/, namespace: "fixture" }, () => ({
					contents:
						"export const desktopMedia = request => globalThis.__desktopMedia(request);",
					loader: "js",
				}));
			},
		},
	],
});
globalThis.__useState = useState;
globalThis.__useEffect = useEffect;
const { useAttachmentUrl } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * Every assertion below reads the BLOB LEDGER rather than the module's private
 * maps. That is deliberate and it is the stronger test: a refcount is an
 * implementation detail, while "a blob whose last holder is gone was revoked"
 * is the property the file promises and the one whose violation costs the user
 * memory. It also survives a rewrite of the accounting, which is exactly when
 * these invariants matter most.
 *
 * The module holds its cache module-wide and offers no reset, so each test
 * works in a fresh digest namespace instead of clearing it.
 */
let namespace = 0;
function reset() {
	namespace += 1;
	requests.length = 0;
	blobs.created = 0;
	blobs.revoked = 0;
	blobs.live.clear();
}

/** A fresh digest, so a module-wide cache cannot leak state between tests. */
const digestFor = (seed) =>
	`${namespace}`.padStart(4, "0") + `${seed}`.padStart(28, "0");

const durable = (digest) => ({
	id: "r:0",
	data: null,
	attachment: digest,
	mimeType: "image/png",
});

/** Mount the hook for one image, exactly as `CanonicalImage` does. */
const mountImage = (image, options) =>
	mount(
		({ image: img, sessionId }) => useAttachmentUrl(img, sessionId),
		{ image, sessionId: "8ca681d7aa73" },
		options,
	);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ------------------------------------------------------------------- tests

test("a warm mount does not ratchet the refcount (R1)", async () => {
	reset();
	const digest = digestFor(1);
	// One holder keeps the entry warm for everyone after it.
	const holder = mountImage(durable(digest));
	settleLast();
	await tick();
	const url = holder.value;
	assert.equal(blobs.live.size, 1, "the holder is showing one blob");

	// Five scroll-throughs of an already-cached screenshot. Each mount finds the
	// entry warm; each unmount must give back exactly what it took.
	for (let i = 0; i < 5; i++) {
		const row = mountImage(durable(digest));
		assert.equal(
			row.value,
			url,
			"a warm mount paints on its first frame rather than flashing empty",
		);
		row.unmount();
	}
	assert.equal(requests.length, 0, "a cached digest is never refetched");
	assert.equal(blobs.revoked, 0, "and a warm cycle revokes nothing early");

	// The whole point: the holder is now the ONLY holder again, so its unmount
	// must drop the count to zero and revoke. Before the fix the initializer had
	// added one ref per warm mount (refs=6) and this blob lived forever.
	holder.unmount();
	assert.equal(
		blobs.live.size,
		0,
		"five warm cycles net zero — the pre-fix code stranded this blob at refs=5",
	);
	assert.equal(blobs.revoked, 1, "the blob is actually revoked");
});

test("StrictMode's double-invoked initializer takes no reference (R1)", async () => {
	reset();
	const digest = digestFor(2);
	const holder = mountImage(durable(digest));
	settleLast();
	await tick();

	// The app mounts under StrictMode (`main.tsx`), so the initializer runs twice
	// and the effect mounts/cleans/mounts. A `retain()` in the initializer added
	// a phantom reference here that no unmount could ever pay back.
	const strict = mountImage(durable(digest), { strict: true });
	assert.equal(strict.value, holder.value, "it paints the cached picture");
	strict.unmount();
	assert.equal(
		blobs.live.size,
		1,
		"the StrictMode mount gave back everything it took",
	);

	holder.unmount();
	assert.equal(blobs.live.size, 0, "no blob outlives its last holder");
});

test("a fetch landing after its requester left orphans nothing (R2)", async () => {
	reset();
	// Fast scrolling: twenty distinct screenshots pass through the viewport and
	// every row unmounts before its bytes arrive.
	const rows = [];
	for (let i = 0; i < 20; i++) rows.push(mountImage(durable(digestFor(i))));
	assert.equal(requests.length, 20, "twenty requests are in flight");
	for (const row of rows) row.unmount();
	// The bytes land with nobody waiting.
	while (requests.length) settleLast();
	await tick();

	assert.equal(
		blobs.live.size,
		0,
		"no unreachable blob — the pre-fix code stranded 20 at refs:0",
	);
	assert.equal(
		blobs.revoked,
		blobs.created,
		"every blob created for a departed requester is revoked",
	);
});

test("a requester that stays gets its bytes even when others leave (R2)", async () => {
	reset();
	const digest = digestFor(3);
	// The dedup case: three rows want the same digest, two give up, one waits.
	const a = mountImage(durable(digest));
	const b = mountImage(durable(digest));
	const c = mountImage(durable(digest));
	assert.equal(requests.length, 1, "N mounts collapse to one request");
	a.unmount();
	b.unmount();
	settleLast();
	await tick();

	assert.ok(c.value?.startsWith("blob:"), "the survivor is handed its URL");
	assert.equal(blobs.live.size, 1, "the blob it is showing is alive");
	c.unmount();
	assert.equal(blobs.live.size, 0, "and dies with it");
});

test("an inline image never touches the cache or the network", () => {
	reset();
	const row = mountImage({
		id: "r:0",
		data: "aGVsbG8=",
		attachment: null,
		mimeType: "image/png",
	});
	assert.equal(row.value, "data:image/png;base64,aGVsbG8=");
	assert.equal(requests.length, 0, "a live image is already in memory");
	assert.equal(blobs.created, 0, "and needs no blob");
	row.unmount();
});

test("an image that fails to resolve reports null rather than throwing", async () => {
	reset();
	const row = mountImage(durable(digestFor(4)));
	requests.pop().resolve({ kind: "error", message: "gone" });
	await tick();
	assert.equal(row.value, null, "the view renders BrokenAttachment from this");
	assert.equal(blobs.created, 0, "a failure creates no blob");
	row.unmount();
});
