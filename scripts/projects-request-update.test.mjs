import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * "REQUEST UPDATE" (PR-B): the frozen copy, the shared window, and the two
 * doors' components - executable.
 *
 * WHAT THIS FILE PINS, and why each half is shaped the way it is:
 *
 *  1. THE COPY (pure). Every sentence in the frozen set is composed by
 *     `request-update.ts` as a function of the wire answer, so the strings a
 *     reviewer reads in a frame and the strings pinned here are the same code.
 *     Covered: success (both counts), the partial card with its failed clause
 *     AND its unconfirmed clause (the UX freeze's U1: "could not be confirmed"
 *     is never collapsed into "could not be reached"), the all-failed
 *     sentence, its never-started variant, the all-unconfirmed sentence, the
 *     empty line, the cooldown sentence, durations, and the name cap
 *     ("A, B and 2 more").
 *
 *  2. THE FLOW (jsdom, the REAL module, a stubbed transport + a recording
 *     toast channel). One press sends ONE op; a press inside the window sends
 *     NOTHING and answers with the cooldown sentence; the window arms on
 *     delivered>=1 OR unconfirmed>=1 and NOT on a full refusal; the route's
 *     own cooldown answer re-arms the map; a route failure keeps the
 *     uncertainty and leaves the user free to retry.
 *
 *  3. THE COMPONENTS (jsdom, the SHIPPED button; the board's menu item is
 *     pinned structurally). The button is mounted with and without the
 *     capability key (the gate), and driven idle -> sending -> cooling:
 *     `aria-busy` while pending, `Requested` + `aria-disabled` (and NEVER the
 *     `disabled` attribute) while cooling, focus surviving the whole cycle,
 *     and `aria-describedby` pointing at the visually-hidden sentence.
 *
 *     THE MENU ITEM IS NOT OPENED HERE, DELIBERATELY. Mounting Radix's portal
 *     under jsdom costs wall time that scales with the machine's load
 *     (`projects-card-click.test.mjs` records 19 s quiet / 216 s at load 148,
 *     and an act() flush that can simply not return); the repo's answer for
 *     these menus is the source-shape assertions below plus the real-browser
 *     story plays, and this file follows it. The menu's runtime behaviour -
 *     including the U5 focus return after a keyboard select - is asserted by
 *     `projects-tab--board-request-update-keyboard`'s play, which runs in a
 *     real browser at every capture and fails the run rather than a frame.
 *
 *  4. THE REPLACE CONTRACT (real sonner, a real container). The stable ids
 *     exist so repeats REPLACE a card instead of stacking; the stub half
 *     asserts the MECHANISM (the same id travels on every repeat), and the
 *     last test asserts the OUTCOME on the shipped container: two presses
 *     inside one window leave exactly ONE card.
 */

// React DOM feature-detects input events at import time, so the document has
// to exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM
		// globals this file needs are the ones already copied above.
	}
}
/*
 * THE EVENT CONSTRUCTORS MUST COME FROM JSDOM'S REALM, not Node's (the
 * `projects-card-click.test.mjs` note): Radix's focus/dismiss layers construct
 * events through the global, and jsdom then refuses its own `dispatchEvent`.
 */
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/* No backend may be reached from a test run; every desktop call is answered by
 * the bridge stub each test installs (or by `hooks` below). */
globalThis.fetch = () =>
	Promise.reject(new Error("no backend in this harness"));
/*
 * TEARDOWN IS REGISTERED ON PROCESS EXIT, NOT VIA `after()`.
 *
 * Measured the hard way: `after()` hooks in this file ran BEFORE the tests that
 * need the DOM and the stub on disk, not after - the flow saw `window` gone and
 * a later bundle build found the stub already unlinked (node:test ran the hooks
 * as soon as the top-level module evaluation suspended, this harness's own
 * reading; see the git history). A `process.on("exit")` handler cannot fire
 * early: it runs once, synchronously, when the process is already done with
 * every test.
 */
process.on("exit", () => {
	try {
		dom.window.close();
	} catch {
		// The window may already be torn down by a completed run.
	}
});

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

/* ------------------------------------------------------------ the fixtures */

/** One projects row, the fields the board and the detail read. */
const PROJECT = {
	id: "p1",
	name: "payments-migration",
	description: "Cut the payments API over to the new service",
	owner: "atlas",
	team: "platform",
	title: "Payments migration",
	status: "active",
	tags: [],
	start_date: "2026-09-01",
	target_date: "2026-10-15",
	completed_at: null,
	estimate: 13,
	estimate_unit: "points",
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 3,
	live_sessions: 1,
	progress_stale: false,
	progress_updated_at: null,
	updated_at: 1757800000,
};

/** One `projects.request_update` session row. */
const session = (session_id, title, outcome, detail = "") => ({
	session_id,
	title,
	outcome,
	detail,
});

