/**
 * A picture write holds the slot's `writing` flag until the readers re-read, and
 * a hung re-read cannot hold it for good (agent review m-2 and its reviewer
 * follow-up).
 *
 * WHAT IS REAL: `setAgentAvatar` and `useAgentAvatarWriting` from
 * `agent-avatar.ts`, in jsdom with React's own scheduler. WHAT IS STUBBED, and
 * why: the four things a Node test cannot have - the media relay (a write that
 * succeeds on demand), the agents query client and the session catalogue (both
 * `invalidate`/`fetch` calls that NEVER settle, which is the case under test),
 * and the desktop control response. Time is `node:test`'s mock clock, so the 5s
 * cap is asserted at 4999ms and 5000ms rather than waited for.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	for (const name of ["window", "document", "localStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

/* The stubs share one object on `globalThis` so each test can steer them. */
const STUBS = {
	"@shared/api/local-operator/desktop-api": `
		export const desktopMedia = (...args) => globalThis.__avatarStub.media(...args);
		export const desktopControlResponse = async () => ({ ok: false, status: 500 });
		export const mediaError = (result) => new Error(String(result?.detail ?? "media error"));
	`,
	"@shared/api/query-client": `
		export const queryClient = {
			invalidateQueries: () => globalThis.__avatarStub.invalidate(),
			setQueryData: () => undefined,
		};
	`,
	"@shared/store/canonical-sessions-store": `
		export const useCanonicalSessionsStore = {
			getState: () => ({ fetchSessions: () => globalThis.__avatarStub.fetchSessions() }),
		};
	`,
};
const result = await build({
	stdin: {
		contents:
			'export { setAgentAvatar, clearAgentAvatar, useAgentAvatarWriting } from "./src/renderer/src/shared/agent-avatar/agent-avatar";',
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "{}" },
	plugins: [
		{
			name: "stubs",
			setup(builder) {
				builder.onResolve({ filter: /^@shared\// }, (args) =>
					STUBS[args.path] ? { path: args.path, namespace: "stub" } : null,
				);
				builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
					contents: STUBS[args.path],
					loader: "js",
				}));
				builder.onResolve({ filter: /^[^./@]|^@tanstack/ }, (args) =>
					/^(react|react-dom)(\/.*)?$|^@tanstack\//.test(args.path)
						? { path: args.path, external: true }
						: null,
				);
			},
		},
	],
	alias: { "@shared": resolve(ROOT, "src/renderer/src/shared") },
	write: false,
});
const cache = join(ROOT, "node_modules", ".cache", "agent-avatar-write-hold");
mkdirSync(cache, { recursive: true });
const bundlePath = join(cache, `bundle-${process.pid}.mjs`);
writeFileSync(bundlePath, result.outputFiles[0].text);
const { setAgentAvatar, clearAgentAvatar, useAgentAvatarWriting } =
	await import(pathToFileURL(bundlePath).href);

const hung = () => new Promise(() => {});
const okMedia = async () => ({
	status: 200,
	kind: "json",
	body: { avatar: null },
});
const image = new Blob([new Uint8Array([1, 2, 3])]);

/** Mounts a probe that records what the hook reads on every render. */
async function mountProbe(agentId) {
	const seen = [];
	const Probe = () => {
		const writing = useAgentAvatarWriting(agentId);
		seen.push(writing);
		return null;
	};
	const root = createRoot(document.getElementById("root"));
	await act(async () => root.render(React.createElement(Probe)));
	return { seen, root, last: () => seen[seen.length - 1] };
}

test("a hung refresh drops `writing` at the 5s cap, not before", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		globalThis.__avatarStub = {
			media: okMedia,
			invalidate: hung,
			fetchSessions: hung,
		};
		const probe = await mountProbe("agent-hold");
		assert.equal(probe.last(), false, "idle before the write");
		await act(async () => {
			await setAgentAvatar("agent-hold", image);
		});
		assert.equal(
			probe.last(),
			true,
			"the bytes were accepted but the readers have not re-read: still busy",
		);
		await act(async () => mock.timers.tick(4999));
		assert.equal(probe.last(), true, "one millisecond short of the cap");
		await act(async () => mock.timers.tick(1));
		assert.equal(probe.last(), false, "the cap released it");
		await act(async () => probe.root.unmount());
	} finally {
		mock.timers.reset();
	}
});

test("a refresh that lands releases at once and leaves no timer behind", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	const cleared = [];
	const realClear = globalThis.clearTimeout;
	globalThis.clearTimeout = (id) => {
		cleared.push(id);
		return realClear(id);
	};
	try {
		let land;
		const landing = new Promise((resolve) => {
			land = resolve;
		});
		globalThis.__avatarStub = {
			media: okMedia,
			invalidate: () => landing,
			fetchSessions: () => landing,
		};
		const probe = await mountProbe("agent-land");
		await act(async () => {
			await setAgentAvatar("agent-land", image);
		});
		assert.equal(probe.last(), true, "busy until the readers land");
		await act(async () => {
			land();
			await landing;
		});
		assert.equal(probe.last(), false, "released the moment they landed");
		assert.ok(
			cleared.length >= 1,
			"the cap's timer was cleared, not left armed",
		);
		/* Ticking past the cap changes nothing: there is no timer left to fire. */
		await act(async () => mock.timers.tick(10_000));
		assert.equal(probe.last(), false);
		await act(async () => probe.root.unmount());
	} finally {
		globalThis.clearTimeout = realClear;
		mock.timers.reset();
	}
});

test("a refused write releases at once: nothing is coming to wait for", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		globalThis.__avatarStub = {
			media: async () => ({ status: 413, kind: "error", detail: "too_large" }),
			invalidate: hung,
			fetchSessions: hung,
		};
		const probe = await mountProbe("agent-refused");
		await act(async () => {
			await assert.rejects(setAgentAvatar("agent-refused", image), /too_large/);
		});
		assert.equal(probe.last(), false);
		await act(async () => probe.root.unmount());
	} finally {
		mock.timers.reset();
	}
});

test("clearing holds the same way, and an unmounted probe is not updated", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	const errors = [];
	const realError = console.error;
	console.error = (...args) => errors.push(args.join(" "));
	try {
		globalThis.__avatarStub = {
			media: async () => ({ status: 204, kind: "json", body: null }),
			invalidate: hung,
			fetchSessions: hung,
		};
		const probe = await mountProbe("agent-clear");
		await act(async () => {
			await clearAgentAvatar("agent-clear");
		});
		assert.equal(probe.last(), true, "held through the refresh");
		/* Unmount while the hold is still up: the cap firing later must not touch it. */
		await act(async () => probe.root.unmount());
		const rendersAtUnmount = probe.seen.length;
		await act(async () => mock.timers.tick(5000));
		assert.equal(
			probe.seen.length,
			rendersAtUnmount,
			"no render after unmount",
		);
		assert.deepEqual(errors, [], "no update-on-unmounted warning");
	} finally {
		console.error = realError;
		mock.timers.reset();
	}
});
