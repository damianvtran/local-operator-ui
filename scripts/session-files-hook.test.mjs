/** Real hook regression controls; only its IPC/authority edges are substituted. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
const state = { request: null, capable: true };
globalThis.__filesHookControl = state;
const { outputFiles } = await build({
	entryPoints: [
		"src/renderer/src/features/chat/canonical/use-session-files.ts",
	],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["react"],
	alias: { "@features": "./src/renderer/src/features" },
	plugins: [
		{
			name: "hook-edges",
			setup(builder) {
				// Same harness, old real hook: a discriminating negative control,
				// not a copied publication algorithm or a second dependency tree.
				if (process.env.SESSION_FILES_HOOK_REF)
					builder.onLoad(
						{ filter: /canonical\/use-session-files\.ts$/ },
						({ path }) => ({
							contents: execFileSync(
								"git",
								[
									"show",
									`${process.env.SESSION_FILES_HOOK_REF}:src/renderer/src/features/chat/canonical/use-session-files.ts`,
								],
								{ encoding: "utf8" },
							),
							loader: "ts",
							resolveDir: dirname(resolve(path)),
						}),
					);
				builder.onResolve({ filter: /^@shared\// }, (args) => ({
					path: args.path,
					namespace: "edge",
				}));
				builder.onLoad({ filter: /.*/, namespace: "edge" }, ({ path }) => ({
					contents: path.endsWith("desktop-api")
						? "export const desktopRequest = req => globalThis.__filesHookControl.request(req);"
						: path.endsWith("desktop-hooks")
							? "export const useDesktopCapabilities = () => ({data:{features:{session_files:globalThis.__filesHookControl.capable ? 1 : 0}}}); export const desktopFeatureEnabled = data => data.features.session_files === 1;"
							: "export const remoteOwnedId = () => false; export const useCanonicalSessionsStore = selector => selector({sessions:[],placementFacts:{}});",
					loader: "js",
				}));
			},
		},
	],
});
// The temporary module lives under scripts so its external React resolves the
// repo's shared dependency tree, never a second install in a scratch directory.
import { unlinkSync, writeFileSync } from "node:fs";
const modulePath = new URL(`./_files-hook-${process.pid}.mjs`, import.meta.url);
writeFileSync(modulePath, outputFiles[0].text);
const { useSessionFiles } = await import(modulePath.href);
unlinkSync(modulePath);
const row = (i) => ({
	id: String(i),
	ref: { type: "path", path: `/synthetic/${i}.txt` },
	name: `${i}.txt`,
});
const page = (revision, count, status = "ready") => ({
	status: 200,
	body: {
		result: {
			state: status,
			revision,
			total: count,
			rows: Array.from({ length: count }, (_, i) => row(i)),
			next_cursor: null,
			cursor_reset: false,
			stat_complete: true,
			scan: { covered_bytes: revision, total_bytes: 10 },
		},
	},
});
async function rig(t) {
	const dom = new JSDOM('<div id="root"></div>');
	const keys = [
		"window",
		"document",
		"HTMLElement",
		"IS_REACT_ACT_ENVIRONMENT",
	];
	const previous = new Map(
		keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
	);
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const root = createRoot(document.getElementById("root"));
	let snapshot;
	const frames = [];
	const observations = [];
	function Host({ sid = "aaaaaaaaaaaa", hint = 0 }) {
		snapshot = useSessionFiles(sid, true, hint);
		frames.push(snapshot.rows.length);
		observations.push({
			state: snapshot.state,
			count: snapshot.rows.length,
			loaded: snapshot.loadedRows,
		});
		return null;
	}
	t.after(() => {
		act(() => root.unmount());
		dom.window.close();
		for (const key of keys) {
			const descriptor = previous.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	});
	const render = (props) =>
		act(() => root.render(React.createElement(Host, props)));
	const until = async (condition) => {
		const deadline = Date.now() + 4000;
		while (!condition() && Date.now() < deadline)
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
			});
		assert.ok(condition(), "hook observation reached within deadline");
	};
	return {
		render,
		until,
		frames,
		observations,
		get snapshot() {
			return snapshot;
		},
	};
}
test("nine advancing building revisions converge without spending cursor reset budget", async (t) => {
	const original = setTimeout;
	// Poll acceleration preserves request ordering and the hook's real cleanup.
	globalThis.setTimeout = (callback, ms, ...args) =>
		original(callback, ms >= 1000 ? 1 : ms, ...args);
	t.after(() => {
		globalThis.setTimeout = original;
	});
	let calls = 0;
	state.request = async () => {
		calls++;
		return page(calls, 3, calls < 10 ? "building" : "ready");
	};
	const host = await rig(t);
	host.render({});
	await host.until(() => host.snapshot.state === "ready");
	assert.equal(calls, 10);
	assert.equal(host.snapshot.error, null);
	assert.equal(host.snapshot.rows.length, 3);
	assert.ok(
		host.observations
			.filter((frame) => frame.state !== "ready")
			.every((frame) => frame.count === 0),
		"building slices must never become rendered membership",
	);
});
test("same-source turn refresh retains three rows until the replacement four are ready", async (t) => {
	let release;
	state.request = async () => page(1, 3);
	const host = await rig(t);
	host.render({ hint: 0 });
	await host.until(() => host.snapshot.state === "ready");
	state.request = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const start = host.frames.length;
	host.render({ hint: 1 });
	assert.equal(host.snapshot.rows.length, 3);
	assert.equal(host.snapshot.state, "loading");
	await act(async () => release(page(2, 4)));
	await host.until(() => host.snapshot.rows.length === 4);
	assert.ok(
		host.frames.slice(start).every((count) => count === 3 || count === 4),
	);
});
test("presentation-only reorder while engaged does not restart the hook inventory", async (t) => {
	let calls = 0;
	state.request = async () => {
		calls++;
		return page(1, 3);
	};
	const host = await rig(t);
	host.render({ sort: "name", pointerEngaged: true });
	await host.until(() => host.snapshot.state === "ready");
	const start = host.frames.length;
	host.render({ sort: "size", pointerEngaged: true });
	assert.equal(calls, 1);
	assert.equal(host.snapshot.rows.length, 3);
	assert.ok(host.frames.slice(start).every((count) => count === 3));
});
test("revision restart clears the seen-cursor set before rereading page one", async (t) => {
	let call = 0;
	state.request = async (request) => {
		call++;
		const result = page(call < 3 ? call : 2, call === 4 ? 2 : 1);
		if (call === 1 || call === 3) result.body.result.next_cursor = "same-next";
		if (call === 2) assert.equal(request.cursor, "same-next");
		if (call === 3) assert.equal(request.cursor, undefined);
		return result;
	};
	const host = await rig(t);
	host.render({});
	await host.until(() => host.snapshot.state === "ready");
	assert.equal(call, 4);
	assert.equal(host.snapshot.error, null);
	assert.equal(host.snapshot.rows.length, 2);
});

