/**
 * The agent-avatar proof of concept, asserted in Node.
 *
 * WHAT IS DRIVEN, and why in two bundles. The pure rules (`avatar-image.ts`) are
 * imported straight: they decide what a picked file may become and which square
 * of it survives, and they are the half a reviewer can read a failure from. The
 * store and its hook are bundled WITH `react` external and mounted in JSDOM, so
 * the assertion about "a picture the settings pane stores appears in the row"
 * is a render, not a read of the store's own fields - the two ways this could
 * break are a store that does not persist and a hook that does not subscribe,
 * and only the second one needs a component to fail.
 *
 * The canvas half (`downscale-image.ts`) is refused here, not drawn: Node has no
 * canvas, so what this file pins is that the type and size gates fire BEFORE a
 * decode. The drawing is exercised through the app and its frames, which is the
 * evidence the brief asks for.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The bundle lands in `node_modules/.cache`, not in `scripts/`: a bare
 * specifier (`react`) has to resolve from the bundle's own directory, which a
 * scratchpad outside the tree cannot do, and `node_modules` is the one place a
 * generated file is already excluded from the tree's gates. The name is unique
 * per run so two suites cannot clobber each other's file.
 */
const BUNDLE_DIR = "node_modules/.cache";
const RUN = `agent-avatar-${process.pid}`;
const PURE_BUNDLE = join(BUNDLE_DIR, `${RUN}-pure.mjs`);
const STORE_BUNDLE = join(BUNDLE_DIR, `${RUN}-store.mjs`);
const HARNESS_BUNDLE = join(BUNDLE_DIR, `${RUN}-harness.mjs`);

await mkdir(BUNDLE_DIR, { recursive: true });

const bundle = async (file, contents, extra = {}) => {
	const result = await build({
		stdin: { contents, resolveDir: process.cwd(), loader: "tsx" },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		jsx: "automatic",
		alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
		write: false,
		...extra,
	});
	await writeFile(file, result.outputFiles[0].text);
	return new URL(`../${file}`, import.meta.url).href;
};

const pureUrl = await bundle(
	PURE_BUNDLE,
	`export * from "./src/renderer/src/shared/agent-avatar/avatar-image";`,
);
const storeUrl = await bundle(
	STORE_BUNDLE,
	`export {
		useAgentAvatar,
		setAgentAvatar,
		clearAgentAvatar,
		useAgentAvatarStore,
	} from "@shared/store/agent-avatar-store";`,
);
const harnessUrl = await bundle(
	HARNESS_BUNDLE,
	`export { downscaleAgentAvatar, AgentAvatarError } from "./src/renderer/src/shared/agent-avatar/downscale-image";`,
);

const {
	AGENT_AVATAR_ACCEPT,
	AGENT_AVATAR_EDGE,
	AGENT_AVATAR_LIMIT,
	AGENT_AVATAR_MAX_DATA_URL_CHARS,
	AGENT_AVATAR_MAX_PIXELS,
	AGENT_AVATAR_MAX_TOTAL_CHARS,
	AGENT_AVATAR_MIME_TYPES,
	avatarFileRejection,
	avatarPixelRefusal,
	coverSourceRect,
	sanitizeAvatarImages,
} = await import(pureUrl);
const { downscaleAgentAvatar, AgentAvatarError } = await import(harnessUrl);

const REFUSAL_MESSAGE = /agent avatar refused: type/;
const WEBP = "data:image/webp;base64,AAAA";

/*
 * ONE window for the whole file, with a real `localStorage` (jsdom only provides
 * one when the document has an origin), because the store module reads that
 * global at import time.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "https://local-operator.test/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

after(async () => {
	await Promise.all(
		[PURE_BUNDLE, STORE_BUNDLE, HARNESS_BUNDLE].map((file) =>
			unlink(file).catch(() => {}),
		),
	);
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.localStorage = undefined;
});

test("the picker's filter and the gate name the same formats", () => {
	assert.equal(AGENT_AVATAR_ACCEPT, AGENT_AVATAR_MIME_TYPES.join(","));
	assert.ok(AGENT_AVATAR_MIME_TYPES.includes("image/webp"));
	/* SVG is the one image type the downscale cannot decode, so it is absent from
	 * the filter rather than failing after the picker closes. */
	assert.ok(!AGENT_AVATAR_MIME_TYPES.includes("image/svg+xml"));
});

