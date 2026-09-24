import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE PANEL THAT COMES BACK AFTER A SUCCESS, RENDERED — because that is the only
 * thing that could have caught this.
 *
 * `sign-in-sessions.ts` keeps a settled state outside the panel precisely so the
 * row's move into "Connected" cannot destroy it. The panel then threw it away
 * anyway: `useEffect(() => { flowHandle.reset(); … }, [provider.id])` runs on
 * every MOUNT, and the row's move remounts it, so the receipt rendered for 39-270
 * ms and vanished (QA round 2 R2-Q1, UX round 2 U3, both reproduced by deleting
 * only the `reset()` line). Every test this file's siblings held passed, because
 * they assert the SESSION's rules and never render the component that consults
 * them — the gap the whole file exists to close.
 *
 * What it pins:
 *   1. after a completed sign-in the panel shows the success state, and
 *   2. it STILL shows it after a remount with the same provider (the row move),
 *   3. while a mount with a DIFFERENT provider still starts clean — the reset the
 *      effect was written for is kept, not deleted.
 *
 * What it cannot claim: jsdom has no layout engine, so "the receipt is on screen"
 * is the component's own contract (`data-sign-in-state="succeeded"`), not geometry.
 * Pixels live in the committed Storybook frames.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it, and promote the window's own constructors: jsdom's window is
// the DOM, but it is not the global environment the bundled component runs in.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>");
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors that refuse to be read out of context; the constructors the
		// components need are plain ones and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The bridge, scripted the way the released backend answers: `auth.start` returns
 * `starting` with no URL, the first poll carries the URL, the second reports the
 * credential. That is the shape the first-click defect lived on, so the flow this
 * test drives is the shipped one, not a shortcut.
 */
const AUTH_URL = "https://claude.ai/oauth/authorize?state=remount";
const opened = [];
let polls = 0;
const snapshot = (state, extra = {}) => ({
	id: "op-1",
	provider: "anthropic",
	state,
	message: "",
	auth_url: null,
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 540,
	...extra,
});

const CENSUS = JSON.parse(
	readFileSync("scripts/fixtures/auth-providers-first-run.json", "utf8"),
).providers;

let currentProvider = "anthropic";
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			const ok = (result) => ({ status: 200, body: { result } });
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						data: { auth: true, config: true, catalogue: false },
					});
				case "providers.list":
					return ok({ providers: CENSUS });
				case "config.get":
					return ok({ hosting: null, model: null, api_key_present: false });
				case "auth.start":
					return ok(snapshot("starting"));
				case "auth.status":
					polls += 1;
					if (polls === 1) {
						return ok(snapshot("waiting", { auth_url: AUTH_URL }));
					}
					return ok(
						snapshot("succeeded", {
							message: "Signed in.",
							defaults_applied: {
								hosting: currentProvider,
								model: "claude-opus-5-5",
								model_name: "Claude Opus 5.5",
								receipt: "Set default hosting and model.",
							},
						}),
					);
				case "auth.cancel":
					return ok(snapshot("cancelled", { message: "Sign-in cancelled." }));
				case "auth.open":
					opened.push(request);
					return ok({ opened: true, reopen: Boolean(request.reopen) });
				default:
					return ok(null);
			}
		},
		openAuthorization: async (payload) => {
			opened.push(payload);
			return { opened: true };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ProviderDetail } from "./src/renderer/src/features/providers/provider-detail";
			export { resetSignInSessions } from "./src/renderer/src/features/providers/sign-in-sessions";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * `ProviderDetail` now reaches the config module (it may write a default the
	 * backend did not), which reads `import.meta.env` at MODULE LOAD -- and Vite is
	 * not the bundler here, so an undefined `import.meta.env` throws before any
	 * assertion runs. An empty object is what a browser build without any VITE_*
	 * value looks like.
	 */
	define: { "import.meta.env": "{}" },
	write: false,
});

