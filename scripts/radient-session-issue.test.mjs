#!/usr/bin/env node
/**
 * The Radient session issue, driven through the shipped hook and the shipped
 * callout.
 *
 * WHY THIS FILE EXISTS. The surface has four ways to be silent and five ways to
 * speak, and only one of them is a fact about the login. The interesting half is
 * the silence: a backend that cannot answer the verdict (no `tunnel` capability,
 * no `radient_login` key, a read that failed, or `unknown`) must draw NOTHING,
 * because a nag on a machine whose login is fine is the same class of lie - told
 * in the other direction - as the silent-health bug this surface exists to fix.
 * That is a property of the wiring (a query that never runs, a verdict that is
 * never read, a refusal that is never dressed as a sign-in) rather than of the
 * copy, so it is pinned here rather than in prose.
 *
 * EVERY WAIT HERE IS A BOUNDED POLL, and that is the honest form of these
 * assertions rather than a workaround for a slow machine. The surface is gated
 * on a capability answer and reads its verdict only once that gate is open, so
 * "the issue is raised" is a claim about a state the surface REACHES; asserting
 * it a fixed number of milliseconds after mount is asserting a scheduling
 * accident. `settled()` therefore waits for the read to have happened before
 * anything is asserted about silence, and `expectKind()` waits for the kind.
 *
 * WHAT THIS IS NOT: proof of layout, or of a page opening. jsdom has no layout
 * engine, so geometry and the frames are the evidence rig's business; the
 * browser hand-off is proven as the CALL main's own `openAuthorization` makes
 * (addressed by operation id, never by a renderer-supplied URL), not as a page.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Every timer created below is recorded and cleared on the way out. React Query
 * schedules the verdict's own 60s interval and the capability watch, and jsdom
 * has no lifecycle that retires them, so left alone the process never exits -
 * and a leaked 30s transport deadline would outlive a failed assertion.
 */
const liveTimers = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (...args) => {
	const id = realSetTimeout(...args);
	liveTimers.push(id);
	return id;
};
after(() => {
	for (const id of liveTimers) clearTimeout(id);
});