test("cold ready pagination publishes no rows before the delayed final page and late Highlight", async (t) => {
	let calls = 0;
	let release;
	state.request = async () => {
		calls++;
		if (calls === 1) {
			const result = page(1, 3);
			result.body.result.next_cursor = "tail";
			result.body.result.total = 4;
			return result;
		}
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const host = await rig(t);
	host.render({});
	await host.until(() => calls === 2);
	assert.equal(
		host.snapshot.rows.length,
		0,
		"first page must not launch thumbnails",
	);
	assert.equal(host.snapshot.loadedRows, 3);
	assert.equal(host.snapshot.pendingTotal, 4);
	const tail = page(1, 0);
	tail.body.result.rows = [{ ...row(3), highlighted: true }];
	tail.body.result.total = 4;
	await act(async () => release(tail));
	await host.until(() => host.snapshot.state === "ready");
	assert.equal(host.snapshot.rows.length, 4);
	assert.equal(host.snapshot.rows[3].highlighted, true);
	assert.ok(host.frames.every((count) => count === 0 || count === 4));
});
test("refresh holds the old complete generation throughout a building slice", async (t) => {
	state.request = async () => page(1, 3);
	const host = await rig(t);
	host.render({ hint: 0 });
	await host.until(() => host.snapshot.state === "ready");
	const old = host.snapshot.rows;
	let calls = 0;
	let release;
	state.request = async () => {
		calls++;
		if (calls === 1) return page(2, 1, "building");
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	host.render({ hint: 1 });
	await host.until(() => host.snapshot.state === "building");
	assert.deepEqual(
		host.snapshot.rows,
		old,
		"partial building pass must not replace a complete generation",
	);
	assert.equal(host.snapshot.loadedRows, 1);
	await host.until(() => Boolean(release));
	await act(async () => release(page(3, 4)));
	await host.until(() => host.snapshot.state === "ready");
	assert.equal(host.snapshot.rows.length, 4);
});

test("capable draft is empty ready and issues no request", async (t) => {
	let calls = 0;
	state.request = async () => {
		calls++;
		return page(1, 1);
	};
	const host = await rig(t);
	host.render({ sid: "" });
	await host.until(() => host.snapshot.state === "ready");
	assert.equal(host.snapshot.rows.length, 0);
	assert.equal(calls, 0);
});