const bundlePath = new URL(
	"./_provider-detail-remount.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	ProviderDetail,
	resetSignInSessions,
} = await import(bundlePath.href);

const rowFor = (id) => CENSUS.find((row) => row.id === id);

const mount = async (t) => {
	/*
	 * The tree is allocated FIRST and the teardown registered after it, because the
	 * callback below closes over `mounted`: registering a teardown that dereferences
	 * a binding which does not exist yet turns any early throw into a second error
	 * inside the cleanup, and a mounted tree that is never unmounted keeps the event
	 * loop open -- the hang this repository's rendered-surface tests all guard
	 * against (see `backend-settings-collapse.test.mjs`).
	 */
	const mounted = {
		client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	};
	t.after(() => {
		try {
			mounted.root?.unmount();
		} finally {
			mounted.container?.remove();
			mounted.client?.clear();
			resetSignInSessions();
		}
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	mounted.render = async (id, key) => {
		await act(async () => {
			mounted.root.render(
				createElement(
					QueryClientProvider,
					{ client: mounted.client },
					createElement(ProviderDetail, { key, provider: rowFor(id) }),
				),
			);
		});
	};
	mounted.find = (selector) => mounted.container.querySelector(selector);
	mounted.text = () => mounted.container.textContent ?? "";
	return mounted;
};

/** Poll the DOM, because the flow settles on a real 1.5 s timer. */
const waitFor = async (predicate, what, timeout = 15000) => {
	const started = Date.now();
	for (;;) {
		if (predicate()) return;
		if (Date.now() - started > timeout) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
	}
};

const clickButton = async (root, name) => {
	const button = [...root.container.querySelectorAll("button")].find(
		(candidate) => (candidate.textContent ?? "").includes(name),
	);
	assert.ok(button, `the "${name}" control must be rendered`);
	await act(async () => {
		button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
};

test("a completed sign-in survives the remount the row move causes", async (t) => {
	polls = 0;
	currentProvider = "anthropic";
	const mounted = await mount(t);

	await mounted.render("anthropic", "row-1");
	assert.ok(
		mounted.find('[data-sign-in-state="idle"]'),
		"a fresh panel starts idle",
	);
	await clickButton(mounted, "Continue in browser");
	await waitFor(
		() => mounted.find('[data-sign-in-state="succeeded"]'),
		"the success state",
	);

	/*
	 * THE ROW MOVE. The provider leaves "Add a provider" and is re-rendered inside
	 * "Connected", which is a different list item: React unmounts this panel and
	 * mounts a new one under a new key. With the mount-time `reset()` back in, this
	 * is the assertion that fails -- the panel comes back idle and invites a second
	 * sign-in.
	 */
	await mounted.render("anthropic", "row-2");
	assert.ok(
		mounted.find('[data-sign-in-state="succeeded"]'),
		"the receipt must still be on screen after the row moves",
	);
	assert.match(
		mounted.text(),
		/Claude Opus 5\.5/,
		"and it must still name the default model the backend applied",
	);
});

test("a panel reused for ANOTHER provider still starts clean", async (t) => {
	polls = 0;
	currentProvider = "anthropic";
	const mounted = await mount(t);

	await mounted.render("anthropic", "row-1");
	await clickButton(mounted, "Continue in browser");
	await waitFor(
		() => mounted.find('[data-sign-in-state="succeeded"]'),
		"the success state",
	);

	/*
	 * The reset the effect was written for is kept: this is a different provider, so
	 * the panel must NOT show the previous one's receipt. Deleting the reset entirely
	 * -- the tempting over-fix -- fails here, which is the point of the case.
	 */
	currentProvider = "openai";
	await mounted.render("openai", "row-3");
	assert.ok(
		!mounted.find('[data-sign-in-state="succeeded"]'),
		"another provider's panel must not inherit a receipt",
	);
	assert.ok(
		mounted.find('[data-sign-in-state="idle"]'),
		"it starts in the idle view",
	);
});
