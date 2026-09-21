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
 * accident. `verdictApplied()` therefore waits for the ANSWER and for the RENDER
 * that answer produces - not for the request that carries it - before anything is
 * asserted about silence, and `expectKind()` waits for the kind.
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
			export { radientSessionIssueKey, useRadientSessionIssue } from "./src/renderer/src/shared/hooks/use-radient-session-issue";
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
	/*
	 * ESM ENTRY POINTS, because a bundled CJS dependency that requires React at
	 * runtime cannot reach an external React from an ESM bundle ("Dynamic require
	 * of \"react\" is not supported" - measured here, from `lucide-react`'s CJS
	 * build). `composer-tabs.test.mjs` resolves the same way for the same reason.
	 */
	mainFields: ["module", "main"],
	conditions: ["import"],
	/*
	 * THE PACKAGES ARE BUNDLED HERE, and only React and the query client stay
	 * external - the shape `composer-tabs.test.mjs` uses, for the same reason and
	 * with the same discipline.
	 *
	 * This file used to mark every package external, which was fine while the
	 * callout's graph was five tiny modules. It imports the composer row's own
	 * `shouldRestoreComposerFocus` now (UX round 2's U7 - one predicate rather than
	 * two restatements of it), and the row's graph reaches `@mui/material/styles`,
	 * which Node's ESM loader refuses as a DIRECTORY import once it is left
	 * external. React stays external because two copies of it is an invalid hook
	 * call in every test here, and the query client because the test constructs the
	 * client itself.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
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
	radientSessionIssueKey,
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
 * One string identifying the answer a query state carries, or that none has
 * arrived. Used to match a RENDER against the answer it was produced from.
 */