test("a file is refused before it is decoded", () => {
	const ok = { type: "image/png", size: 1024 };
	assert.equal(avatarFileRejection(ok), null);
	for (const type of ["image/svg+xml", "application/pdf", "", "image"]) {
		assert.equal(
			avatarFileRejection({ type, size: 1024 }),
			"type",
			`${type} must be refused as a type`,
		);
	}
	assert.equal(
		avatarFileRejection({ type: "image/png", size: 0 }),
		"decode",
		"an empty file is unreadable, not oversized (QA round 1, Q-1)",
	);
	assert.equal(
		avatarFileRejection({ type: "image/png", size: 9 * 1024 * 1024 }),
		"size",
	);
});

/*
 * THE COPY AND THE GATE ARE ONE FACT (review round 1, R1-7). The type refusal
 * spells out the formats in eight catalogues while `AGENT_AVATAR_MIME_TYPES` is
 * what actually accepts a file, so the two could drift silently. This reads the
 * shipped English sentence and asserts it names the gate's formats, in the
 * gate's own order; changing either alone fails here. The table below is the
 * only place a MIME type is given a display name.
 */
test("the type refusal names exactly the formats the gate accepts", async () => {
	const catalogue = JSON.parse(
		await readFile("src/i18n/catalogues/en/ui.agents.settings.json", "utf8"),
	);
	const copy =
		catalogue["ui.agents.settings.general.profile_picture_error_type"];
	assert.equal(typeof copy, "string");
	const displayName = {
		"image/png": "PNG",
		"image/jpeg": "JPEG",
		"image/webp": "WebP",
		"image/gif": "GIF",
		"image/avif": "AVIF",
	};
	const positions = AGENT_AVATAR_MIME_TYPES.map((mime) => {
		const name = displayName[mime];
		assert.ok(name, `${mime} has no display name in this table`);
		return copy.indexOf(name);
	});
	assert.ok(
		positions.every((at) => at >= 0),
		`every accepted format must be named: ${copy}`,
	);
	assert.deepEqual(
		[...positions].sort((a, b) => a - b),
		positions,
		"the sentence must name the formats in the gate's order",
	);
});

/*
 * THE PIXEL CEILING (review round 1, R1-5). The byte gate above cannot see it:
 * a flat-colour PNG of 8,000 x 8,000 is a few hundred kilobytes and decodes to
 * 64 megapixels. Both dimensions are checked, including the degenerate ones, so
 * a metadata reader cannot hand this rule a value it turns into a false pass.
 */
test("the pixel gate refuses a source past the megapixel bound", () => {
	assert.equal(AGENT_AVATAR_MAX_PIXELS, 64_000_000);
	assert.equal(avatarPixelRefusal(800, 600), null);
	assert.equal(avatarPixelRefusal(8000, 8000), null);
	assert.equal(avatarPixelRefusal(8001, 8000), "decode");
	assert.equal(avatarPixelRefusal(40_000, 40_000), "decode");
	assert.equal(avatarPixelRefusal(0, 100), "decode");
	assert.equal(avatarPixelRefusal(Number.NaN, 100), "decode");
});

test("the greedy crop keeps the centre square of either orientation", () => {
	assert.deepEqual(coverSourceRect(1920, 1080), {
		sx: 420,
		sy: 0,
		side: 1080,
	});
	assert.deepEqual(coverSourceRect(800, 1200), { sx: 0, sy: 200, side: 800 });
	assert.deepEqual(coverSourceRect(512, 512), { sx: 0, sy: 0, side: 512 });
	/* A degenerate bitmap is still a square, never a zero-edge draw. */
	assert.deepEqual(coverSourceRect(0, 0), { sx: 0, sy: 0, side: 1 });
	assert.equal(AGENT_AVATAR_EDGE, 256);
});

test("a stored blob is filtered rather than trusted", () => {
	const kept = sanitizeAvatarImages({
		a1: WEBP,
		a2: "data:image/png;base64,BBBB",
		a3: "data:image/jpeg;base64,CCCC",
		"": WEBP,
		a4: "https://example.test/avatar.png",
		a5: "javascript:alert(1)",
		a6: "data:image/svg+xml;base64,AAAA",
		a7: 42,
		a8: { src: WEBP },
	});
	assert.deepEqual(Object.keys(kept).sort(), ["a1", "a2", "a3"]);

	assert.deepEqual(sanitizeAvatarImages(null), {});
	assert.deepEqual(sanitizeAvatarImages([]), {});
	assert.deepEqual(sanitizeAvatarImages("nope"), {});

	/* Beyond the ceiling the OLDEST keys go: the newest picture is the one the
	 * user is looking at. */
	const many = {};
	for (let index = 0; index < AGENT_AVATAR_LIMIT + 5; index++) {
		many[`agent-${index}`] = WEBP;
	}
	const trimmed = sanitizeAvatarImages(many);
	assert.equal(Object.keys(trimmed).length, AGENT_AVATAR_LIMIT);
	assert.equal(trimmed["agent-4"], undefined);
	assert.equal(trimmed[`agent-${AGENT_AVATAR_LIMIT + 4}`], WEBP);
});