const bundle = await build({
	stdin: {
		contents: `
			export { useRadientSessionIssue } from "./src/renderer/src/shared/hooks/use-radient-session-issue";
			export { RadientSessionIssueCallout } from "./src/renderer/src/features/chat/components/radient-session-issue";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		loader: "ts",
		resolveDir: process.cwd(),
	},
	tsconfig: "tsconfig.web.json",
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const bundlePath = new URL(
	`./_radient-session-issue-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	RadientSessionIssueCallout,
	useRadientSessionIssue,
} = await import(bundlePath.href);
await unlink(bundlePath);

const { createRoot } = await import("react-dom/client");
const h = React.createElement;
const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

/** The verdicts, and the one remedy a parked connector names. */
const HEALTHY = { credential_id: 7, state: "ok" };
const DEAD = { credential_id: 7, state: "login_required" };
const UNKNOWN = { credential_id: null, state: "unknown" };
const REMEDY = {
	command: "lop login radient",
	url: "https://console.radienthq.com",
};

/** One auth-operation snapshot, in the shape `GET /v1/auth/operations/{id}` returns. */
const operation = (over) => ({
	id: "op-1",
	provider: "radient",
	state: "starting",
	message: "Sign-in started.",
	auth_url: null,
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 900,
	...over,
});

/**
 * One mounted surface, against a transport this file scripts.
 *
 * The world is MUTABLE because the state under test changes on human timescales
 * - an operation settling, a verdict flipping - and the assertions are about
 * what the surface does across that change, not about one reading of it.
 */
async function mount(world = {}) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		url: "http://localhost/",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;

	const state = {
		/** Advertised features; `tunnel` is the whole gate on this surface. */
		features: { tunnel: 1 },
		verdict: DEAD,
		remedy: REMEDY,
		/** Set to a promise to hold the `accounts.list` answer open. */
		hold: null,
		/** The snapshot every `auth.status` read answers with. */
		operation: operation(),
		/** A scripted `auth.start` answer, for the refusal cases. */
		start: null,
		requests: [],
		opens: [],
		...world,
	};

	const envelope = (status, body) => ({ status, body });

	dom.window.api = {
		desktop: {
			request: async (request) => {
				state.requests.push(request);
				switch (request.op) {
					case "capabilities":
						return envelope(200, {
							result: {
								desktop_available: true,
								features: state.features,
							},
						});
					case "accounts.list": {
						if (state.hold) await state.hold;
						if (state.verdict === "refused") {
							/*
							 * A desktop-PLANE refusal: a bare string with no
							 * `radient_` code, which is the shape that says
							 * "this app cannot talk to the backend" rather
							 * than "the Radient login is dead".
							 */
							return envelope(401, {
								detail:
									"Desktop controls need a compatible backend connection.",
							});
						}
						const result = { accounts: [] };
						if (state.verdict !== "absent") {
							result.radient_login = state.verdict;
						}
						if (state.remedy !== "absent") {
							result.tunnel_remedy = state.remedy;
						}
						return envelope(200, { result });
					}
					case "auth.start":
						return state.start ?? envelope(200, { result: state.operation });
					case "auth.status":
						return envelope(200, { result: state.operation });
					case "auth.cancel":
						return envelope(200, { result: {} });
					default:
						throw new Error(`unexpected desktop op: ${request.op}`);
				}
			},
			openAuthorization: async (id, reopen) => {
				state.opens.push({ id, reopen });
			},
		},
	};

	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	const container = dom.window.document.getElementById("root");
	let latest = null;

	function Probe() {
		const probe = useRadientSessionIssue();
		latest = probe;
		return h(
			"div",
			null,
			h("span", { "data-kind": probe.issue.kind }),
			h(RadientSessionIssueCallout, {
				issue: probe.issue,
				onSignIn: probe.start,
				onCancel: probe.cancel,
			}),
		);
	}

	let root;
	await act(async () => {
		root = createRoot(container);
		root.render(h(QueryClientProvider, { client }, h(Probe)));
	});

	const text = () => container.textContent ?? "";
	const controls = (label) =>
		[...container.querySelectorAll("button")].filter(
			(candidate) => candidate.textContent?.trim() === label,
		);
	const reads = (op) =>
		state.requests.filter((request) => request.op === op).length;

	/**
	 * Wait for a predicate, re-flushing React between polls, or FAIL NAMING WHAT
	 * WAS SEEN. The bound is generous because what it covers is a chain of real
	 * promises, and the message is the diagnostic a reader needs when it fires.
	 */
	const waitFor = async (predicate, what, timeoutMs = 4000) => {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			if (predicate()) return;
			if (Date.now() > deadline) {
				throw new Error(
					`timed out waiting for ${what}: kind=${latest?.issue?.kind} text=${JSON.stringify(text())} ops=${state.requests.map((request) => request.op).join(",")}`,
				);
			}
			await act(async () => sleep(20));
		}
	};

	const expectKind = (kind) =>
		waitFor(() => latest?.issue?.kind === kind, `issue kind "${kind}"`);
	const verdictRead = () =>
		waitFor(() => reads("accounts.list") > 0, "the verdict read");

	const press = async (label) => {
		await waitFor(() => controls(label).length > 0, `the "${label}" control`);
		const [target] = controls(label);
		await act(async () => {
			target.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
	};
	const close = async () => {
		await act(async () => {
			root.unmount();
		});
		client.clear();
		dom.window.close();
	};

	return {
		state,
		latest: () => latest,
		text,
		controls,
		reads,
		waitFor,
		expectKind,
		verdictRead,
		press,
		close,
	};
}

test("a backend that cannot answer the verdict draws nothing, and is not asked", async () => {
	const surface = await mount({ features: {} });
	// The capability answer is what this case waits on; nothing else must follow.
	await surface.waitFor(
		() => surface.reads("capabilities") > 0,
		"the capabilities read",
	);
	assert.equal(surface.latest().issue.kind, "hidden");
	assert.equal(surface.text(), "");
	assert.equal(
		surface.reads("accounts.list"),
		0,
		"an unadvertised verdict must not be read",
	);
	await surface.close();
});

test("only `login_required` speaks: `ok`, `unknown` and an absent key are silent", async () => {
	for (const verdict of [HEALTHY, UNKNOWN, "absent"]) {
		const surface = await mount({ verdict });
		await surface.verdictRead();
		assert.equal(
			surface.latest().issue.kind,
			"hidden",
			`verdict ${JSON.stringify(verdict)} must not raise the issue`,
		);
		assert.equal(surface.text(), "");
		await surface.close();
	}
});

test("a verdict read that FAILED is not evidence the login is dead", async () => {
	/*
	 * The backend's own distinction, kept: a desktop-plane refusal carries no
	 * `radient_` code, and that is exactly how "sign in again" stays apart from
	 * "re-pair this app". Dressing a bearer problem as a sign-in nag sends the
	 * operator to fix an account that is not broken.
	 */
	const surface = await mount({ verdict: "refused" });
	await surface.verdictRead();
	assert.equal(surface.latest().issue.kind, "hidden");
	assert.equal(surface.text(), "");
	await surface.close();
});

test("a dead sign-in raises the issue with exactly one action and the backend's remedy", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	assert.match(surface.text(), /Radient needs re-authentication/);
	assert.match(surface.text(), /lop login radient/);
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	await surface.close();
});

test("the action starts the documented flow, and the page is opened by MAIN", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");

	assert.deepEqual(
		surface.state.requests.find((request) => request.op === "auth.start"),
		{ op: "auth.start", provider: "radient" },
	);
	assert.equal(
		surface.state.opens.length,
		0,
		"no URL is on offer yet, so nothing may be opened",
	);
	assert.match(surface.text(), /The connector restarts when it completes/);

	/*
	 * The desktop route deliberately opens no browser and sets `auth_url` from
	 * the flow's own first step, so the URL arrives on a LATER read than the one
	 * that started the operation. Opening only the start reply would leave a
	 * flow in flight with no page to complete it on.
	 */
	surface.state.operation = operation({
		state: "waiting",
		message: "Complete sign-in in your browser.",
		auth_url: "https://console.radienthq.com/oauth/authorize?state=x",
	});
	await surface.waitFor(
		() => surface.state.opens.length > 0,
		"main to open the sign-in page",
	);
	assert.deepEqual(
		surface.state.opens,
		[{ id: "op-1", reopen: false }],
		"main opens the operation's own URL, addressed by id",
	);

	// The same URL read again must not open twice.
	await sleep(1800);
	await act(async () => sleep(0));
	assert.equal(surface.state.opens.length, 1);
	await surface.close();
});