/** The answer a `sent` batch of `sessions` would carry. */
const sentAnswer = (sessions) => ({
	project: { id: "p1", key: "payments-migration", title: "Payments migration" },
	state: "sent",
	requested_at: new Date().toISOString(),
	cooldown_remaining_s: null,
	counts: {
		total: sessions.length,
		delivered: sessions.filter((row) => row.outcome === "delivered").length,
		unconfirmed: sessions.filter((row) => row.outcome === "unconfirmed").length,
		failed: sessions.filter((row) => row.outcome === "failed").length,
	},
	sessions,
});

/* ---------------------------------------------------- bundle: the pure model */

const modelBundle = await build({
	stdin: {
		contents:
			'export * as model from "./src/renderer/src/features/projects/request-update";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	/* The request-update model reads the i18n locale layer (@shared/i18n),
	 * whose shim reaches src/i18n by relative path — only the @shared alias
	 * is needed here (the `turn-timestamp.test.mjs` recipe). */
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const { model } = await import(
	`data:text/javascript;base64,${Buffer.from(modelBundle.outputFiles[0].text).toString("base64")}`
);

const display = "Payments migration";

test("the success card counts sessions, with the D=1 singular", () => {
	const three = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "delivered"),
			session("b", "Two", "delivered"),
			session("c", "Three", "delivered"),
		]),
	);
	assert.equal(
		three.title,
		"Requested updates from 3 sessions on Payments migration.",
	);
	assert.equal(three.variant, "success");
	assert.equal(
		three.duration,
		undefined,
		"success rides the container default",
	);
	const one = model.requestUpdateResultToast(
		sentAnswer([session("a", "One", "delivered")]),
	);
	assert.equal(
		one.title,
		"Requested an update from 1 session on Payments migration.",
	);
});

test("the partial card names failures and unconfirmed deliveries in their own clauses", () => {
	const card = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "Payments cutover", "delivered"),
			session("d", "Old cutover notes", "failed", "stale"),
			session("e", "API parity checks", "unconfirmed"),
		]),
	);
	assert.equal(card.variant, "warning");
	assert.equal(
		card.duration,
		Number.POSITIVE_INFINITY,
		"a partial result persists until dismissed",
	);
	assert.equal(
		card.title,
		"Requested updates from 1 of 3 sessions on Payments migration. Old cutover notes could not be reached. Delivery to API parity checks could not be confirmed.",
	);
});

test("the failure clause caps names at two and counts the rest", () => {
	const card = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "delivered"),
			session("b", "Two", "failed", "stale"),
			session("c", "Three", "failed", "stale"),
			session("d", "Four", "failed", "stale"),
			session("e", "Five", "failed", "stale"),
		]),
	);
	assert.ok(
		card.title.includes("Two, Three and 2 more could not be reached."),
		card.title,
	);
});

test("a full refusal is the all-failed sentence; a session with no title reads as its id", () => {
	const card = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "failed", "stale"),
			session("b", null, "failed", "no longer exists"),
		]),
	);
	assert.equal(card.variant, "error");
	assert.equal(
		card.duration,
		Number.POSITIVE_INFINITY,
		"an all-failed result persists until dismissed",
	);
	assert.equal(
		card.title,
		"Could not reach any of the 2 linked sessions on Payments migration.",
	);
});

test("an unengaged-only batch gets the never-started sentence, matched on the backend's own detail", () => {
	const card = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "failed", model.REQUEST_UPDATE_NEVER_STARTED_DETAIL),
			session("b", "Two", "failed", model.REQUEST_UPDATE_NEVER_STARTED_DETAIL),
		]),
	);
	assert.equal(
		card.title,
		"The 2 linked sessions have not started yet — they become recipients after their first message.",
	);
	/* The ONE-link batch reads singular (frozen copy, backend QA round). */
	const single = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "failed", model.REQUEST_UPDATE_NEVER_STARTED_DETAIL),
		]),
	);
	assert.equal(
		single.title,
		"The linked session has not started yet — it becomes a recipient after its first message.",
	);
	/* ONE non-never-started failure collapses the variant back to the generic
	 * sentence - a batch where any session refused for another reason is not
	 * "not started". */
	const mixed = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "failed", model.REQUEST_UPDATE_NEVER_STARTED_DETAIL),
			session("b", "Two", "failed", "stale"),
		]),
	);
	assert.equal(
		mixed.title,
		"Could not reach any of the 2 linked sessions on Payments migration.",
	);
});

test("an all-unconfirmed batch keeps the uncertainty, and a mixed zero-delivery batch says both", () => {
	const card = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "unconfirmed"),
			session("b", "Two", "unconfirmed"),
		]),
	);
	assert.equal(
		card.title,
		"Could not confirm delivery on Payments migration — the requests may still reach its sessions.",
	);
	assert.equal(card.duration, Number.POSITIVE_INFINITY);
	const mixed = model.requestUpdateResultToast(
		sentAnswer([
			session("a", "One", "failed", "stale"),
			session("b", "Two", "unconfirmed"),
		]),
	);
	assert.equal(
		mixed.title,
		"Could not reach 1 of the 2 linked sessions on Payments migration. Delivery to Two could not be confirmed.",
	);
});

