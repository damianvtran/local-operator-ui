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
import { mkdir, unlink, writeFile } from "node:fs/promises";
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
	AGENT_AVATAR_MIME_TYPES,
	avatarFileRejection,
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
		"size",
		"an empty file is refused rather than decoded",
	);
	assert.equal(
		avatarFileRejection({ type: "image/png", size: 9 * 1024 * 1024 }),
		"size",
	);
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
