import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
// TypeScript ships CJS with a `default` export under this Node's interop, so the
// compiler API is reached through it rather than through the namespace.
import tsModule from "typescript";

const ts = tsModule.default ?? tsModule;

/*
 * Q-1: the published types and the running preload must name the SAME path.
 *
 * The defect this file exists for: the preload exposed `api.desktop.linkPreview`
 * while `src/preload/index.d.ts` declared `api.linkPreview` and `DesktopAPI` knew
 * nothing about it. A renderer following the types got `undefined.resolve`; the
 * path that actually works did not type-check. Nothing caught it, because no gate
 * ever compared the ambient declaration with the implementation — `check-types`
 * type-checks them separately and both were internally consistent.
 *
 * SO THIS FILE ASSERTS THE PATH, FROM BOTH SIDES, AT THE SAME TIME:
 *
 *  - RUNTIME: the real `src/preload/index.ts`, bundled and loaded against a stub
 *    `electron`, is inspected at exactly the path the declaration names. Loading
 *    the shipped file rather than grepping it is the point: a rename that lands in
 *    one place and not the other is the failure mode.
 *  - TYPES: the two source files are parsed with TypeScript's own parser, so the
 *    assertion is about the DECLARED SHAPE (`Window.api` has `desktop: DesktopAPI`;
 *    `DesktopAPI` has `linkPreview` with `resolve`/`artifact`) rather than about a
 *    substring somebody could satisfy with a comment.
 *
 * A third side is the contract's channel names: the call must reach the channel the
 * IPC layer registers, so a renderer that gets bytes back is talking to the handler
 * this PR installed.
 */

const ROOT = process.cwd();

/* ------------------------------------------------------------------ runtime */

const invokes = [];
const ipcRenderer = {
	invoke: async (channel, ...args) => {
		invokes.push({ channel, args });
		return { kind: "absent", reason: "no-metadata" };
	},
	on: () => {},
	removeListener: () => {},
	send: () => {},
	sendSync: () => undefined,
	invokeSync: () => undefined,
};

globalThis.__loLinkPreviewIpcRenderer = ipcRenderer;
// The branch the app actually takes; the other one writes to a global `window`,
// which a node process does not have.
process.contextIsolated = true;

const cacheRoot = await mkdtemp(join(tmpdir(), "lp-preload-"));
const bundlePath = join(cacheRoot, "preload.bundle.mjs");
const bundle = await build({
	stdin: {
		contents: 'import "./src/preload/index";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "electron-fixture",
			setup(builder) {
				builder.onResolve({ filter: /^electron$/ }, (args) => ({
					path: args.path,
					namespace: "fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					loader: "js",
					contents: `
						export const ipcRenderer = globalThis.__loLinkPreviewIpcRenderer;
						export const contextBridge = {
							exposeInMainWorld: (key, value) => {
								globalThis.__loLinkPreviewExposed ??= {};
								globalThis.__loLinkPreviewExposed[key] = value;
							},
						};
						export const webFrame = {
							insertCSS: () => "",
							removeInsertedCSS: () => {},
							setZoomFactor: () => {},
							setVisualZoomLevelLimits: async () => {},
						};
						export const webUtils = { getPathForFile: () => "" };
						export default { ipcRenderer, contextBridge, webFrame, webUtils };
					`,
				}));
			},
		},
	],
});
writeFileSync(bundlePath, bundle.outputFiles[0].text);
await import(`${bundlePath}?v=${Date.now()}`);

const api = globalThis.__loLinkPreviewExposed?.api;
assert.ok(api?.desktop, "the preload must expose `api.desktop`");

test("the preload exposes link previews at the path the declaration names", async () => {
	// `api.desktop.linkPreview` — beside `teamBridge`, which is the convention every
	// other main-owned surface follows. This is the assertion Q-1 asked for: the
	// path, not a substring.
	const bridge = api.desktop.linkPreview;
	assert.ok(bridge, "api.desktop.linkPreview must exist");
	assert.equal(typeof bridge.resolve, "function");
	assert.equal(typeof bridge.artifact, "function");
	// And NOT the path the first cut declared. A renderer that read the old types
	// called this and got a TypeError.
	assert.equal(
		api.linkPreview,
		undefined,
		"link previews are not a top-level api member",
	);
});

test("both calls reach the channels the IPC layer registers", async () => {
	await api.desktop.linkPreview.resolve({
		url: "https://example.test/a",
		index: 0,
		expectedAccountId: "acc_TEST",
	});
	assert.deepEqual(invokes.at(-1), {
		channel: "link-preview:resolve",
		args: [
			{
				url: "https://example.test/a",
				index: 0,
				expectedAccountId: "acc_TEST",
			},
		],
	});
	await api.desktop.linkPreview.artifact({
		id: "0".repeat(32),
		expectedAccountId: "acc_TEST",
	});
	assert.equal(invokes.at(-1).channel, "link-preview:artifact");
});