test("the empty and cooldown answers carry the frozen lines and a ~6 s lifetime", () => {
	const empty = model.requestUpdateResultToast({
		project: {
			id: "p1",
			key: "payments-migration",
			title: "Payments migration",
		},
		state: "empty",
		requested_at: null,
		cooldown_remaining_s: null,
		counts: { total: 0, delivered: 0, unconfirmed: 0, failed: 0 },
		sessions: [],
	});
	assert.equal(
		empty.title,
		"No linked sessions to ask. Link a session to Payments migration first.",
	);
	assert.equal(empty.duration, model.REQUEST_UPDATE_TOAST_DURATION_MS);

	const cold = model.requestUpdateResultToast({
		project: {
			id: "p1",
			key: "payments-migration",
			title: "Payments migration",
		},
		state: "cooldown",
		requested_at: null,
		cooldown_remaining_s: 40,
		counts: { total: 0, delivered: 0, unconfirmed: 0, failed: 0 },
		sessions: [],
	});
	assert.equal(
		cold.title,
		"Update already requested 20 s ago on Payments migration. Try again in 40 s.",
	);
	/* The sentence is the window minus the remainder on BOTH paths: the two
	 * numbers always sum to 60 s. */
	assert.equal(
		model.requestUpdateCooldownSentence(display, 1000),
		"Update already requested 59 s ago on Payments migration. Try again in 1 s.",
	);
	assert.equal(
		model.requestUpdateCooldownSentence(display, 60_000),
		"Update already requested 0 s ago on Payments migration. Try again in 60 s.",
	);
});

test("the stable ids are per project and distinct per card kind", () => {
	assert.equal(model.requestUpdateToastId("p1"), "project-request-update-p1");
	assert.equal(
		model.requestUpdateCooldownToastId("p1"),
		"project-request-cooldown-p1",
	);
	assert.notEqual(
		model.requestUpdateToastId("p1"),
		model.requestUpdateCooldownToastId("p1"),
	);
});

/* ------------------------------------------------------- bundle: the flow */

/*
 * The toast channel is REPLACED, not re-implemented: the recording stub keeps
 * every call's kind, message, id and duration, which is what the duration and
 * replace contracts are asserted on. The flow module itself is the real one
 * (`use-request-update.ts`), and the transport under it is the bridge each
 * test installs.
 */