const appliedStamp = (state) =>
	(state?.dataUpdatedAt ?? 0) > 0 || (state?.errorUpdatedAt ?? 0) > 0
		? `${state.status}:${state.dataUpdatedAt}:${state.errorUpdatedAt}`
		: "unanswered";

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
	/*
	 * The element CLASS as well, because the callout's focus effect reads
	 * `document.activeElement instanceof HTMLElement` - the same test
	 * `ComposerStatusRow` makes, which its own suite never executes (that file
	 * server-renders the row, so no effect runs there). In a browser both are
	 * globals; in this harness the DOM has to be installed.
	 */
	globalThis.HTMLElement = dom.window.HTMLElement;
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
	/**
	 * The verdict answer the LATEST render was produced from.
	 *
	 * This is what makes a silence assertion mean something (agent review round
	 * 1's M-2). React Query applies an answer before React re-renders, so reading
	 * `latest()` in the same turn as the answer reads the PREVIOUS render - where
	 * `verdict` is `undefined` and every verdict draws `hidden`, including a
	 * reversed decision. Recording the stamp at render time, with the query's own
	 * numbers, is what lets `verdictApplied` wait for a render that was actually
	 * produced under the answer under test.
	 */
	let renderedUnder = appliedStamp(undefined);

	/*
	 * A STAND-IN FOR THE COMPOSER BOX, because the callout's focus restore is a
	 * PROPERTY of its parent: `message-input.tsx` owns the textarea's ref and
	 * passes `onFocusComposer`, and a harness that rendered the callout without
	 * one would be exercising a different wiring from the shipped one.
	 *
	 * It is a `tabindex="-1"` DIV rather than a textarea, and the element type is
	 * the one thing that does not matter here: what is asserted is that the
	 * parent's node RECEIVED focus. A real textarea engages React's legacy input
	 * polyfill the moment it is focused, which calls IE's `attachEvent`/`detachEvent`
	 * and prints a TypeError in jsdom for every case below - noise about the
	 * harness, in the CI log of a suite that is otherwise silent.
	 *
	 * The stand-in is rendered AFTER the callout on purpose: that is the band's DOM
	 * order (the block precedes the box), and it is what makes the `Shift+Tab`
	 * route out of the block one stop.
	 */
	let composer = null;

	function Probe() {
		const probe = useRadientSessionIssue();
		latest = probe;
		// `useSyncExternalStore` is what makes this honest rather than a guess:
		// the hook's snapshot and the client's state agree within one render.
		renderedUnder = appliedStamp(client.getQueryState(radientSessionIssueKey));
		return h(
			"div",
			null,
			h("span", { "data-kind": probe.issue.kind }),
			h(RadientSessionIssueCallout, {
				issue: probe.issue,
				onSignIn: probe.start,
				onCancel: probe.cancel,
				onDismiss: probe.dismiss,
				onFocusComposer: () => composer?.focus(),
			}),
			h("div", {
				"data-lo-composer": "",
				tabIndex: -1,
				ref: (node) => {
					composer = node;
				},
			}),
		);
	}

	let root;
	await act(async () => {
		root = createRoot(container);
		root.render(h(QueryClientProvider, { client }, h(Probe)));
	});

	const text = () => container.textContent ?? "";
	/**
	 * The callout's rendered variant CLASS, which is how the severity keying is
	 * visible to this harness (agent review round 2, MINOR-2). Without an
	 * assertion on it, a later edit flipping `failed` back to `warning` - or a
	 * refusal to `danger` - would land with every other test here still green.
	 */
	const variant = () => {
		const node = container.querySelector("[data-lo-radient-issue]");
		return node?.className ?? "";
	};
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
	/**
	 * The verdict query's OWN state, which is what a silence assertion has to
	 * look at to mean anything: see `verdictApplied` below.
	 */
	const query = () => client.getQueryState(radientSessionIssueKey); /**
	 * Wait for the verdict ANSWER to have been applied, not merely requested.
	 *
	 * THE FLAW THIS CLOSES (agent review round 1, M-2): the mock records a
	 * request at the TOP of its handler, before it answers, so waiting on
	 * `reads("accounts.list") > 0` returned while the response was still in
	 * flight and the assertion read the render from before any verdict arrived -
	 * where `verdict` is `undefined` and therefore `hidden` whatever the backend
	 * said. A test waiting there cannot fail on a reversed decision, which is
	 * exactly what the round proved by reversing one.
	 *
	 * So this waits on the QUERY's own settled state - off `pending`, nothing in
	 * flight - which is the fact the surface renders from, and then flushes React
	 * so the assertion reads the render that answer produced.
	 */
	const verdictApplied = async () => {
		await waitFor(() => {
			const state = query();
			/*
			 * AN ANSWER, NOT A PENDING QUERY, and the distinction is not pedantry:
			 * `useQuery` creates its cache entry while it is still DISABLED (the
			 * capability gate stays shut until the first answer lands), and a
			 * disabled entry reports `status: "pending"` with `fetchStatus:
			 * "idle"` - i.e. exactly the state this predicate first accepted, one
			 * turn after mount and before a single request had been made. Measured
			 * with that predicate: the silence assertions below passed against a
			 * deliberately reversed hook about half the time, which is worse than
			 * failing.
			 */
			const answered =
				(state?.dataUpdatedAt ?? 0) > 0 || (state?.errorUpdatedAt ?? 0) > 0;
			if (!answered) return false;
			/*
			 * A RENDER IS ONLY WAITED FOR WHEN THERE IS DATA ONE COULD BE PRODUCED
			 * FROM. React Query subscribes on the properties a render READ, so a
			 * query that goes straight to an error re-renders the hook not at all -
			 * measured here, where `renderedUnder` stayed at its initial value for
			 * four seconds of polling while the query sat in `error`. That is the
			 * right behaviour for this surface (its output is `hidden` either way)
			 * and it would make a render-stamp wait unsatisfiable, so the applied
			 * answer is the whole claim for a read that failed.
			 */
			if ((state?.dataUpdatedAt ?? 0) === 0) return true;
			return renderedUnder === appliedStamp(state);
		}, "the verdict answer to be applied, and rendered from");
	};
	/**
	 * Force the read the surface's own 60 s interval would make, so a test can
	 * change the world under a standing block without waiting a minute for it.
	 */
	const refresh = async () => {
		await act(async () => {
			await client.invalidateQueries({ queryKey: radientSessionIssueKey });
		});
	};

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
		variant,
		composer: () => composer,
		controls,
		reads,
		waitFor,
		expectKind,
		verdictApplied,
		refresh,
		query,
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
		await surface.verdictApplied();
		/*
		 * THE ANSWER IS ASSERTED TO HAVE LANDED, not assumed (agent review round
		 * 1, M-2). Waiting on the request left this reading the render from before
		 * the response arrived, where every verdict renders `hidden` - so the test
		 * passed on a hook whose decision was reversed. Naming the applied value
		 * here is what makes the silence below a fact about THIS verdict.
		 */
		assert.deepEqual(
			surface.query()?.data?.radient_login ?? "absent",
			verdict,
			`the ${JSON.stringify(verdict)} verdict must have been applied before its silence is asserted`,
		);
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
	await surface.verdictApplied();
	assert.equal(
		surface.query()?.status,
		"error",
		"the read must have been answered with its failure before silence is asserted",
	);
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
	/*
	 * The in-flight copy, and both halves of it are load-bearing: the connector
	 * sentence says what happens next (design round 1's D5 wanted ONE sentence
	 * for that one event, and it now lives here rather than being restated in
	 * the raised state), and the unfinished-attempt clause is what actually ends
	 * the wait - about five minutes on the browser leg's own bound, well before
	 * the operation's 900 s (UX round 1, U4).
	 */
	assert.match(
		surface.text(),
		/The connector restarts on its own once the sign-in completes/,
	);
	assert.match(
		surface.text(),
		/an attempt left unfinished ends after a few minutes/,
	);

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
	/*
	 * AND IT OWES THE USER A POINTER AND AN EXIT (agent review round 1, M-1 and
	 * UX round 1, N2). The sentence names an action this surface cannot take -
	 * it only knows how to cancel a flow IT started - and nothing cleared the
	 * phase, so this block used to be a standing sentence with no control at
	 * all, reachable by pressing this button after starting a sign-in in
	 * Settings, which posts the same `auth.start`.
	 *
	 * The pointer names the PLACE and not the verb (UX round 2, N6): the backend's
	 * own sentence immediately above it already says what to do, and repeating
	 * that instruction on the next line read as one instruction said twice.
	 */
	assert.match(
		surface.text(),
		/Settings, under Providers, is where it can be cleared\./,
	);
	/*
	 * AND IT IS A WARNING, NOT A DANGER (UX round 1, N1): nothing failed here -
	 * the user pressed an action the machine refused because another flow holds
	 * the loopback port, which is a state this surface cannot clear and the user
	 * did not cause.
	 */
	assert.match(
		surface.variant(),
		/bg-warning-wash/,
		"a refusal this surface cannot clear is the mild severity, not danger",
	);
	assert.doesNotMatch(surface.variant(), /bg-danger-wash/);
	assert.equal(
		surface.controls("Dismiss").length,
		1,
		"a refusal with no retry must not be a standing block with no control",
	);
	await surface.close();
});