/* -------------------------------------------------------------------- types */

/*
 * The DECLARED surface, checked by the compiler rather than by a substring.
 *
 * TypeScript 7.0.2 is the native port: it ships `lib/tsc.js`, no JS compiler API,
 * so the declaration cannot be walked as an AST from here. What CAN be done is the
 * authoritative thing anyway — compile a probe that names the exact path and let
 * `tsc` answer. The probe is generated into `scripts/` (one level under the repo
 * root, so `../src/...` resolves the way the real sources do) and removed in
 * `finally`.
 *
 * The probe fails in all three ways this defect can come back:
 *   * `Window["api"]["desktop"]["linkPreview"]` missing  -> TS2339;
 *   * `DesktopAPI["linkPreview"]` missing                -> TS2339;
 *   * a top-level `api.linkPreview` reintroduced         -> the `@ts-expect-error`
 *     becomes unused, which is itself an error (TS2578).
 * All three were confirmed by injecting each defect and watching this command fail.
 *
 * The flags are explicit because a tsconfig on the path would otherwise decide the
 * compilation: `--ignoreConfig` (the file is passed on the command line), `strict`
 * so a `?`-optional member is really optional, `skipLibCheck` because this check is
 * about OUR two declarations, not about electron's .d.ts. If a future toolchain
 * drops `--ignoreConfig` this test fails loudly on the unknown-option error rather
 * than passing silently.
 *
 * It costs ~10 s, because a compiler run is the only instrument that answers the
 * question. That is slower than the rest of this suite and still cheaper than the
 * defect: a renderer following the published types got `undefined.resolve`.
 */
const PROBE = `
/// <reference path="../src/preload/index.d.ts" />
import type { DesktopAPI } from "../src/shared/desktop-contract";

type DesktopSurface = NonNullable<Window["api"]["desktop"]["linkPreview"]>;
type ContractSurface = NonNullable<DesktopAPI["linkPreview"]>;

declare const surface: DesktopSurface;
declare const contract: ContractSurface;
export const calls: {
	resolve: typeof surface.resolve;
	artifact: typeof surface.artifact;
	contractResolve: typeof contract.resolve;
	contractArtifact: typeof contract.artifact;
} = {
	resolve: surface.resolve,
	artifact: surface.artifact,
	contractResolve: contract.resolve,
	contractArtifact: contract.artifact,
};

// @ts-expect-error Q-1: link previews are NOT a top-level api member.
export type NotTopLevel = Window["api"]["linkPreview"];
`;

test("the declared types name the path the preload exposes", async () => {
	const { spawnSync } = await import("node:child_process");
	const { unlinkSync, writeFileSync } = await import("node:fs");
	const probePath = join(
		ROOT,
		"scripts",
		`.link-preview-api-probe.${process.pid}.ts`,
	);
	writeFileSync(probePath, PROBE);
	try {
		const result = spawnSync(
			join(ROOT, "node_modules", ".bin", "tsc"),
			[
				"--ignoreConfig",
				"--noEmit",
				"--skipLibCheck",
				"--strict",
				"--target",
				"es2022",
				"--module",
				"esnext",
				"--moduleResolution",
				"bundler",
				probePath,
			],
			{
				cwd: ROOT,
				encoding: "utf8",
				env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=1024" },
			},
		);
		assert.equal(
			result.status,
			0,
			`the declared api surface and the preload disagree:\n${result.stdout}${result.stderr}`,
		);
	} finally {
		unlinkSync(probePath);
	}
});

test("the declared channel names are the ones the preload invokes", async () => {
	// Read from the shared contract, so a renamed channel cannot pass by appearing
	// in both the preload and main while the renderer's declaration says otherwise.
	const contract = await build({
		stdin: {
			contents:
				"export { LINK_PREVIEW_RESOLVE_CHANNEL, LINK_PREVIEW_ARTIFACT_CHANNEL } from './src/shared/link-preview';",
			resolveDir: ROOT,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const { LINK_PREVIEW_RESOLVE_CHANNEL, LINK_PREVIEW_ARTIFACT_CHANNEL } =
		await import(
			`data:text/javascript;base64,${Buffer.from(
				contract.outputFiles[0].text,
			).toString("base64")}`
		);
	invokes.length = 0;
	await api.desktop.linkPreview.resolve({
		url: "https://example.test/a",
		index: 0,
		expectedAccountId: "acc_TEST",
	});
	await api.desktop.linkPreview.artifact({
		id: "0".repeat(32),
		expectedAccountId: "acc_TEST",
	});
	assert.deepEqual(
		invokes.map((entry) => entry.channel),
		[LINK_PREVIEW_RESOLVE_CHANNEL, LINK_PREVIEW_ARTIFACT_CHANNEL],
	);
});