const toastStubPath = new URL(
	`./_request-update-toasts-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	toastStubPath,
	`export const toastCalls = [];
const record = (kind) => (message, options) => {
	toastCalls.push({ kind, message, id: options?.id, duration: options?.duration });
	return (options?.id ?? toastCalls.length);
};
export const showSuccessToast = record("success");
export const showWarningToast = record("warning");
export const showErrorToast = record("error");
export const replaceErrorToast = record("error");
export const showInfoToast = record("info");
export const showLoadingToast = record("loading");
export const dismissToast = () => {};
`,
);
process.on("exit", () => {
	try {
		unlinkSync(toastStubPath.pathname);
	} catch {
		// already gone
	}
});

const flowBundle = await build({
	stdin: {
		contents: `
			export { sendRequestUpdate } from "./src/renderer/src/features/projects/hooks/use-request-update";
			export { armRequestUpdateCooldown, requestUpdateCooldown, resetRequestUpdateState, requestUpdateCooldownToastId } from "./src/renderer/src/features/projects/request-update";
			export { toastCalls } from "@shared/utils/toast-manager";
		`,
		resolveDir: ROOT,
		sourcefile: "request-update-flow.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared/utils/toast-manager": toastStubPath.pathname,
	},
	write: false,
});
await writeFile(
	new URL(`./_request-update-flow-${process.pid}.mjs`, import.meta.url),
	flowBundle.outputFiles[0].text,
);
const flowPath = new URL(
	`./_request-update-flow-${process.pid}.mjs`,
	import.meta.url,
);
const flow = await import(flowPath.href);

const TARGET = {
	id: "p1",
	name: "payments-migration",
	title: "Payments migration",
};

/** Install a bridge that answers capabilities + one scripted request_update. */
const installBridge = (features, handler) => {
	const calls = { requestUpdate: 0, keys: [] };
	dom.window.api = {
		desktop: {
			request: async (request) => {
				if (request.op === "capabilities") {
					return {
						status: 200,
						body: {
							result: {
								desktop_contract: 1,
								desktop_available: true,
								desktop_auth: "bearer",
								features,
							},
						},
					};
				}
				if (request.op === "projects.request_update") {
					calls.requestUpdate += 1;
					calls.keys.push(request.key);
					return handler(request);
				}
				throw new Error(`unexpected op: ${request.op}`);
			},
		},
	};
	return calls;
};

const ok = (payload) => ({ status: 200, body: { result: payload } });

process.on("exit", () => {
	try {
		unlinkSync(flowPath.pathname);
	} catch {
		// already gone
	}
});

test("one press sends one op with the row's key, and the loading card waits for the 400 ms mark", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	let resolveAnswer;
	const calls = installBridge(
		{ projects: 1, projects_request_update: 1 },
		() =>
			new Promise((resolve) => {
				resolveAnswer = () =>
					resolve(ok(sentAnswer([session("a", "One", "delivered")])));
			}),
	);
	const pending = flow.sendRequestUpdate(TARGET);
	/* A second press while the first is in flight dials NOTHING and answers
	 * with the loading card on the stable id (UX round 1, U3) - it is the
	 * feedback the board door lacked; the FIRST press's own 400 ms card has
	 * not appeared yet, so the one recorded call is the re-press's. */
	await flow.sendRequestUpdate(TARGET);
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(calls.requestUpdate, 1, "one press, one op");
	assert.equal(calls.keys[0], "p1");
	const early = flow.toastCalls.filter((call) => call.kind === "loading");
	assert.equal(
		early.length,
		1,
		"the in-flight re-press raises the loading card",
	);
	assert.equal(early[0].id, "project-request-update-p1");
	resolveAnswer();
	await pending;
	const result = flow.toastCalls.filter((call) => call.kind === "success");
	assert.equal(result.length, 1);
	assert.equal(
		result[0].id,
		"project-request-update-p1",
		"the result carries the stable per-project id",
	);
	/* The window is armed: a second press inside it sends NOTHING and answers
	 * with the cooldown sentence. */
	const before = calls.requestUpdate;
	await flow.sendRequestUpdate(TARGET);
	assert.equal(
		calls.requestUpdate,
		before,
		"a press inside the window dials nothing",
	);
	const info = flow.toastCalls.filter((call) => call.kind === "info");
	assert.equal(info.length, 1);
	assert.match(
		info[0].message,
		/^Update already requested \d+ s ago on Payments migration\. Try again in \d+ s\.$/,
	);
	assert.equal(info[0].id, "project-request-cooldown-p1");
	assert.equal(info[0].duration, model.REQUEST_UPDATE_TOAST_DURATION_MS);
});

test("a slow answer shows the loading card first and the result REPLACES it on the same id", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	let resolveAnswer;
	installBridge(
		{ projects: 1, projects_request_update: 1 },
		() =>
			new Promise((resolve) => {
				resolveAnswer = () =>
					resolve(ok(sentAnswer([session("a", "One", "delivered")])));
			}),
	);
	const pending = flow.sendRequestUpdate(TARGET);
	/* Past the 400 ms mark: the loading card exists and carries the stable id. */
	await new Promise((resolve) => setTimeout(resolve, 450));
	const loading = flow.toastCalls.filter((call) => call.kind === "loading");
	assert.equal(loading.length, 1);
	assert.equal(loading[0].message, model.REQUEST_UPDATE_LOADING_COPY);
	assert.equal(loading[0].id, "project-request-update-p1");
	resolveAnswer();
	await pending;
	const success = flow.toastCalls.filter((call) => call.kind === "success");
	assert.equal(success.length, 1);
	assert.equal(
		success[0].id,
		loading[0].id,
		"the result replaces the card it supersedes (one id, in place)",
	);
	/* And a fast answer never flashes one at all: the first test's 50 ms check,
	 * stated here as the rule it belongs to. */
});

test("the window arms on delivered>=1 OR unconfirmed>=1, and not on a full refusal", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	installBridge({ projects: 1, projects_request_update: 1 }, () =>
		ok(sentAnswer([session("a", "One", "failed", "stale")])),
	);
	await flow.sendRequestUpdate(TARGET);
	assert.equal(
		flow.requestUpdateCooldown("p1"),
		undefined,
		"an all-refused batch leaves the user free to retry",
	);

	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	installBridge({ projects: 1, projects_request_update: 1 }, () =>
		ok(sentAnswer([session("a", "One", "unconfirmed")])),
	);
	await flow.sendRequestUpdate(TARGET);
	assert.notEqual(
		flow.requestUpdateCooldown("p1"),
		undefined,
		"an unconfirmed delivery is treated as potentially arrived and cools the window",
	);
});

test("the route's own cooldown answer re-arms the shared window", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	installBridge({ projects: 1, projects_request_update: 1 }, () =>
		ok({
			project: {
				id: "p1",
				key: "payments-migration",
				title: "Payments migration",
			},
			state: "cooldown",
			requested_at: new Date().toISOString(),
			cooldown_remaining_s: 40,
			counts: { total: 0, delivered: 0, unconfirmed: 0, failed: 0 },
			sessions: [],
		}),
	);
	await flow.sendRequestUpdate(TARGET);
	const info = flow.toastCalls.filter((call) => call.kind === "info");
	assert.equal(
		info[0].message,
		"Update already requested 20 s ago on Payments migration. Try again in 40 s.",
	);
	const window = flow.requestUpdateCooldown("p1");
	assert.ok(window, "the map is armed from the server's numbers");
	assert.ok(
		window.untilMs - Date.now() > 30_000,
		"the remainder is the server's, not a fresh 60 s",
	);
});

test("a route failure keeps the uncertainty, persists, and leaves the window unarmed", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	installBridge({ projects: 1, projects_request_update: 1 }, () => ({
		status: 500,
		body: { detail: "the server could not be reached" },
	}));
	await flow.sendRequestUpdate(TARGET);
	const error = flow.toastCalls.filter((call) => call.kind === "error");
	assert.equal(error.length, 1);
	assert.equal(
		error[0].message,
		"Could not request updates: the server could not be reached.",
	);
	assert.equal(error[0].duration, Number.POSITIVE_INFINITY);
	assert.equal(flow.requestUpdateCooldown("p1"), undefined);
});

test("a second press while the first is dialling answers on the board, not silence", async () => {
	flow.resetRequestUpdateState();
	flow.toastCalls.length = 0;
	let resolveAnswer;
	const calls = installBridge(
		{ projects: 1, projects_request_update: 1 },
		() =>
			new Promise((resolve) => {
				resolveAnswer = () =>
					resolve(ok(sentAnswer([session("a", "One", "delivered", "")])));
			}),
	);
	const first = flow.sendRequestUpdate(TARGET);
	await flow.sendRequestUpdate(TARGET);
	/*
	 * The in-flight press must SAY something (UX round 1, U3): the detail door
	 * shows Requesting…, the board door has no per-card state, so the loading
	 * card on the stable id is the feedback - and no second dial may leave.
	 */
	const loading = flow.toastCalls.filter((call) => call.kind === "loading");
	assert.equal(
		loading.length,
		1,
		"the in-flight press raises the loading card",
	);
	assert.equal(
		loading[0].id,
		"project-request-update-p1",
		"the same stable id a pending card sits at, so a repeat replaces",
	);
	assert.equal(calls.requestUpdate, 1, "still exactly one dial");
	resolveAnswer();
	await first;
});

/* ------------------------------------------- bundle: the shipped components */

/*
 * The button is mounted twice (gate off, gate on) and driven through its three
 * states; the board mounts for the structural assertions only. Radix's portal
 * is what the header comment above the file explains this file does NOT open.
 */
const componentBundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { createRoot } from "react-dom/client";
			import {
				QueryClient,
				QueryClientProvider,
			} from "@tanstack/react-query";
			import { MemoryRouter } from "react-router-dom";
			import { ProjectBoard } from "./src/renderer/src/features/projects/components/project-board";
			import { ProjectRequestUpdateButton } from "./src/renderer/src/features/projects/components/project-request-update-button";

			const PROJECT = ${JSON.stringify(PROJECT)};

			export function mountButton(container, project = PROJECT) {
				const client = new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				});
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(
							MemoryRouter,
							null,
							createElement(ProjectRequestUpdateButton, { project }),
						),
					),
				);
				return { root, client };
			}

			export { toastCalls } from "@shared/utils/toast-manager";

			export function mountBoard(container) {
				const client = new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				});
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(
							MemoryRouter,
							null,
							createElement(ProjectBoard, {
								projects: [PROJECT],
								nowMs: ${PROJECT.updated_at * 1000},
								onOpen: () => {},
								onEdit: () => {},
								onDelete: () => {},
								onMove: () => {},
								movingKeys: [],
							}),
						),
					),
				);
				return { root, client };
			}
		`,
		resolveDir: ROOT,
		sourcefile: "request-update-components.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared/utils/toast-manager": toastStubPath.pathname,
	},
	write: false,
});
const componentsPath = new URL(
	`./_request-update-components-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(componentsPath, componentBundle.outputFiles[0].text);
const components = await import(componentsPath.href);

/* ------------------------------------------- probe: the button's tooltip prop */

/*
 * THE TOOLTIP'S CONTENT, PINNED AT THE PROP. Radix renders the content only
 * while the tooltip is open, and re-opening it in jsdom re-runs the slow
 * Floating settle (measured ~1.5 min for one reopened tooltip in this file),
 * so the cooling-state assertion lives here instead: the app's `Tooltip` is
 * replaced by a recorder and the REAL button's prop is read across states.
 * The idle state is also asserted on the real Radix tooltip in the three-states
 * test, so the recorder never stands in for the shipped widget wholesale.
 */
const uiStubPath = new URL(
	`./_request-update-ui-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(
	uiStubPath,
	`import { createElement } from "react";
export const tooltipContents = [];
export const Button = (props) => {
	const { children, ...rest } = props;
	return createElement("button", { type: "button", ...rest }, children);
};
export const Tooltip = ({ content, children }) => {
	tooltipContents.push(content);
	return createElement("div", null, children);
};
`,
);
process.on("exit", () => {
	try {
		unlinkSync(uiStubPath.pathname);
	} catch {
		// already gone
	}
});

const probeBundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { createRoot } from "react-dom/client";
			import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			import { MemoryRouter } from "react-router-dom";
			import { ProjectRequestUpdateButton } from "./src/renderer/src/features/projects/components/project-request-update-button";
			export { armRequestUpdateCooldown, resetRequestUpdateState } from "./src/renderer/src/features/projects/request-update";
			export { tooltipContents } from "@shared/components/ui";

			export function mount(container, project) {
				const client = new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				});
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(
							MemoryRouter,
							null,
							createElement(ProjectRequestUpdateButton, { project }),
						),
					),
				);
				return { root, client };
			}
		`,
		resolveDir: ROOT,
		sourcefile: "request-update-tooltip-probe.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@shared/components/ui": uiStubPath.pathname,
	},
	write: false,
});
const probePath = new URL(
	`./_request-update-probe-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(probePath, probeBundle.outputFiles[0].text);