test("a refused sign-in is dismissed, and the verdict is what speaks after it", async () => {
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
	await surface.press("Dismiss");
	/*
	 * The dispelled block is the operation's memory, not the verdict: the login
	 * is still dead, so the surface falls back to the state that can be acted
	 * on rather than to silence. `dismiss()` deliberately does not reach the
	 * other flow - that one holds the machine's one loopback port.
	 */
	await surface.expectKind("needs-sign-in");
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	await surface.close();
});

test("a settled phase never outlives the verdict it reports: a failure", async () => {
	/*
	 * Agent review round 1, M-1. The phase was returned before the verdict gate
	 * and nothing cleared it but a further start()/cancel(), so a failed flow
	 * kept a stale "Sign-in failed" line - with a retry - on screen over a login
	 * that had healed, which is a false positive of exactly the class this
	 * surface exists to remove.
	 */
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");
	surface.state.operation = operation({
		state: "failed",
		message: "Sign-in failed. Check the provider and try again.",
	});
	await surface.expectKind("settled");
	assert.match(
		surface.text(),
		/Sign-in failed\. Check the provider and try again\./,
	);

	// The login heals out of band; the next read is the truth about it.
	surface.state.verdict = HEALTHY;
	await surface.refresh();
	await surface.expectKind("hidden");
	assert.equal(surface.text(), "");
	await surface.close();
});

test("a settled phase never outlives the verdict it reports: a refusal", async () => {
	/*
	 * The case the round photographed as a DEAD END: the 409 refusal keeps no
	 * retry, so with the phase unconditional the block had no control and no way
	 * out while the verdict stopped demanding anything at all.
	 */
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

	surface.state.verdict = HEALTHY;
	await surface.refresh();
	await surface.expectKind("hidden");
	assert.equal(surface.text(), "");
	await surface.close();
});

