import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE VERIFY-TO-CLAIM CALLOUT — when it appears, what it promises, and the
 * press that opens the claim page.
 *
 * The account section is rendered from a seeded query cache against a real
 * `QueryClient`, the way `scripts/settings-account-gate.test.mjs` renders the
 * page: the section reads `user.radientUser.verification`, so what is under
 * test is which branch the SHIPPED component takes for each lifecycle value
 * and for its absence.
 *
 * The four claims this file pins, one per failure it exists for:
 *  - unclaimed renders with the amount the backend captured;
 *  - the amount falls back to the advertised price WHEN the capture is absent,
 *    and degrades to words when neither exists - never to a number nobody
 *    promised;
 *  - claimed, or a backend that sends no verification block at all, renders
 *    NOTHING (an older backend must not be nagged at);
 *  - the CTA opens the claim URL the backend named, through the same
 *    `window.api.openExternal` call the low-credits flow uses.
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

/** Claim URLs the renderer asked the desktop shell to open. */
const opened = [];
globalThis.window.api = {
	openExternal: (url) => opened.push(url),
	desktop: {
		// Everything the section would fetch is seeded; this answers only if a
		// render slips past the fixture.
		request: async () => ({ status: 503, body: { detail: "seeded fixture" } }),
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { RadientAccountSection } from "./src/renderer/src/features/settings/components/radient-account-section";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export { radientPricesKeys } from "./src/renderer/src/shared/hooks/use-radient-prices-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
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
	`./_radient-verify-callout-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	RadientAccountSection,
	radientUserKeys,
	radientPricesKeys,
	desktopKeys,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const ACCOUNT = {
	account: {
		id: "acct_verify_callout",
		tenant_id: "ten_verify_callout",
		email: "verify@example.test",
		name: "Verify Callout",
		role: "owner",
		status: "active",
		created_at: "2026-01-02T03:04:05Z",
		updated_at: "2026-01-02T03:04:05Z",
	},
	identity: {
		email: "verify@example.test",
		provider: "google",
		provider_id: "google-verify-callout",
	},
};

const CLAIM_URL = "https://console.radienthq.com/dashboard/verification";

/** The client every case renders against: the section's reads all seeded. */
function seededClient({ verification, prices } = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { radient: 1 },
	});
	client.setQueryData(radientUserKeys.user(), {
		...ACCOUNT,
		...(verification === undefined ? {} : { verification }),
	});
	if (prices !== undefined)
		client.setQueryData(radientPricesKeys.prices(), {
			default_new_credits: prices,
			default_registration_credits: 25,
		});
	return client;
}

async function renderStatic(client) {
	const { renderToStaticMarkup } = await import("react-dom/server");
	const container = document.createElement("div");
	container.innerHTML = renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(RadientAccountSection, {}),
		),
	);
	return container.textContent;
}

test("an unclaimed grant renders with the captured amount and the pending copy", async () => {
	const html = await renderStatic(
		seededClient({
			verification: {
				email_verified: false,
				signup_grant: "pending",
				grant_amount: 5,
				claim_url: CLAIM_URL,
			},
		}),
	);
	assert.ok(html.includes("Verify your email to claim $5.00 in free credits."));
	assert.ok(html.includes("Check your inbox for the link Radient sent."));
	assert.ok(html.includes("Open verification page"));
});

test("a missing capture falls back to the advertised price, and to words when neither exists", async () => {
	const withPrices = await renderStatic(
		seededClient({
			verification: {
				email_verified: false,
				signup_grant: "pending",
				claim_url: CLAIM_URL,
			},
			prices: 7.5,
		}),
	);
	assert.ok(withPrices.includes("claim $7.50 in free credits"));

	const withNothing = await renderStatic(
		seededClient({
			verification: {
				email_verified: false,
				signup_grant: "none",
				claim_url: CLAIM_URL,
			},
		}),
	);
	assert.ok(withNothing.includes("claim your free credits"));
	assert.ok(!withNothing.includes("$"), "no dollar figure may be invented");
});

test("expired and none point at a new link; pending points at the inbox", async () => {
	const expired = await renderStatic(
		seededClient({
			verification: {
				email_verified: false,
				signup_grant: "expired",
				grant_amount: 5,
				claim_url: CLAIM_URL,
			},
		}),
	);
	assert.ok(expired.includes("The previous link has expired"));
	assert.ok(expired.includes("Request a new link"));

	const none = await renderStatic(
		seededClient({
			verification: {
				email_verified: false,
				signup_grant: "none",
				grant_amount: 5,
				claim_url: CLAIM_URL,
			},
		}),
	);
	assert.ok(none.includes("Request the verification link to get started."));
	assert.ok(none.includes("Request a new link"));
});

test("a claimed grant, and a backend with no verification block, render nothing", async () => {
	const claimed = await renderStatic(
		seededClient({
			verification: {
				email_verified: true,
				signup_grant: "claimed",
				grant_amount: 5,
				claim_url: CLAIM_URL,
			},
		}),
	);
	assert.ok(
		!claimed.includes("Verify your email"),
		"a claimed grant must not keep nagging",
	);

	const olderBackend = await renderStatic(seededClient());
	assert.ok(
		!olderBackend.includes("Verify your email"),
		"a backend that sends no verification block must not be nagged at",
	);
});

test("the CTA opens the claim URL the backend named, through openExternal", async () => {
	opened.length = 0;
	const claimUrl = "https://example.invalid/agent-server-claim";
	const client = seededClient({
		verification: {
			email_verified: false,
			signup_grant: "pending",
			grant_amount: 5,
			claim_url: claimUrl,
		},
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	try {
		await act(async () => {
			root.render(
				createElement(
					QueryClientProvider,
					{ client },
					createElement(RadientAccountSection, {}),
				),
			);
		});
		const button = [...container.querySelectorAll("button")].find((el) =>
			el.textContent.includes("Open verification page"),
		);
		assert.ok(button, "the callout's CTA must be rendered and pressable");
		await act(async () => {
			button.dispatchEvent(
				new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.deepEqual(
			opened,
			[claimUrl],
			"the press must open the URL from the backend's own block",
		);
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