const probe = await import(probePath.href);
process.on("exit", () => {
	try {
		unlinkSync(probePath.pathname);
	} catch {
		// already gone
	}
});
process.on("exit", () => {
	try {
		unlinkSync(componentsPath.pathname);
	} catch {
		// already gone
	}
});

const flush = async () => {
	await act(async () => {});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

test("the button is mounted only when the capability is advertised", async () => {
	flow.resetRequestUpdateState();
	installBridge({ projects: 1 }, () => ok(sentAnswer([])));
	const host = document.createElement("div");
	document.body.append(host);
	const handle = await act(() =>
		components.mountButton(host, {
			id: "p1",
			name: "payments-migration",
			title: "Payments migration",
		}),
	);
	await flush();
	assert.equal(
		host.querySelector('[data-tour-tag="project-request-update"]'),
		null,
		"no capability, no button - not a disabled one",
	);
	await act(() => handle.root.unmount());
	handle.client.clear();
	host.remove();
});

test("the button's three states: idle, sending (aria-busy), cooling (Requested + aria-disabled, never disabled)", async () => {
	flow.resetRequestUpdateState();
	/*
	 * The BUTTON drives the components bundle's own inlined copies of the
	 * flow and the recording stub (esbuild inlines an aliased module per
	 * bundle), so this test reads `components.toastCalls` - the flow bundle's
	 * array would stay empty for a button-driven press.
	 */
	components.toastCalls.length = 0;
	let resolveAnswer;
	const calls = installBridge(
		{ projects: 1, projects_request_update: 1 },
		() =>
			new Promise((resolve) => {
				resolveAnswer = () =>
					resolve(
						ok(sentAnswer([session("a", "Payments cutover", "delivered")])),
					);
			}),
	);
	const host = document.createElement("div");
	document.body.append(host);
	const handle = await act(() =>
		components.mountButton(host, {
			id: "p1",
			name: "payments-migration",
			title: "Payments migration",
		}),
	);
	await flush();
	const button = () =>
		host.querySelector('[data-tour-tag="project-request-update"]');
	assert.ok(button(), "the gate is open and the button is mounted");
	assert.equal(button().textContent, "Request update", "idle label");
	assert.equal(button().getAttribute("aria-busy"), null);
	assert.equal(button().getAttribute("aria-disabled"), null);
	assert.ok(
		button().className.includes("min-w-37"),
		"the one-width floor keeps all three labels in one box",
	);

	/*
	 * Focus, then press: the press must not cost the caret.
	 *
	 * THE FIRST ACT AFTER FOCUS IS SLOW ONCE (~10-18 s measured). Focusing the
	 * trigger opens the app's Tooltip, and the open-and-position settle of
	 * Radix/Floating runs through that one act; the second act is milliseconds,
	 * so it is a one-time jsdom cost, not an unresolved loop - a real browser
	 * settles it in a frame. Nothing here waits on it, and the assertion below
	 * runs after it, on the settled tree.
	 */
	await act(() => button().focus());
	assert.equal(
		document.activeElement,
		button(),
		"the harness focused the button",
	);
	/* U2's idle half: the open tooltip carries the invitation. */
	const idleTip = document.querySelector('[role="tooltip"]');
	assert.ok(idleTip, "focusing the trigger opens the tooltip");
	assert.equal(idleTip.textContent, model.REQUEST_UPDATE_TOOLTIP);
	await act(() => button().click());
	assert.equal(button().textContent, "Requesting…", "the sending label");
	assert.equal(button().getAttribute("aria-busy"), "true");
	assert.equal(
		button().hasAttribute("disabled"),
		false,
		"never the disabled attribute - focus survives",
	);
	assert.equal(
		document.activeElement,
		button(),
		"focus survives the pending state",
	);
	assert.ok(calls.requestUpdate === 1, "the press sent exactly one op");

	resolveAnswer();
	await flush();
	assert.equal(button().textContent, "Requested", "the cooling label");
	assert.equal(button().getAttribute("aria-disabled"), "true");
	assert.equal(button().getAttribute("aria-busy"), null);
	assert.equal(button().hasAttribute("disabled"), false);
	assert.equal(document.activeElement, button(), "focus survives the cooldown");
	const describedBy = button().getAttribute("aria-describedby");
	assert.ok(describedBy, "the cooling button is described by the sentence");
	const sentence = host.querySelector(`#${describedBy}`);
	assert.ok(sentence, "the described element is in the tree");
	assert.match(
		sentence.textContent,
		/^Update already requested \d+ s ago on Payments migration\. Try again in \d+ s\.$/,
	);
	/* U2's cooling half is pinned at the prop level by the dedicated probe
	 * below ("the tooltip's content follows the button's state"): re-opening
	 * Radix's tooltip here would re-run the slow Floating settle, which is not
	 * a cost this suite should pay twice. */
	/* A press while cooling explains itself and sends nothing new. */
	await act(() => button().click());
	assert.equal(calls.requestUpdate, 1, "no second dial from the button");
	const info = components.toastCalls.filter((call) => call.kind === "info");
	assert.equal(info.length, 1, "the press answered with the cooldown sentence");

	await act(() => handle.root.unmount());
	handle.client.clear();
	host.remove();
});

test("the tooltip's content follows the button's state (U2)", async () => {
	probe.resetRequestUpdateState();
	probe.tooltipContents.length = 0;
	installBridge({ projects: 1, projects_request_update: 1 }, () => ok({}));
	const host = document.createElement("div");
	document.body.append(host);
	const handle = await act(() =>
		probe.mount(host, {
			id: "p1",
			name: "payments-migration",
			title: "Payments migration",
		}),
	);
	await flush();
	assert.equal(
		probe.tooltipContents.at(-1),
		model.REQUEST_UPDATE_TOOLTIP,
		"idle: the tooltip carries the invitation",
	);
	const nowMs = Date.now();
	probe.armRequestUpdateCooldown("p1", nowMs, nowMs + 40_000);
	await flush();
	assert.match(
		probe.tooltipContents.at(-1) ?? "",
		/^Update already requested \d+ s ago on Payments migration\. Try again in \d+ s\.$/,
		"cooling: the tooltip carries the sentence, not the invitation",
	);
	await act(() => handle.root.unmount());
	handle.client.clear();
	host.remove();
	probe.resetRequestUpdateState();
});

test("the board's menu item is wired after Set status, gated on its own key, and enabled", () => {
	const board = readSource(
		"src/renderer/src/features/projects/components/project-board.tsx",
	);
	/*
	 * PLACEMENT, structurally: the item sits between the Set-status submenu and
	 * the separator (the first group), carries no icon, and its `onSelect`
	 * calls the shared action with the row it belongs to. The runtime press is
	 * the keyboard story's play - a real browser, every capture.
	 */
	const sub = board.indexOf("</DropdownMenuSub>");
	const item = board.indexOf("Request update");
	const separator = board.indexOf("<DropdownMenuSeparator />", sub);
	assert.ok(sub !== -1 && item !== -1, "the menu carries the item");
	assert.ok(
		item > sub && separator !== -1 && item < separator,
		"the item is directly after Set status and above the separator",
	);
	assert.ok(
		board.includes("requestUpdateEnabled && (") &&
			board.includes("desktopFeatureEnabled(") &&
			board.includes('"projects_request_update"'),
		"the item is mounted only under its own capability key",
	);
	assert.ok(
		board.includes("onSelect={() => requestUpdate(project)}"),
		"the item calls the shared action with its own row",
	);
	const gate = board.indexOf("{requestUpdateEnabled && (");
	const itemStart = board.indexOf("<DropdownMenuItem", gate);
	const itemEnd = board.indexOf("</DropdownMenuItem>", itemStart);
	assert.ok(itemStart !== -1 && itemEnd !== -1, "the item is mounted");
	const itemJsx = board.slice(itemStart, itemEnd);
	assert.ok(
		itemJsx.includes("Request update"),
		"the item carries the frozen label",
	);
	assert.ok(
		!itemJsx.includes("className") &&
			!itemJsx.includes("Icon") &&
			!itemJsx.includes("<svg"),
		"the item carries no icon and no extra chrome (the label alone, like its siblings)",
	);
});

/* -------------------------------------------- the replace contract, real sonner */

/*
 * The LAST word on the stable ids is the shipped container: two presses inside
 * one window must leave exactly ONE card. This is the one test that mounts the
 * real `ThemedToastContainer` and the whole of sonner, so it drives a queued
 * rendering frame rather than jsdom's (the `undo-toasts.test.mjs` note: a real
 * animation loop would hold the process open).
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
};
const settleFrames = async () => {
	await act(async () => {});
	await act(async () => frame());
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};

const realBundle = await build({
	stdin: {
		contents: `
			export { sendRequestUpdate } from "./src/renderer/src/features/projects/hooks/use-request-update";
			export { armRequestUpdateCooldown, resetRequestUpdateState } from "./src/renderer/src/features/projects/request-update";
			export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";
			export { dismissToast } from "./src/renderer/src/shared/utils/toast-manager";
		`,
		resolveDir: ROOT,
		sourcefile: "request-update-real-toasts.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
	},
	write: false,
});
const realPath = new URL(
	`./_request-update-real-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(realPath, realBundle.outputFiles[0].text);
const real = await import(realPath.href);
process.on("exit", () => {
	try {
		unlinkSync(realPath.pathname);
	} catch {
		// already gone
	}
});

test("two presses inside one window leave ONE card, not a stack", async () => {
	real.resetRequestUpdateState();
	const host = document.createElement("div");
	document.body.append(host);
	const { createRoot } = await import("react-dom/client");
	const reactRoot = createRoot(host);
	await act(() =>
		reactRoot.render(React.createElement(real.ThemedToastContainer, {})),
	);
	await settleFrames();

	const nowMs = Date.now();
	real.armRequestUpdateCooldown("p1", nowMs - 20_000, nowMs + 40_000);
	const target = {
		id: "p1",
		name: "payments-migration",
		title: "Payments migration",
	};
	await act(async () => {
		await real.sendRequestUpdate(target);
	});
	await settleFrames();
	await act(async () => {
		await real.sendRequestUpdate(target);
	});
	await settleFrames();
	assert.equal(
		document.querySelectorAll("[data-sonner-toast]").length,
		1,
		"the second press REPLACED the first card (one window, one card)",
	);
	assert.match(
		document.body.textContent ?? "",
		/Update already requested \d+ s ago on Payments migration\. Try again in \d+ s\./,
	);
	/* Retire the card and unmount so no sonner timer outlives the file. */
	real.dismissToast("project-request-cooldown-p1");
	await settleFrames();
	await act(() => reactRoot.unmount());
	host.remove();
	real.resetRequestUpdateState();
});