test("a retryable failure keeps the action and no dismissal", async () => {
	const surface = await mount();
	await surface.expectKind("needs-sign-in");
	await surface.press("Sign in to Radient");
	await surface.expectKind("signing-in");
	surface.state.operation = operation({
		state: "failed",
		message: "Sign-in failed. Check the provider and try again.",
	});
	await surface.expectKind("settled");
	assert.equal(surface.controls("Sign in to Radient").length, 1);
	assert.equal(
		surface.controls("Dismiss").length,
		0,
		"a dismissal would hide the one control that can clear a failure",
	);
	/*
	 * AND A FAILURE OF AN ACTION THE USER TOOK IS THE LOUD SEVERITY (UX round 1,
	 * N1, pinned here by agent review round 2's MINOR-2): without this the mapping
	 * could be flipped - a failure rendered as the benign amber warning and a
	 * refusal as danger - with every other test in this file still green.
	 */
	assert.match(surface.variant(), /bg-danger-wash/);
	assert.doesNotMatch(surface.variant(), /bg-warning-wash/);
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
	// A finished attempt is a failure of the user's own action, like the failure
	// above, so it is the loud severity too (UX round 1, N1).
	assert.match(surface.variant(), /bg-danger-wash/);
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

test("a control that unmounts hands focus back to the composer, not to `<body>`", async () => {
	/*
	 * UX round 2's U7, in the four transitions that round measured. The block sits
	 * ABOVE the box, so `Shift+Tab` is the only cheap direction and a control
	 * REMOVED under the user drops focus to `<body>` with its replacement 35 Tab
	 * stops forward instead. Each case below focuses the control the keyboard path
	 * reaches, activates it, and reads where focus landed.
	 *
	 * The composer stand-in is the harness's own focusable div, wired exactly as
	 * `message-input.tsx` wires its textarea - the shipped property, not a second
	 * one.
	 *
	 * WHAT IS IN THE FAILURE MESSAGES, AND WHY IT IS A TAG NAME (measured while
	 * proving this test can fail). `assert.equal(document.activeElement, node)`
	 * reads well and is a trap: on failure the assertion builds its message with
	 * `util.inspect`, and a jsdom element carries React's fiber tree as own
	 * properties - so the message renders the node, and with the restore below
	 * removed the run never reported the failure at all (the assertion fired and
	 * the process sat until a 200 s bound killed it, printing no `fail` line for CI
	 * to read). Identity compared as a boolean, and the tag name in the message,
	 * says everything a reader needs for free.
	 */
	const activeTag = () =>
		document.activeElement?.tagName?.toLowerCase() ?? "none";
	const focusAndPress = async (surface, label) => {
		await surface.waitFor(
			() => surface.controls(label).length > 0,
			`the "${label}" control`,
		);
		const [target] = surface.controls(label);
		await act(async () => {
			target.focus();
		});
		assert.ok(
			document.activeElement === target,
			`this case only means something if "${label}" really held focus, and it is on <${activeTag()}>`,
		);
		await surface.press(label);
	};

	/*
	 * EVERY MOUNT IS CLOSED IN A `finally`: this test asserts the ABSENCE of a
	 * focus move, so the failing path is the one that must still clean up after
	 * itself rather than leaving a jsdom window and a mounted root behind.
	 */
	const surfaces = [];
	const open = async (world) => {
		const surface = await mount(world);
		surfaces.push(surface);
		return surface;
	};
	try {
		// 1. The action: the flow starts and the action is replaced by Cancel.
		const started = await open();
		await started.expectKind("needs-sign-in");
		await focusAndPress(started, "Sign in to Radient");
		await started.expectKind("signing-in");
		assert.ok(
			document.activeElement === started.composer(),
			`the press must leave focus on the composer, not on <${activeTag()}>`,
		);

		// 2. Cancel: the block returns to its own action.
		await focusAndPress(started, "Cancel");
		await started.expectKind("needs-sign-in");
		assert.ok(document.activeElement === started.composer());

		// 3. Dismiss: the refusal's exit, on the state that is a dead end without it.
		const refused = await open({
			start: {
				status: 409,
				body: {
					detail: "A sign-in is already active. Finish or cancel it first.",
				},
			},
		});
		await refused.expectKind("needs-sign-in");
		await refused.press("Sign in to Radient");
		await refused.expectKind("settled");
		await focusAndPress(refused, "Dismiss");
		await refused.expectKind("needs-sign-in");
		assert.ok(document.activeElement === refused.composer());

		/*
		 * 4. The block clearing on its own: no press is involved, so this is the
		 * case only the effect can catch - the sign-in completes elsewhere and the
		 * control the user was on is removed by the verdict arriving.
		 */
		const cleared = await open();
		await cleared.expectKind("needs-sign-in");
		await act(async () => {
			cleared.controls("Sign in to Radient")[0].focus();
		});
		cleared.state.verdict = HEALTHY;
		await cleared.refresh();
		await cleared.expectKind("hidden");
		assert.equal(cleared.text(), "");
		assert.ok(
			document.activeElement === cleared.composer(),
			`a block that clears under the user must hand focus back as well, not to <${activeTag()}>`,
		);
	} finally {
		for (const surface of surfaces) await surface.close();
	}
});
