import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * WHAT THE CHAT SAYS WHEN A RADIENT RUN IS REFUSED FOR WANT OF CREDITS —
 * rendered through the shipped transcript, against a seeded account read.
 *
 * Three claims, one per way this goes wrong for a user who is already blocked:
 *  - the copy matches the account (unverified -> verify to claim, verified -> top up, plus the first-top-up
 *    bonus line only while it is still on offer);
 *  - an account the app could not read gets the neutral message with BOTH
 *    remedies worded conditionally, never a state it did not read - and a
 *    backend that predates `first_topup` still shows the top-up link;
 *  - the guidance re-reads the account when the row appears, so a user who has
 *    just verified or topped up is not shown the state from before they did.
 * The amount has one extra rule (agent review round 1, R1-2): a capture with no
 * `grant_amount` takes the prices endpoint's advertised default - the fallback
 * the copy module documents - and with neither source naming a figure the
 * sentence promises no number.
 *
 * The data is synthetic throughout (`*.example.test` addresses, invented ids).
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

/** URLs the renderer asked the desktop shell to open, and the account reads it made. */
const opened = [];
let accountReads = 0;
/** What the stubbed desktop bridge answers an `account` read with. */
let bridgeAccount = null;
/**
 * What the stubbed prices read answers; `{}` is an older payload that names no
 * advertised default. The guidance reads it for the amount fallback (R1-2), so
 * every mount is served rather than 503-ing into the query's own retries.
 */
let bridgePrices = { default_new_credits: 5 };
/**
 * The bridge's default answers. Tests that replace the whole request for their
 * own shape delegate the operations they do not own back here, so a read added
 * to the component later is served rather than silently retried.
 */
const bridgeRequest = async (request) => {
	if (request?.control?.operation === "account") {
		accountReads += 1;
		return {
			status: 200,
			body: { result: { data: { result: bridgeAccount } } },
		};
	}
	if (request?.control?.operation === "prices") {
		return {
			status: 200,
			body: { result: { data: { result: bridgePrices } } },
		};
	}
	return { status: 503, body: { detail: "seeded fixture" } };
};
globalThis.window.api = {
	openExternal: (url) => opened.push(url),
	desktop: { request: bridgeRequest },
};

globalThis.__RIG_ENV__ = {};
const bundle = await build({
	stdin: {
		contents: `
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { MemoryRouter } from "react-router-dom";
			export { RadientCreditsGuidance } from "./src/renderer/src/features/chat/canonical/radient-credits-guidance";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export * from "./src/renderer/src/shared/utils/radient-account-copy";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
const bundlePath = new URL(
	`./_radient-credits-guidance-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	MemoryRouter,
	RadientCreditsGuidance,
	radientUserKeys,
	desktopKeys,
	outOfCreditsGuidance,
	consoleUrl,
	RADIENT_BILLING_URL,
	RADIENT_VERIFY_URL,
} = await import(bundlePath.href);
await unlink(bundlePath);

const CLAIM_URL = "https://console.example.test/dashboard/verification";
const TOPUP_URL = "https://console.example.test/dashboard/billing";

const account = (verification) => ({
	account: {
		id: "acct_credits_guidance",
		tenant_id: "ten_credits_guidance",
		email: "credits@example.test",
		name: "Credits Guidance",
		role: "owner",
		status: "active",
		created_at: "2026-01-02T03:04:05Z",
		updated_at: "2026-01-02T03:04:05Z",
	},
	identity: {
		email: "credits@example.test",
		provider: "google",
		provider_id: "google-credits-guidance",
	},
	...(verification === undefined ? {} : { verification }),
});

const UNVERIFIED = {
	email_verified: false,
	signup_grant: "pending",
	grant_amount: 5,
	claim_url: CLAIM_URL,
};
const FIRST_TOPUP = {
	bonus_amount: 10,
	minimum_purchase: 5,
	bonus_received: false,
	topup_url: TOPUP_URL,
};
const VERIFIED = {
	email_verified: true,
	signup_grant: "claimed",
	grant_amount: 5,
	claim_url: CLAIM_URL,
	first_topup: FIRST_TOPUP,
};

function seededClient({ data, ageMs = 0 }) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { radient: 1 },
	});
	if (data !== undefined)
		client.setQueryData(radientUserKeys.user(), data, {
			updatedAt: Date.now() - ageMs,
		});
	return client;
}

/** The action the row already earns beside the console one (the account section). */
const ACCOUNT_ACTION = {
	label: "Open Radient account",
	to: "/settings?section=radient",
};