test("the type and size refusals fire before any canvas work", async () => {
	await assert.rejects(
		() => downscaleAgentAvatar({ type: "text/plain", size: 10 }),
		(error) =>
			error instanceof AgentAvatarError &&
			error.code === "type" &&
			REFUSAL_MESSAGE.test(error.message),
	);
	await assert.rejects(
		() => downscaleAgentAvatar({ type: "image/png", size: 9 * 1024 * 1024 }),
		(error) => error instanceof AgentAvatarError && error.code === "size",
	);
	await assert.rejects(
		() => downscaleAgentAvatar({ type: "image/png", size: 0 }),
		(error) => error instanceof AgentAvatarError && error.code === "decode",
	);
});

test("the hook repaints a row when its agent's picture is stored", async () => {
	const { useAgentAvatar, setAgentAvatar, clearAgentAvatar } = await import(
		`${storeUrl}?mount=1`
	);
	const Probe = ({ agentId }) => {
		const picture = useAgentAvatar(agentId);
		return React.createElement(
			"div",
			{ id: "probe" },
			picture === null ? "fallback" : "picture",
		);
	};
	const root = createRoot(document.getElementById("root"));
	await act(() => root.render(React.createElement(Probe, { agentId: "a1" })));
	const read = () => document.getElementById("probe").textContent;

	assert.equal(read(), "fallback");
	await act(() => setAgentAvatar("a1", WEBP));
	assert.equal(read(), "picture");
	/* Another agent's picture is not this row's. */
	await act(() => setAgentAvatar("a2", WEBP));
	assert.equal(read(), "picture");
	await act(() => clearAgentAvatar("a1"));
	assert.equal(read(), "fallback");
	await act(() => root.unmount());
});

test("a picture survives persistence and a tampered blob is dropped on hydrate", async () => {
	const { setAgentAvatar } = await import(`${storeUrl}?mount=2`);
	await act(() => setAgentAvatar("kept", WEBP));
	const raw = JSON.parse(localStorage.getItem("agent-avatar-storage"));
	assert.equal(raw.state.images.kept, WEBP);

	/* A hand-edited profile: one real picture and one value no reader will paint. */
	localStorage.setItem(
		"agent-avatar-storage",
		JSON.stringify({
			state: {
				images: {
					kept: WEBP,
					"script-injection": "javascript:alert(1)",
				},
			},
			version: 0,
		}),
	);
	const fresh = await import(`${storeUrl}?hydrate=1`);
	assert.deepEqual(Object.keys(fresh.useAgentAvatarStore.getState().images), [
		"kept",
	]);
});

/*
 * THE THREE PROPERTIES THAT NO TEST PINNED (review round 1, R1-2). Each of these
 * fails under the mutation the reviewer named, and each is written so the
 * mutation is the only way it can fail: the write-path filter, the per-entry
 * ceiling, and a selector that subscribes to one agent rather than the map.
 */
test("the write path refuses a value the hydrate would drop", async () => {
	const { setAgentAvatar, useAgentAvatarStore } = await import(
		`${storeUrl}?write-guard=1`
	);
	await act(() => {
		setAgentAvatar("bad-scheme", "javascript:alert(1)");
	});
	assert.equal(
		useAgentAvatarStore.getState().images["bad-scheme"],
		undefined,
		"a script URL must not reach the store from the write either",
	);
	/* And a real picture still lands, so the assertion above is not passing by
	 * refusing everything. */
	await act(() => {
		setAgentAvatar("good-scheme", WEBP);
	});
	assert.equal(useAgentAvatarStore.getState().images["good-scheme"], WEBP);
});

test("an entry over the per-picture ceiling is dropped", () => {
	const oversize = `data:image/webp;base64,${"A".repeat(
		AGENT_AVATAR_MAX_DATA_URL_CHARS,
	)}`;
	assert.ok(oversize.length > AGENT_AVATAR_MAX_DATA_URL_CHARS);
	assert.deepEqual(
		sanitizeAvatarImages({ a1: oversize }),
		{},
		"one entry may not cost more than the per-picture ceiling",
	);
});