test("a repeated route failure never strands the loading card (R1-1)", async () => {
	real.resetRequestUpdateState();
	const host = document.createElement("div");
	document.body.append(host);
	const { createRoot } = await import("react-dom/client");
	const reactRoot = createRoot(host);
	await act(() =>
		reactRoot.render(React.createElement(real.ThemedToastContainer, {})),
	);
	await settleFrames();

	let resolveFailure;
	installBridge(
		{ projects: 1, projects_request_update: 1 },
		() =>
			new Promise((resolve) => {
				resolveFailure = () =>
					resolve({
						status: 500,
						body: { detail: "the server could not be reached" },
					});
			}),
	);
	const target = {
		id: "p1",
		name: "payments-migration",
		title: "Payments migration",
	};
	/*
	 * "LIVE" IS `data-removed !== "true"`, NEVER textContent ALONE. A sonner
	 * card that was dismissed keeps its node (and its text) for the exit
	 * animation; jsdom fires no animationend, so the node survives marked.
	 * Reading textContent alone is exactly how the first version of this test
	 * missed the U6 race (an error card removed ~20 ms after it appeared still
	 * carried its sentence in the DOM), so every presence assertion below
	 * reads LIVE nodes and polls, rather than a single post-settle read.
	 */
	const liveCards = () =>
		Array.from(document.querySelectorAll("[data-sonner-toast]")).filter(
			(node) => node.getAttribute("data-removed") !== "true",
		);
	const strandedSpinner = () =>
		liveCards().some((node) =>
			(node.textContent ?? "").includes("Requesting updates…"),
		);
	const liveCardWith = (text) =>
		liveCards().find((node) => (node.textContent ?? "").includes(text));
	const pollLiveCard = async (text) => {
		for (let i = 0; i < 20; i += 1) {
			if (liveCardWith(text)) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	};

	/* Failure 1, slow enough that the 400 ms loading card is on screen. */
	const first = real.sendRequestUpdate(target);
	await new Promise((resolve) => setTimeout(resolve, 650));
	resolveFailure();
	await first;
	await settleFrames();
	assert.equal(
		strandedSpinner(),
		false,
		"the first failure retired the loading card",
	);
	/* The error card must be LIVE and must STAY live: the raced dismissal
	 * removed it ~20 ms after it appeared, so a single read is not enough -
	 * poll for a second with it present. */
	assert.ok(
		liveCardWith("Could not request updates: the server could not be reached."),
		"the first failure left a LIVE error card",
	);
	await pollLiveCard(
		"Could not request updates: the server could not be reached.",
	);
	assert.ok(
		liveCardWith("Could not request updates: the server could not be reached."),
		"the error card survives past the raced-dismiss window",
	);

	/* Failure 2, same sentence, well inside the manager's 5 s window: the
	 * manager suppresses the error, and the card must STILL be retired - the
	 * exact stranding R1-1 reproduced (red without the dismiss). */
	const second = real.sendRequestUpdate(target);
	await new Promise((resolve) => setTimeout(resolve, 650));
	resolveFailure();
	await second;
	/* The dismissal lands on sonner's own queue: give it its frame and its
	 * no-animationend fallback before reading the card's state in jsdom (the
	 * undo-toasts suite documents the same rAF + 200 ms exit). */
	await settleFrames();
	assert.equal(
		strandedSpinner(),
		false,
		"a repeat failure leaves no stranded Requesting updates… card",
	);
	/* And the repeat must have ANSWERED: the failure replaces the loading
	 * card in place, so a LIVE error card stands again. */
	await pollLiveCard(
		"Could not request updates: the server could not be reached.",
	);
	assert.ok(
		liveCardWith("Could not request updates: the server could not be reached."),
		"the repeat failure's answer card is LIVE",
	);

	/* Retire cards and unmount so no sonner timer outlives the file. */
	real.dismissToast("project-request-update-p1");
	await settleFrames();
	await act(() => reactRoot.unmount());
	host.remove();
	real.resetRequestUpdateState();
});