/**
 * Mount the shipped guidance exactly as the transcript's incident row mounts it
 * (`NoticeRow` renders it under the row for a Radient out-of-credits failure;
 * that call site is pinned by `scripts/canonical-notice.test.mjs`). The whole
 * transcript is not mounted here: it needs scroll and layout APIs jsdom does not
 * have, and none of them are what this file is about.
 */
async function mount(client, count = 1) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			React.createElement(
				MemoryRouter,
				{},
				React.createElement(
					QueryClientProvider,
					{ client },
					...Array.from({ length: count }, (_, key) =>
						React.createElement(RadientCreditsGuidance, {
							key,
							action: ACCOUNT_ACTION,
						}),
					),
				),
			),
		);
	});
	// Let a re-read the guidance commissioned on mount settle into the tree.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	return {
		container,
		text: () => container.textContent,
		button: (label) =>
			[...container.querySelectorAll("button, a")].find((el) =>
				el.textContent.includes(label),
			),
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

async function press(button) {
	await act(async () => {
		button.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
}

test("unverified: verify to claim the grant, and the CTA opens the claim URL", async () => {
	bridgeAccount = account(UNVERIFIED);
	opened.length = 0;
	const view = await mount(seededClient({ data: account(UNVERIFIED) }));
	try {
		assert.ok(
			view
				.text()
				.includes(
					"You haven't verified your email yet. Verify to claim $5 in free credits and start using Local Operator for free.",
				),
			view.text(),
		);
		assert.ok(
			view.text().includes("Check your inbox for the link Radient sent."),
		);
		assert.ok(
			!view.text().includes("Top up"),
			"no top-up pitch before verifying",
		);
		await press(view.button("Open verification page"));
		assert.deepEqual(opened, [CLAIM_URL]);
	} finally {
		await view.unmount();
	}
});

test("unverified: an expired link asks for a new one; none promises no amount", async () => {
	bridgeAccount = account({ ...UNVERIFIED, signup_grant: "expired" });
	let view = await mount(
		seededClient({ data: account({ ...UNVERIFIED, signup_grant: "expired" }) }),
	);
	try {
		assert.ok(
			view.text().includes("has expired. Request a new one"),
			view.text(),
		);
		assert.ok(view.button("Request a new link"));
	} finally {
		await view.unmount();
	}

	const none = { ...UNVERIFIED, signup_grant: "none", grant_amount: undefined };
	bridgeAccount = account(none);
	view = await mount(seededClient({ data: account(none) }));
	try {
		assert.ok(view.text().includes("You haven't verified your email yet."));
		assert.ok(
			!view.text().includes("$"),
			"no figure for a grant that is not there",
		);
	} finally {
		await view.unmount();
	}
});

test("a pending grant with no captured amount quotes the advertised default, and neither source means no figure", async () => {
	/*
	 * The backend can answer a pending grant with no `grant_amount` (an older
	 * capture); the prices endpoint's advertised default is the fallback the
	 * copy module documents, and this is the read that keeps it firing (agent
	 * review round 1, R1-2) - the same pair the settings callout reads.
	 */
	const noAmount = { ...UNVERIFIED, grant_amount: undefined };
	bridgeAccount = account(noAmount);
	let view = await mount(seededClient({ data: account(noAmount) }));
	try {
		assert.ok(
			view.text().includes("Verify to claim $5 in free credits"),
			view.text(),
		);
	} finally {
		await view.unmount();
	}
	/*
	 * With neither source naming a figure, the sentence degrades to the phrase
	 * that promises no number rather than inventing one (`grantAmountText`).
	 */
	bridgePrices = {};
	view = await mount(seededClient({ data: account(noAmount) }));
	try {
		assert.ok(
			view.text().includes("Verify to claim your free credits"),
			view.text(),
		);
		assert.ok(!view.text().includes("$"), "no figure when none was reported");
	} finally {
		await view.unmount();
		bridgePrices = { default_new_credits: 5 };
	}
});

test("verified: top up in the console, with the first-top-up line while it is on offer", async () => {
	bridgeAccount = account(VERIFIED);
	opened.length = 0;
	const view = await mount(seededClient({ data: account(VERIFIED) }));
	try {
		assert.ok(
			view
				.text()
				.includes("You're out of credits. Top up in the Radient console."),
		);
		assert.ok(
			view
				.text()
				.includes("Get an extra $10 free on your first top-up of $5 or more."),
			view.text(),
		);
		assert.ok(!view.text().includes("verified your email"));
		await press(view.button("Top up in Radient console"));
		assert.deepEqual(opened, [TOPUP_URL], "the backend-named top-up page");
	} finally {
		await view.unmount();
	}
});

test("verified, bonus already received: no bonus line", async () => {
	const data = account({
		...VERIFIED,
		first_topup: { ...FIRST_TOPUP, bonus_received: true },
	});
	bridgeAccount = data;
	const view = await mount(seededClient({ data }));
	try {
		assert.ok(view.text().includes("Top up in the Radient console."));
		assert.ok(!view.text().includes("extra $10"), view.text());
	} finally {
		await view.unmount();
	}
});

test("verified on a backend with no first_topup: the link, no bonus line, default URL", async () => {
	const { first_topup: _omitted, ...older } = VERIFIED;
	const data = account(older);
	bridgeAccount = data;
	opened.length = 0;
	const view = await mount(seededClient({ data }));
	try {
		assert.ok(view.text().includes("Top up in the Radient console."));
		assert.ok(!view.text().includes("extra"), view.text());
		await press(view.button("Top up in Radient console"));
		assert.deepEqual(opened, [RADIENT_BILLING_URL]);
	} finally {
		await view.unmount();
	}
});

test("an account the app could not read gets the neutral message and BOTH links, conditionally worded", async () => {
	// Signed out: the read answers "no credential" (a 409 the hook treats as null).
	globalThis.window.api.desktop.request = async (request) =>
		request?.control?.operation === "account"
			? {
					status: 409,
					body: {
						detail: {
							code: "radient_no_credential",
							message: "Sign in to Radient to access your account",
						},
					},
				}
			: bridgeRequest(request);
	opened.length = 0;
	const view = await mount(seededClient({}));
	try {
		const text = view.text();
		assert.ok(
			text.includes(
				"You're out of credits. If you haven't verified your email yet, verify it to claim free credits",
			),
			text,
		);
		assert.ok(text.includes("Otherwise, top up in the Radient console."));
		assert.ok(!text.includes("$"), "no figure it could not read");
		await press(view.button("Open verification page"));
		await press(view.button("Top up in Radient console"));
		assert.deepEqual(opened, [RADIENT_VERIFY_URL, RADIENT_BILLING_URL]);
	} finally {
		await view.unmount();
	}
});

test("the row re-reads the account when it appears, so a just-verified user is not shown stale state", async () => {
	// The cache still says unverified, 30 s old (older than the guidance's
	// window); the console has since verified the account. The row must repair
	// its own sentence rather than wait for the settings page's 30 s staleness.
	// (Reset to the default bridge: the previous test replaced the request.)
	globalThis.window.api.desktop.request = bridgeRequest;
	bridgeAccount = account(VERIFIED);
	accountReads = 0;
	const view = await mount(
		seededClient({ data: account(UNVERIFIED), ageMs: 30_000 }),
	);
	try {
		assert.ok(accountReads >= 1, "the row must ask the backend again");
		assert.ok(
			view.text().includes("Top up in the Radient console."),
			view.text(),
		);
		assert.ok(!view.text().includes("verified your email yet"), view.text());
	} finally {
		await view.unmount();
	}
});

test("two refusal rows on screen share one fresh read, not one each", async () => {
	bridgeAccount = account(VERIFIED);
	accountReads = 0;
	const view = await mount(
		seededClient({ data: account(UNVERIFIED), ageMs: 30_000 }),
		2,
	);
	try {
		assert.equal(accountReads, 1, "one request for both rows");
		assert.equal(
			view.container.querySelectorAll("[data-radient-credits-state]").length,
			2,
		);
	} finally {
		await view.unmount();
	}
});

test("the copy module: URLs from the payload are web pages or the default", () => {
	assert.equal(
		consoleUrl("https://console.example.test/x", "d"),
		"https://console.example.test/x",
	);
	assert.equal(consoleUrl("file:///etc/passwd", "d"), "d");
	assert.equal(consoleUrl("javascript:alert(1)", "d"), "d");
	assert.equal(consoleUrl("not a url", "d"), "d");
	assert.equal(consoleUrl(undefined, "d"), "d");
	// A partial first_topup (a field the backend dropped) offers nothing it cannot quote.
	const partial = outOfCreditsGuidance({
		...VERIFIED,
		first_topup: { bonus_received: false, topup_url: TOPUP_URL },
	});
	assert.deepEqual(partial.lines, [
		"You're out of credits. Top up in the Radient console.",
	]);
	// Non-integer amounts keep their cents rather than rounding to a different number.
	const cents = outOfCreditsGuidance({
		...VERIFIED,
		first_topup: { ...FIRST_TOPUP, bonus_amount: 7.5 },
	});
	assert.ok(cents.lines[1].includes("$7.50"));
});
