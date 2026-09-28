import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE ACCOUNT ROW WHEN THE READ FAILS — the placeholder the operator met, and
 * the affordance that replaces it.
 *
 * THE REPORT: after signing in to Radient during setup the rail's foot showed a
 * generic "User" row. The state handling behind that name is three paths and
 * this file renders all three through the SHIPPED component:
 *
 *  - a read that FAILS (refused / unreachable / unknown) must say so and offer
 *    the way back: the second line names "Reconnect Radient" and the row's own
 *    press opens the providers surface with Radient preselected. The row is the
 *    affordance because a link nested in a button is not markup a browser can
 *    resolve, and the foot has no room for a second control;
 *  - a read that has not ANSWERED yet says "Checking account…" and offers
 *    nothing - a reconnect button under a question mark sends the reader to fix
 *    an account that may be fine;
 *  - a resolved account shows the account and presses through to plain settings,
 *    which is what it always did.
 *
 * The upstream half is out of this surface's reach and is stated in the PR, not
 * patched here: a browser sign-in that never completes leaves no credential in
 * the backend at all, which renders as the ordinary signed-out state - a state
 * the UI cannot distinguish from "never signed in", and must not pretend it can.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom accessors that refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.__RIG_ENV__ = {
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
	VITE_RADIENT_SERVER_BASE_URL: "https://api.example.invalid/v1",
	VITE_RADIENT_CLIENT_ID: "rig",
	VITE_GOOGLE_CLIENT_ID: "rig.apps.googleusercontent.com",
	VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
	VITE_MICROSOFT_TENANT_ID: "common",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
	VITE_LOG_LEVEL: "info",
};

const ACCOUNT_ENVELOPE = {
	status: 200,
	body: {
		result: {
			data: {
				msg: "ok",
				result: {
					account: {
						id: "acct_sidebar",
						tenant_id: "ten_sidebar",
						email: "sidebar@example.test",
						name: "QA Sidebar",
						role: "owner",
						status: "active",
						created_at: "2026-01-02T03:04:05Z",
						updated_at: "2026-01-02T03:04:05Z",
					},
					identity: {
						email: "sidebar@example.test",
						provider: "google",
						provider_id: "google-sidebar",
					},
				},
			},
		},
	},
};

const REFUSED_ENVELOPE = {
	status: 401,
	body: {
		detail: {
			code: "radient_credential_refused",
			message: "Radient could not complete this operation",
			details: {},
		},
	},
};

/** What the account read answers, per state under test. */
let accountBehaviour = "refused";

/**
 * Releases a read the "pending" answer holds open, called from teardown.
 *
 * A promise that never settles also leaves the transport's per-op deadline
 * (~25s) and a retry chain pending, and those are timers that hold a run open
 * after its last assertion - the same reason
 * `scripts/settings-account-gate.test.mjs` releases its held read.
 */
let releaseHeldAccountRead = () => {};

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.control?.operation === "account") {
				if (accountBehaviour === "pending") {
					return await new Promise((resolve) => {
						releaseHeldAccountRead = () => resolve(ACCOUNT_ENVELOPE);
					});
				}
				return accountBehaviour === "refused"
					? REFUSED_ENVELOPE
					: ACCOUNT_ENVELOPE;
			}
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: { desktop_available: true, features: { radient: 1 } },
					},
				};
			}
			return { status: 503, body: { detail: "not part of this test" } };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
			export { UserProfileSidebar } from "./src/renderer/src/shared/components/navigation/user-profile-sidebar";
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
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL(
	`./_sidebar-reconnect-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	MemoryRouter,
	Route,
	Routes,
	useLocation,
	UserProfileSidebar,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

/** Where the router landed, published by the probe on every navigation. */
globalThis.__lastLocation = null;
const LocationProbe = () => {
	const location = useLocation();
	globalThis.__lastLocation = `${location.pathname}${location.search}`;
	return null;
};

async function mountSidebar() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					MemoryRouter,
					{ initialEntries: ["/chat"] },
					createElement(
						Routes,
						null,
						createElement(Route, {
							path: "/chat",
							element: createElement(UserProfileSidebar, { expanded: true }),
						}),
						createElement(Route, {
							path: "*",
							element: createElement(LocationProbe),
						}),
					),
				),
			),
		);
	});
	return {
		container,
		teardown: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

async function until(check, what, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		const value = check();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
	}
}

const rowButton = (container) => container.querySelector("button");

/*
 * THE RECORD IS MODULE-GLOBAL, SO THE CASES RUN IN A FIXED ORDER.
 *
 * `use-radient-user-query.ts` holds the last failure class in one map keyed by
 * the read's key (`accountFailureKinds`) and clears it only when a read ANSWERS
 * or the query is removed - deliberately, because React Query clears its own
 * `error` the moment a retry starts and the fault would vanish on the press
 * that asked again. A test process therefore carries the class from the case
 * before it, exactly as a running app carries it across reads; the cases below
 * are ordered the way a session meets them - a read still asking, one that
 * failed, one that answered. The pending case MUST come first: run after a
 * failure, the still-asking row correctly renders the held class ("Account
 * unavailable") rather than "Checking account…", which is the product behaviour
 * and the opposite of what that case exists to pin.
 */

test("a read that has not answered says so and offers nothing", async () => {
	accountBehaviour = "pending";
	const mounted = await mountSidebar();
	try {
		await until(
			() => mounted.container.textContent.includes("Checking account"),
			"the row to state the in-flight read",
		);
		assert.ok(
			!mounted.container.textContent.includes("Reconnect Radient"),
			"a question mark must not carry a reconnect",
		);
	} finally {
		releaseHeldAccountRead();
		await mounted.teardown();
	}
});

test("a failed read names the state and offers the reconnect, which opens the provider surface", async () => {
	accountBehaviour = "refused";
	const mounted = await mountSidebar();
	try {
		await until(
			() => mounted.container.textContent.includes("Account unavailable"),
			"the row to state the failed read",
		);
		assert.ok(
			mounted.container.textContent.includes("Reconnect Radient"),
			"the failed row must carry a visible way back",
		);
		const row = rowButton(mounted.container);
		assert.ok(row, "the row is the control");
		await act(async () => {
			row.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.equal(
			globalThis.__lastLocation,
			"/settings?section=providers&provider=radient",
			"the reconnect must land on the provider surface with Radient selected",
		);
	} finally {
		await mounted.teardown();
	}
});

test("a resolved account shows the account and presses through to settings", async () => {
	accountBehaviour = "account";
	const mounted = await mountSidebar();
	try {
		await until(
			() => mounted.container.textContent.includes("QA Sidebar"),
			"the account's own name",
		);
		assert.ok(!mounted.container.textContent.includes("Reconnect Radient"));
		const row = rowButton(mounted.container);
		await act(async () => {
			row.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.equal(globalThis.__lastLocation, "/settings");
	} finally {
		await mounted.teardown();
	}
});