test("the profile budget keeps the newest pictures and drops the oldest", () => {
	const entry = `data:image/webp;base64,${"A".repeat(390_000)}`;
	const many = {};
	for (let index = 0; index < 12; index++) many[`big-${index}`] = entry;
	const capped = sanitizeAvatarImages(many);
	const fits = Math.floor(AGENT_AVATAR_MAX_TOTAL_CHARS / entry.length);
	assert.equal(Object.keys(capped).length, fits);
	assert.equal(capped["big-0"], undefined, "the oldest entry goes first");
	assert.equal(capped["big-11"], entry, "the newest entry stays");
	let total = 0;
	for (const value of Object.values(capped)) total += value.length;
	assert.ok(total <= AGENT_AVATAR_MAX_TOTAL_CHARS);
});

test("a row subscribes to its own agent, not the whole map", async () => {
	const { useAgentAvatar, setAgentAvatar } = await import(
		`${storeUrl}?render-count=1`
	);
	let renders = 0;
	const Probe = ({ agentId }) => {
		useAgentAvatar(agentId);
		renders += 1;
		return React.createElement("div");
	};
	const host = document.createElement("div");
	document.getElementById("root").appendChild(host);
	const root = createRoot(host);
	await act(() =>
		root.render(React.createElement(Probe, { agentId: "count-a1" })),
	);
	await act(() => {
		setAgentAvatar("count-a1", WEBP);
	});
	const settled = renders;
	await act(() => {
		setAgentAvatar("count-a2", WEBP);
	});
	assert.equal(
		renders,
		settled,
		"another agent's picture must not repaint this row",
	);
	await act(() => root.unmount());
	host.remove();
});

test("a full store keeps the picture in memory and reports the write", async () => {
	const { setAgentAvatar, clearAgentAvatar, useAgentAvatarStore } =
		await import(`${storeUrl}?quota=1`);
	const storage = dom.window.Storage.prototype;
	const original = storage.setItem;
	storage.setItem = () => {
		throw new dom.window.DOMException("quota", "QuotaExceededError");
	};
	try {
		let saved;
		await act(() => {
			saved = setAgentAvatar("quota-agent", WEBP);
		});
		assert.equal(saved, false, "the field must hear that the write failed");
		assert.equal(
			useAgentAvatarStore.getState().images["quota-agent"],
			WEBP,
			"the picture is visible until a reload, so it stays in memory",
		);
		let cleared;
		await act(() => {
			cleared = clearAgentAvatar("quota-agent");
		});
		assert.equal(cleared, false);
		assert.equal(
			useAgentAvatarStore.getState().images["quota-agent"],
			undefined,
			"Remove must still work with a full store",
		);
	} finally {
		storage.setItem = original;
	}
});

/* ------------------------------------------------------------------ *
 * THE DECODED PATH (review round 2, R2-1; QA round 2, Q2-1)
 *
 * The reason this section exists: round 1 shipped a pre-decode guard that
 * asked `ImageDecoder`'s `ImageTrack` for `codedWidth`/`codedHeight`, which
 * that interface does not have. Every real image was refused as undecodable,
 * and no test noticed because Node has no `ImageDecoder` and the suite only
 * pinned the pure rules. The stubs below are the runtime the browser actually
 * offers - a track with no size fields - and the canvas is the smallest fake
 * that lets the real `downscaleAgentAvatar` run end to end.
 * ------------------------------------------------------------------ */

/**
 * A canvas stand-in: the pipeline only reads a 2d context and the data URL it
 * exports, so the drawing itself need not be real here. The real Electron
 * renderer is where the pixels are proven (`rig/downscale-proof.mjs`).
 */
const stubCanvas = () => ({
	width: 0,
	height: 0,
	getContext: () => ({
		imageSmoothingEnabled: false,
		imageSmoothingQuality: "low",
		drawImage: () => undefined,
	}),
	toDataURL: () => "data:image/webp;base64,AAAA",
});

const withBrowserStubs = async (track, bitmap, run) => {
	const originalCreate = document.createElement;
	const calls = { decoded: 0, decoderClosed: 0, bitmapClosed: 0 };
	class StubImageDecoder {
		constructor() {
			this.tracks = {
				ready: Promise.resolve(),
				selectedTrack: track,
			};
		}

		close() {
			calls.decoderClosed += 1;
		}
	}
	globalThis.ImageDecoder = StubImageDecoder;
	globalThis.createImageBitmap = async () => {
		calls.decoded += 1;
		return {
			width: bitmap.width,
			height: bitmap.height,
			close: () => {
				calls.bitmapClosed += 1;
			},
		};
	};
	document.createElement = (tag) =>
		tag === "canvas" ? stubCanvas() : originalCreate.call(document, tag);
	try {
		return await run(calls);
	} finally {
		document.createElement = originalCreate;
		Reflect.deleteProperty(globalThis, "ImageDecoder");
		Reflect.deleteProperty(globalThis, "createImageBitmap");
	}
};