test("a completed sign-in refetches the verdict, and never flashes the issue back", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");

	// Held open so the waiting state can be read: while the refetch is in
	// flight the surface must still say "signing in", because a credential that
	// was just stored must not re-demand the sign-in that stored it.
	let release;
	surface.state.hold = new Promise((resolve) => {
		release = () => {
			surface.state.verdict = HEALTHY;
			resolve();
		};
	});
	surface.state.operation = operation({
		state: "succeeded",
		message: "Sign-in complete.",
	});
	const before = surface.reads("accounts.list");
	await surface.waitFor(
		() => surface.reads("accounts.list") > before,
		"the verdict to be re-read after the sign-in settled",
	);
	assert.equal(
		surface.latest().issue.kind,
		"signing-in",
		"a stored credential must not re-raise the issue while the verdict catches up",
	);

	surface.state.hold = null;
	await act(async () => {
		release();
		await sleep(0);
	});
	await surface.expectKind("hidden");
	assert.equal(surface.text(), "");
	await surface.close();
});

test("a concurrent sign-in (409) states the backend's sentence and offers no retry", async () => {
	const surface = await mount({
		start: {
			status: 409,
			body: {
				detail: "A sign-in is already active. Finish or cancel it first.",
			},
		},
	});
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("settled");
	assert.equal(surface.latest().issue.canRetry, false);
	assert.match(
		surface.text(),
		/A sign-in is already active\. Finish or cancel it first\./,
	);
	assert.equal(
		surface.controls("Sign in to Radient").length,
		0,
		"pressing again clears nothing: another flow holds the loopback port",
	);
	await surface.close();
});

test("a backend with no browser flow (422) says so and offers no retry", async () => {
	const surface = await mount({
		start: {
			status: 422,
			body: { detail: "This provider has no browser sign-in flow." },
		},
	});
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("settled");
	assert.equal(surface.latest().issue.canRetry, false);
	assert.match(surface.text(), /This provider has no browser sign-in flow\./);
	assert.equal(surface.controls("Sign in to Radient").length, 0);
	await surface.close();
});

test("a refusal that carries its own typed code keeps the action", async () => {
	/*
	 * Everything that is not 409/422 keeps the retry, including the typed
	 * `radient_*` refusals - whose message is authored for a user and is
	 * rendered VERBATIM here rather than paraphrased by this surface.
	 */
	const surface = await mount({
		start: {
			status: 502,
			body: {
				detail: {
					code: "radient_upstream_failed",
					message: "Radient could not complete this operation",
				},
			},
		},
	});
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("settled");
	assert.equal(surface.latest().issue.canRetry, true);
	assert.match(surface.text(), /Radient could not complete this operation/);
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	await surface.close();
});

test("an expired flow shows the backend's own sentence and can be started again", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");
	surface.state.operation = operation({
		state: "expired",
		message: "Sign-in expired. Start again when you are ready.",
	});
	await surface.expectKind("settled");
	assert.equal(surface.latest().issue.canRetry, true);
	assert.match(
		surface.text(),
		/Sign-in expired\. Start again when you are ready\./,
	);
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	await surface.close();
});

test("Cancel releases the flow and re-offers the action", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");
	await surface.press("Cancel");
	await surface.waitFor(
		() => surface.reads("auth.cancel") > 0,
		"the operation to be cancelled",
	);
	await surface.expectKind("needs-sign-in");
	assert.deepEqual(
		surface.state.requests.filter((request) => request.op === "auth.cancel"),
		[{ op: "auth.cancel", id: "op-1" }],
	);
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	await surface.close();
});

test("an input-required flow is stated, cancellable, and not finished here", async () => {
	/*
	 * Reachable for Radient even though its desktop flow declares no paste step:
	 * the callback server falls back to manual input when its loopback port
	 * cannot be bound. This surface has no pasted-code control, so it must say
	 * where that step lives rather than leaving the user at a dead end.
	 */
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");
	surface.state.operation = operation({
		state: "input_required",
		message: "Paste the key or sign-in response requested by this provider.",
		input_required: true,
		prompt_id: "p-1",
	});
	await surface.expectKind("input-required");
	assert.match(
		surface.text(),
		/Paste the key or sign-in response requested by this provider\./,
	);
	assert.match(surface.text(), /finish the sign-in from Settings/);
	assert.equal(surface.controls("Cancel").length, 1);
	assert.equal(surface.controls("Sign in to Radient").length, 0);
	await surface.close();
});