const pngFile = (bytes = 1) => ({
	type: "image/png",
	size: bytes,
	arrayBuffer: async () => new ArrayBuffer(bytes),
});

test("a track with no coded size is no answer, not a refusal (R2-1)", async () => {
	await withBrowserStubs({}, { width: 800, height: 600 }, async (calls) => {
		const dataUrl = await downscaleAgentAvatar({
			type: "image/png",
			size: 8611,
			arrayBuffer: async () => new ArrayBuffer(8611),
		});
		assert.equal(dataUrl, "data:image/webp;base64,AAAA");
		assert.equal(calls.decoded, 1, "the bitmap is the decoder that decides");
		assert.equal(calls.bitmapClosed, 1, "the decoded bitmap is closed");
	});
});

test("a track whose coded size is not finite is no answer either", async () => {
	for (const track of [
		{ codedWidth: undefined, codedHeight: undefined },
		{ codedWidth: Number.NaN, codedHeight: 600 },
		{ codedWidth: 800 },
	]) {
		await withBrowserStubs(track, { width: 800, height: 600 }, async () => {
			const dataUrl = await downscaleAgentAvatar(pngFile());
			assert.equal(dataUrl, "data:image/webp;base64,AAAA");
		});
	}
});

test("a decoded bitmap past the megapixel bound is refused and closed", async () => {
	await withBrowserStubs({}, { width: 9000, height: 8000 }, async (calls) => {
		await assert.rejects(
			() => downscaleAgentAvatar(pngFile()),
			(error) => error instanceof AgentAvatarError && error.code === "decode",
		);
		assert.equal(calls.decoded, 1);
		assert.equal(
			calls.bitmapClosed,
			1,
			"the refused bitmap does not stay allocated",
		);
	});
});

test("a track that states an over-cap size refuses before the bitmap exists", async () => {
	await withBrowserStubs(
		{ codedWidth: 9000, codedHeight: 8000 },
		{ width: 800, height: 600 },
		async (calls) => {
			await assert.rejects(
				() => downscaleAgentAvatar(pngFile()),
				(error) => error instanceof AgentAvatarError && error.code === "decode",
			);
			assert.equal(
				calls.decoded,
				0,
				"the early exit is taken when a size exists",
			);
			assert.equal(calls.decoderClosed, 1, "the decoder itself is closed");
		},
	);
});

/* ------------------------------------------------------------------ *
 * THE TRIM PRESERVES ORDER (review round 2, R2-2)
 * ------------------------------------------------------------------ */

test("the trim keeps the input's oldest-first order", () => {
	const many = {};
	for (let index = 0; index < AGENT_AVATAR_LIMIT + 3; index++) {
		many[`agent-${index}`] = WEBP;
	}
	const once = sanitizeAvatarImages(many);
	const twice = sanitizeAvatarImages(once);
	assert.deepEqual(Object.keys(once), Object.keys(twice));
	assert.equal(
		Object.keys(once)[0],
		"agent-3",
		"the oldest surviving key stays first",
	);
	assert.equal(
		Object.keys(once).at(-1),
		`agent-${AGENT_AVATAR_LIMIT + 2}`,
		"the newest key stays last",
	);
});

test("seventy writes keep the newest sixty-four pictures", async () => {
	const { setAgentAvatar, useAgentAvatarStore } = await import(
		`${storeUrl}?sequence=1`
	);
	const ids = [];
	for (let index = 0; index < 70; index++) {
		const id = `seq-${index}`;
		ids.push(id);
		await act(() => {
			setAgentAvatar(id, WEBP);
		});
	}
	const images = useAgentAvatarStore.getState().images;
	assert.deepEqual(
		Object.keys(images),
		ids.slice(-AGENT_AVATAR_LIMIT),
		"the survivors are the newest 64, in write order - the 65th write may not drop the 64th",
	);
	/* A re-upload is the newest, not its first-written position. */
	await act(() => {
		setAgentAvatar("seq-10", WEBP);
	});
	const after = useAgentAvatarStore.getState().images;
	assert.equal(
		Object.keys(after).at(-1),
		"seq-10",
		"replacing a picture moves its key to the newest slot",
	);
	assert.equal(Object.keys(after).length, AGENT_AVATAR_LIMIT);
	assert.equal(
		after["seq-6"],
		WEBP,
		"a re-upload of an existing key adds no entry, so nothing is evicted",
	);
});
