import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * "MARK DONE ANYWAY": the pure half of the projects-board status-refusal fix.
 *
 * WHAT THIS FILE PINS, and why each piece is separable from the dialog:
 *
 *  1. THE WIRE. `projects.update` gained an optional TOP-LEVEL `force_done`
 *     (the daemon's escape from the done-gate). It must (a) be rejected inside
 *     `fields` - the strict schema is what keeps a flag about the CALL from
 *     being mistaken for a field of the ROW - and (b) reach the PATCH body only
 *     when TRUE, so every other write is byte-identical to what shipped before
 *     and an older daemon (which 422s an unknown body key) is never sent one.
 *  2. THE CLASSIFIER. The daemon declares the open-milestones refusal with the
 *     machine code `project_done_incomplete` and the names in `incomplete`. The
 *     CODE is what authorises the force offer; a sentence-only match (an older
 *     daemon saying `project_invalid`) is still recognised, so it can be
 *     spoken, but is marked `coded: false` so nothing offers it a force.
 *  3. THE COPY: plural-correct question, the names truncated with "and N more",
 *     the forced-close toast's count read from the PATCH answer's own row.
 *  4. THE RETRY POLICY. A 4xx PATCH is a refusal; sending it twice only delays
 *     the sentence by the backoff. Transport failures keep the single retry.
 *
 * Bundled rather than imported (the `projects-inline-edit.test.mjs` pattern):
 * these are TypeScript modules in the renderer tree.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as model from "./src/renderer/src/features/projects/project-model";',
			'export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract";',
			'export { retryDesktopMutation, retryDesktopQuery } from "./src/renderer/src/shared/api/local-operator/backend-error";',
			'export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";',
			'export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";',
			'export * as move from "./src/renderer/src/features/projects/project-move";',
			'export * as refusals from "./src/renderer/src/features/projects/project-refusals";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
	},
});
const {
	model,
	move,
	refusals,
	desktopRequestSchema,
	desktopEndpoint,
	retryDesktopMutation,
	retryDesktopQuery,
	DesktopControlError,
	defaultQueryOptions,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	doneGateRefusal,
	doneGateSentence,
	doneGateToastCopy,
	doneGateNamesClause,
	forcedCloseToastText,
	refusalCopy,
	PROJECT_DONE_INCOMPLETE_CODE,
	PROJECT_NOT_MOVED_COPY,
} = model;
const { runStatusMove } = move;
const { doneGateRefusalOf, projectGoneError, projectMoveErrorCopy } = refusals;

/* ---------------------------------------------------------------- the wire */

test("force_done is accepted at the op's top level and rejected inside fields", () => {
	const top = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done" },
		force_done: true,
	});
	assert.equal(top.success, true, "top-level force_done is the contract");
	const nested = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done", force_done: true },
	});
	assert.equal(
		nested.success,
		false,
		"force_done inside fields would be a flag mistaken for a row field",
	);
	const wrongType = desktopRequestSchema.safeParse({
		op: "projects.update",
		key: "p1",
		fields: { status: "done" },
		force_done: "true",
	});
	assert.equal(wrongType.success, false, "the daemon takes a strict boolean");
});

test("the PATCH body carries force_done only when it is true", () => {
	const body = (extra) =>
		desktopEndpoint(
			desktopRequestSchema.parse({
				op: "projects.update",
				key: "p1",
				fields: { status: "done" },
				...extra,
			}),
		).body;
	assert.deepEqual(body({}), { status: "done" }, "omitted: body unchanged");
	assert.deepEqual(
		body({ force_done: false }),
		{ status: "done" },
		"false is the same request as absent and must not travel",
	);
	assert.deepEqual(body({ force_done: true }), {
		status: "done",
		force_done: true,
	});
	const endpoint = desktopEndpoint({
		op: "projects.update",
		key: "a b",
		fields: { status: "done" },
		force_done: true,
	});
	assert.equal(endpoint.method, "PATCH");
	assert.equal(endpoint.path, "/v1/desktop/projects/a%20b");
});

/* ---------------------------------------------------------- the classifier */

const SENTENCE =
	"cannot set status 'done': 2 milestones still incomplete ('api parity', \"it's late\") \u2014 complete them, or pass force_done=true to close with them open";

test("the machine code classifies, with the names from `incomplete`", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: SENTENCE,
		detail: {
			code: "project_done_incomplete",
			message: SENTENCE,
			incomplete: ["api parity", "it's late"],
		},
	});
	assert.deepEqual(refusal, {
		count: 2,
		names: ["api parity", "it's late"],
		coded: true,
		message: SENTENCE,
	});
});

test("a coded refusal with an unreadable list still classifies, from the sentence", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: SENTENCE,
		detail: { code: "project_done_incomplete" },
	});
	assert.equal(refusal.coded, true);
	assert.deepEqual(refusal.names, ["api parity", "it's late"]);
	assert.equal(refusal.count, 2);
});

test("a coded refusal with neither list nor parsable sentence gets no names, not a crash", () => {
	const refusal = doneGateRefusal({
		code: PROJECT_DONE_INCOMPLETE_CODE,
		message: "something reworded",
		detail: { incomplete: [] },
	});
	assert.deepEqual(refusal, {
		count: 0,
		names: [],
		coded: true,
		message: "something reworded",
	});
});

test("an older daemon's sentence-only refusal is recognised but NEVER offered a force", () => {
	const refusal = doneGateRefusal({
		code: "project_invalid",
		message: SENTENCE,
	});
	assert.equal(refusal.coded, false, "no code, no force offer");
	assert.deepEqual(refusal.names, ["api parity", "it's late"]);
});

test("other refusals and non-refusals are not the done-gate", () => {
	assert.equal(
		doneGateRefusal({ code: "project_invalid", message: "bad date" }),
		null,
	);
	assert.equal(doneGateRefusal({ code: null, message: "" }), null);
});

/* ---------------------------------------------------------------- the copy */

test("the sentence states what is open, agrees in number, and asks no question", () => {
	assert.equal(
		doneGateSentence({
			count: 1,
			names: ["beta cut"],
			coded: true,
			message: SENTENCE,
		}),
		"1 milestone is still open (beta cut).",
	);
	assert.equal(
		doneGateSentence({
			count: 2,
			names: ["a", "b"],
			coded: true,
			message: SENTENCE,
		}),
		"2 milestones are still open (a and b).",
	);
	const seven = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
	assert.equal(
		doneGateSentence({
			count: 7,
			names: seven,
			coded: true,
			message: SENTENCE,
		}),
		"7 milestones are still open (m1, m2, m3 and 4 more).",
	);
	/* The body no longer repeats the title's question (design round 1, D6). */
	assert.ok(
		!doneGateSentence({
			count: 7,
			names: seven,
			coded: true,
			message: SENTENCE,
		}).includes("Mark done anyway"),
	);
});

test("an unreadable coded refusal never asserts a count it does not know", () => {
	const codedUnknown = {
		count: 0,
		names: [],
		coded: true,
		message: "something reworded",
	};
	assert.equal(doneGateSentence(codedUnknown), "something reworded");
	assert.equal(
		doneGateSentence({ ...codedUnknown, message: "" }),
		"Some milestones are still open.",
		"nothing readable: a generic sentence, never '0 milestones'",
	);
});

test("the names clause: four are listed, five fold (design D6)", () => {
	assert.equal(doneGateNamesClause(["a", "b", "c"]), "a, b and c");
	assert.equal(
		doneGateNamesClause(["a", "b", "c", "d"]),
		"a, b, c and d",
		"one hidden name is listed, not summarised",
	);
	assert.equal(
		doneGateNamesClause(["a", "b", "c", "d", "e"]),
		"a, b, c and 2 more",
	);
});

test("the toast copy is capped like the dialog, and falls back without a count", () => {
	const seven = {
		count: 7,
		names: ["a", "b", "c", "d", "e", "f", "g"],
		coded: true,
		message: SENTENCE,
	};
	assert.equal(
		doneGateToastCopy(seven),
		"This can't be marked done yet: 7 milestones are still incomplete (a, b, c and 4 more). Complete or remove the incomplete milestones, then mark it done.",
	);
	assert.equal(
		doneGateToastCopy(seven).includes("g)"),
		false,
		"the uncapped tail must not ride along",
	);
	assert.equal(
		doneGateToastCopy({
			count: 0,
			names: [],
			coded: true,
			message: "something reworded",
		}),
		"something reworded",
	);
	assert.equal(
		doneGateToastCopy({ count: 0, names: [], coded: false, message: "" }),
		"Milestones are still open on this project. Complete or remove them, then mark it done.",
	);
});

test("refusalCopy caps and unquotes the daemon's repr names", () => {
	assert.equal(
		refusalCopy(
			"cannot set status 'done': 7 milestones still incomplete ('one', 'two', 'three', 'four', 'five', 'six', 'seven') — complete them, or pass force_done=true to close with them open",
		),
		"This can't be marked done yet: 7 milestones are still incomplete (one, two, three and 4 more). Complete or remove the incomplete milestones, then mark it done.",
	);
});

test("the forced-close toast says it closed with N open, N from the answer's row", () => {
	const row = {
		forced_done: true,
		milestones_total: 9,
		milestones_completed: 2,
	};
	assert.equal(
		forcedCloseToastText(row, 99, "Done"),
		"Moved to Done with 7 milestones still open",
	);
	assert.equal(
		forcedCloseToastText(
			{ forced_done: true, milestones_total: 3, milestones_completed: 2 },
			9,
			"Done",
		),
		"Moved to Done with 1 milestone still open",
	);
	assert.equal(
		forcedCloseToastText({ forced_done: true }, 4, "Done"),
		"Moved to Done with 4 milestones still open",
		"an unreadable row falls back to the count the dialog showed",
	);
	assert.equal(
		forcedCloseToastText({ forced_done: false }, 4, "Done"),
		"Moved to Done",
		"nothing was left open by the time it landed: an ordinary move",
	);
	assert.equal(forcedCloseToastText(null, 4, "Done"), "Moved to Done");
});

test("the refusal copy and the not-moved fallback are in the app's voice", () => {
	assert.match(
		refusalCopy(SENTENCE),
		/^This can't be marked done yet: 2 milestones are still incomplete/,
	);
	assert.match(PROJECT_NOT_MOVED_COPY, /^The project was not moved\./);
});

/* ------------------------------------------------------------ retry policy */

const refused = (status) => new DesktopControlError(status, "refused");

test("a 4xx refusal is not retried; transport and 5xx failures keep the single retry", () => {
	assert.equal(retryDesktopMutation(0, refused(422)), false);
	assert.equal(retryDesktopMutation(0, refused(409)), false);
	assert.equal(retryDesktopMutation(0, refused(404)), false);
	assert.equal(
		retryDesktopMutation(0, refused(408)),
		true,
		"408 is a timeout, not a refusal",
	);
	assert.equal(retryDesktopMutation(0, refused(425)), true);
	assert.equal(retryDesktopMutation(0, refused(429)), true);
	assert.equal(retryDesktopMutation(0, refused(500)), true);
	assert.equal(retryDesktopMutation(0, refused(503)), true);
	assert.equal(retryDesktopMutation(0, refused(null)), true);
	assert.equal(retryDesktopMutation(0, new Error("boom")), true);
	assert.equal(
		retryDesktopMutation(1, refused(503)),
		false,
		"once, not forever",
	);
});

test("the app default still retries mutations, so the override is what changes 422", () => {
	// Guards the premise: if the default ever stopped retrying, this opt-out
	// would be dead code and the test above would be pinning nothing.
	assert.equal(defaultQueryOptions.mutations.retry, 1);
	assert.equal(typeof retryDesktopQuery, "function");
});

/* --------------------------------------------- one move, per-call outcome -- */

/*
 * AGENT REVIEW F3 / UX ROUND 1, U1, reproduced here deterministically: the
 * board's move orchestration must settle PER CALL, because the shared
 * mutation's callbacks are displaced by an overlapping second move. The
 * deferred promises below stage exactly the overlap the reviews measured.
 */
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const codedRefusal = () =>
	new DesktopControlError(
		422,
		SENTENCE,
		undefined,
		PROJECT_DONE_INCOMPLETE_CODE,
		undefined,
		{
			code: PROJECT_DONE_INCOMPLETE_CODE,
			message: SENTENCE,
			incomplete: ["a", "b"],
		},
	);

test("a coded refusal with the capability becomes a question; without it, a sentence", async () => {
	const first = await runStatusMove({
		move: async () => {
			throw codedRefusal();
		},
		forceDoneOffered: true,
		questionOpen: () => false,
	});
	assert.equal(first.kind, "question");
	assert.equal(first.refusal.coded, true);

	const second = await runStatusMove({
		move: async () => {
			throw codedRefusal();
		},
		forceDoneOffered: false,
		questionOpen: () => false,
	});
	assert.equal(second.kind, "spoken");
	assert.match(second.copy, /^This can't be marked done yet:/);
});

test("an older daemon's sentence-only refusal is spoken, never offered a force", async () => {
	const outcome = await runStatusMove({
		move: async () => {
			throw new DesktopControlError(
				422,
				SENTENCE,
				undefined,
				"project_invalid",
			);
		},
		forceDoneOffered: true,
		questionOpen: () => false,
	});
	assert.equal(outcome.kind, "spoken");
	assert.equal(outcome.refusal.coded, false);
});

test("overlapping moves each settle their own outcome (the U1 reproduction)", async () => {
	/* Success + refusal: the earlier move's toast must not be swallowed by the
	 * later move's question. */
	const okDeferred = deferred();
	const badDeferred = deferred();
	let held = false;
	const ok = runStatusMove({
		move: () => okDeferred.promise,
		forceDoneOffered: true,
		questionOpen: () => held,
	});
	const bad = runStatusMove({
		move: () => badDeferred.promise,
		forceDoneOffered: true,
		questionOpen: () => held,
	});
	okDeferred.resolve("row");
	const first = await ok;
	assert.equal(first.kind, "moved");
	badDeferred.reject(codedRefusal());
	const second = await bad;
	assert.equal(second.kind, "question");

	/* Two refusals: the first takes the question; the second - arriving while
	 * it is still up - is spoken as a toast, so NEITHER is silent. */
	const one = deferred();
	const two = deferred();
	held = false;
	const q1 = runStatusMove({
		move: () => one.promise,
		forceDoneOffered: true,
		questionOpen: () => held,
	});
	const q2 = runStatusMove({
		move: () => two.promise,
		forceDoneOffered: true,
		questionOpen: () => held,
	});
	one.reject(codedRefusal());
	const o1 = await q1;
	assert.equal(o1.kind, "question");
	held = true; // the caller's reaction: the dialog slot is now occupied
	two.reject(codedRefusal());
	const o2 = await q2;
	assert.equal(o2.kind, "spoken");
	assert.match(o2.copy, /^This can't be marked done yet:/);
});

test("a transport failure and a non-gate refusal are sentences, with their own copy", async () => {
	const transport = await runStatusMove({
		move: async () => {
			throw new DesktopControlError(null, "");
		},
		forceDoneOffered: true,
		questionOpen: () => false,
	});
	assert.equal(transport.kind, "spoken");
	assert.match(transport.copy, /^The project was not moved\./);
	const other = await runStatusMove({
		move: async () => {
			throw new DesktopControlError(422, "bad date");
		},
		forceDoneOffered: true,
		questionOpen: () => false,
	});
	assert.equal(other.kind, "spoken");
	assert.equal(other.copy, "bad date");
});

/* --------------------------------------------------- the gone project row -- */

test("a project deleted underneath reads in the app's words, by code or bare 404", () => {
	assert.equal(
		projectMoveErrorCopy(
			new DesktopControlError(
				404,
				"no project with id or name 'a'.",
				undefined,
				"project_not_found",
			),
		),
		"This project could not be found. It may have been deleted.",
	);
	assert.equal(
		projectMoveErrorCopy(new DesktopControlError(404, "unclassified miss")),
		"This project could not be found. It may have been deleted.",
		"the QA Q4 case: a 404 with no code still classifies",
	);
	assert.equal(projectGoneError(new DesktopControlError(422, "bad")), false);
	assert.equal(projectGoneError(new Error("boom")), false);
	assert.equal(doneGateRefusalOf(new Error("boom")), null);
});

/* --------------------------------------- the gates, pinned where they are -- */

/*
 * The two capability gates are behavioural in the component tests below for
 * the detail field; the page's gate is exercised through `runStatusMove` above
 * (which is what the page calls), and these pins stop a future edit from
 * quietly bypassing either seam: dropping the capability read from the source,
 * or routing moves back through the shared mutation's callbacks (the class
 * agent review F3 reproduced).
 */
const readSource = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the page routes every move through runStatusMove and per-call promises", () => {
	const page = readSource(
		"src/renderer/src/features/projects/components/projects-page.tsx",
	);
	assert.ok(
		page.includes("runStatusMove("),
		"the page must use the tested orchestration",
	);
	assert.ok(page.includes("mutateAsync"), "per-call settlement, not callbacks");
	assert.ok(
		!/update\.mutate\(/.test(page),
		"the shared mutation's displaced callbacks must not come back",
	);
	assert.ok(
		page.includes('"projects_force_done"'),
		"the page's force gate names the capability key",
	);
});

test("the detail field's force door reads the capability before it renders", () => {
	const editors = readSource(
		"src/renderer/src/features/projects/components/project-editors.tsx",
	);
	assert.ok(
		editors.includes("desktopFeatureEnabled(") &&
			editors.includes('"projects_force_done"'),
		"the door's capability must be read from the daemon's feature list",
	);
	assert.ok(
		editors.includes("forceDoneOffered &&"),
		"the door's predicate must include the capability",
	);
});

/* ------------------------------------- the field, its door and its dialog -- */

/*
 * F5: the capability gate and the dialog wiring must be CI-visible, not only
 * in Storybook - mutating either gate to `true` has to fail a test. This half
 * mounts the REAL `ProjectStatusField` (the detail view's inline status) in
 * jsdom against a stubbed desktop bridge, drives the actual Select with plain
 * clicks (radix's trigger opens on click when the pointer type is not "mouse",
 * which is what a synthetic click reads as), and exercises the field's door,
 * the dialog's busy/error/focus states, and the no-commit wedge agent review
 * F1 reproduced at hook level.
 */

const { writeFile: writeFileAsync, unlink } = await import("node:fs/promises");
const { JSDOM } = await import("jsdom");
const React = await import("react");
const { act } = React;
const { createRequire } = await import("node:module");
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

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
		// getters this realm cannot copy; nothing in the bundle needs them
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	if (dom.window[name]) globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
dom.window.Element.prototype.hasPointerCapture = () => false;
dom.window.Element.prototype.setPointerCapture = () => {};
dom.window.Element.prototype.releasePointerCapture = () => {};
/*
 * jsdom's selector engine recurses pathologically on the top-layer
 * pseudo-classes that floating-ui asks about whenever a popup opens
 * (measured on this file's first Select open: ~60s of nwsapi `isFullscreen`
 * recursion, which made the whole suite unusable). Nothing in a headless
 * DOM is fullscreen, modal or popover-open, so those selectors answer
 * `false` here; every other selector goes to the real engine.
 */
{
	const nativeMatches = dom.window.Element.prototype.matches;
	dom.window.Element.prototype.matches = function (selector) {
		const text = String(selector);
		if (
			text.includes(":fullscreen") ||
			text.includes(":popover-open") ||
			text.includes(":modal") ||
			text.includes(":top-layer")
		)
			return false;
		return nativeMatches.call(this, selector);
	};
}
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
// The desktop bridge is the only transport the field uses; refuse the network.
globalThis.fetch = () => Promise.reject(new Error("no network in this test"));

/*
 * THE FIELD'S TOASTS GO TO A RECORDER, not sonner (no Toaster exists here),
 * which also lets the forced-close success assert its own sentence.
 */
const toastStubPath = new URL(
	`./_force-done-toast-${process.pid}.mjs`,
	import.meta.url,
).pathname;
await writeFileAsync(
	toastStubPath,
	`export const toastCalls = [];
const record = (kind) => (message, options) => { toastCalls.push({ kind, message, options }); };
export const showSuccessToast = record("success");
export const showErrorToast = record("error");
export const showWarningToast = record("warning");
export const showInfoToast = record("info");
export const showLoadingToast = record("loading");
export const dismissToast = () => {};
export const resetToastDedup = () => {};
`,
);

const componentBundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { createRoot } from "react-dom/client";
			import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			import { MemoryRouter } from "react-router-dom";
			import { ProjectStatusField } from "./src/renderer/src/features/projects/components/project-editors";
			import { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export function mount(container, project, commit) {
				const client = new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				});
				const root = createRoot(container);
				const render = (nextProject) =>
					root.render(
						createElement(
							QueryClientProvider,
							{ client },
							createElement(
								MemoryRouter,
								null,
								createElement(ProjectStatusField, {
									project: nextProject,
									commit,
								}),
							),
						),
					);
				render(project);
				return { root, client, render };
			}
			export { DesktopControlError };
			export { toastCalls } from "@shared/utils/toast-manager";
		`,
		resolveDir: ROOT,
		sourcefile: "projects-force-done-components.mjs",
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
		"@shared/utils/toast-manager": toastStubPath,
	},
	write: false,
});
const componentsPath = new URL(
	`./_force-done-components-${process.pid}.mjs`,
	import.meta.url,
);
await writeFileAsync(componentsPath, componentBundle.outputFiles[0].text);
const components = await import(componentsPath.href);
const removeScratchBundles = () => {
	for (const path of [toastStubPath, componentsPath.pathname]) {
		try {
			unlink(path);
		} catch {
			// already gone
		}
	}
};
process.on("exit", removeScratchBundles);
/*
 * A SIGTERM from a harness timeout skips the exit handler, and a leftover
 * bundle under `scripts/` is not just untidy: the repo's pre-push gate lints
 * every changed file under `scripts/`, so a killed run could fail somebody's
 * push. Catch the signal a timeout actually sends.
 */
process.on("SIGTERM", () => {
	removeScratchBundles();
	process.exit(143);
});
process.on("SIGINT", removeScratchBundles);

const flush = async () => {
	await act(async () => {});
};
/** Flush until `predicate` holds (async state needs commits, not one tick). */
const poll = async (predicate, label, timeoutMs = 2000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await flush();
	}
	throw new Error(`timed out waiting for ${label}`);
};
const need = (selector) => {
	const element = document.querySelector(selector);
	assert.ok(element, `missing ${selector}`);
	return element;
};
const clickIt = async (selector) => {
	const element = typeof selector === "string" ? need(selector) : selector;
	await act(() => element.click());
	await flush();
};
const byText = (selector, text) =>
	[...document.querySelectorAll(selector)].find(
		(element) => element.textContent?.trim() === text,
	);

/* The desktop bridge: capabilities answer with the current feature list. */
let features = {};
dom.window.api = {
	desktop: {
		request: async (request) => {
			if (request.op === "capabilities")
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
			return { status: 500, body: { detail: "unexpected op in this harness" } };
		},
	},
};

const PROJECT = {
	id: "p1",
	name: "payments-migration",
	title: "Payments migration",
	owner: null,
	team: null,
	description: "",
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 2,
	milestones_total: 9,
	sessions: 0,
	live_sessions: 0,
	progress_stale: true,
	progress_updated_at: null,
	updated_at: 0,
	progress: "",
	progress_reported_by: "",
	progress_refreshed_at: null,
	progress_refreshed_by: "",
};

const codedError = () =>
	new components.DesktopControlError(
		422,
		SENTENCE,
		undefined,
		PROJECT_DONE_INCOMPLETE_CODE,
		undefined,
		{
			code: PROJECT_DONE_INCOMPLETE_CODE,
			message: SENTENCE,
			incomplete: ["a", "b"],
		},
	);

/** Mount the real field and drive its Select to Done. */
const mountField = async (commit) => {
	const container = document.createElement("div");
	document.body.append(container);
	const app = components.mount(container, { ...PROJECT }, commit);
	await flush();
	await clickIt(
		'[data-project-field="status"] [data-inline-edit-control="begin"]',
	);
	await clickIt('[data-project-status=""]');
	await clickIt('[data-project-status-option="done"]');
	return { app, container };
};

/*
 * `act(() => root.unmount())` DEADLOCKS here (React 18 flushes a commit the
 * unmount tears down mid-flight - measured: the test hung for its whole
 * timeout). A SYNCHRONOUS unmount - React warns, and the warning is noise in
 * a test tearing the tree down on purpose - followed by one flush is the
 * shape that settles.
 */
const unmountField = async (app, container) => {
	app.root.unmount();
	await flush();
	if (container?.isConnected) container.remove();
};

test("with the capability the door renders after the coded refusal", async () => {
	features = { projects: 2, projects_force_done: 1 };
	const commits = [];
	const { app, container } = await mountField(async () => {
		commits.push(1);
		throw codedError();
	});
	try {
		assert.equal(commits.length, 1, "the pick sent exactly one write");
		assert.ok(
			container.textContent.includes("can't be marked done yet"),
			"the refusal is spoken beside the field",
		);
		need("[data-project-force-done-door]");
		await clickIt("[data-project-force-done-door]");
		need('[role="dialog"]');
		assert.equal(
			document.activeElement,
			byText('[role="dialog"] button', "Cancel"),
			"initial focus on the safe action",
		);
	} finally {
		await unmountField(app, container);
	}
});

test("without the capability there is NO door, only the sentence (the gate flip fails here)", async () => {
	features = { projects: 2 };
	const { app, container } = await mountField(async () => {
		throw codedError();
	});
	try {
		assert.ok(
			container.textContent.includes("can't be marked done yet"),
			"the sentence still reaches the reader",
		);
		assert.equal(
			document.querySelector("[data-project-force-done-door]"),
			null,
			"an older daemon must never be offered a forced retry",
		);
	} finally {
		await unmountField(app, container);
	}
});

test("F1: a record that already reads the pressed value closes the dialog, never wedges it", async () => {
	features = { projects: 2, projects_force_done: 1 };
	const commits = [];
	const { app, container } = await mountField(async () => {
		commits.push(1);
		throw codedError();
	});
	try {
		await clickIt("[data-project-force-done-door]");
		need('[role="dialog"]');
		assert.equal(commits.length, 1);
		/*
		 * THE RECORD MOVES UNDER THE DIALOG (the reviewer's repro): the detail
		 * refetches, the field reseeds to the fresh `done` value, and the draft
		 * now EQUALS the base - `accept` would send no commit. The press must
		 * still settle: the dialog closes, and no second write is sent.
		 */
		await act(async () => {
			app.render({ ...PROJECT, status: "done" });
		});
		await flush();
		await clickIt("[data-project-force-done]");
		await poll(
			() => document.querySelector('[role="dialog"]') === null,
			"the dialog to settle (F1: the promise must resolve, not wedge)",
		);
		assert.equal(
			commits.length,
			1,
			"the write was moot - the record already read it",
		);
		assert.equal(
			components.toastCalls.length,
			0,
			"no success toast for a write that never happened",
		);
	} finally {
		await unmountField(app, container);
	}
});

test("Q2: the busy primary keeps the caret, the failure keeps it retryable", async () => {
	features = { projects: 2, projects_force_done: 1 };
	let resolveThird;
	const third = new Promise((resolve) => {
		resolveThird = resolve;
	});
	let rejectSecond;
	const pending = new Promise((_resolve, reject) => {
		rejectSecond = reject;
	});
	let call = 0;
	const { app, container } = await mountField(async () => {
		call += 1;
		if (call === 1) throw codedError();
		if (call === 2) return pending;
		return third;
	});
	try {
		await clickIt("[data-project-force-done-door]");
		const primary = need("[data-project-force-done]");
		await act(() => primary.focus());
		await clickIt(primary);
		/*
		 * IN FLIGHT: the primary states its condition with `aria-disabled` (a
		 * really-disabled button cannot hold focus, which is how the caret fell
		 * to `<body>`), the other exits are disabled, and a second press does
		 * NOT send a second write.
		 */
		assert.equal(
			document.activeElement,
			primary,
			"focus stays on the busy control",
		);
		assert.equal(primary.getAttribute("aria-disabled"), "true");
		assert.equal(primary.hasAttribute("disabled"), false);
		assert.equal(byText('[role="dialog"] button', "Cancel").disabled, true);
		await clickIt(primary);
		assert.equal(call, 2, "a second press while in flight must not send");
		/* IN-DIALOG FAILURE: the sentence appears, focus stays on the retry. */
		await act(async () => {
			rejectSecond(new components.DesktopControlError(422, "bad date"));
		});
		await poll(
			() =>
				(
					document.querySelector('[role="dialog"] [role="alert"]')
						?.textContent ?? ""
				).includes("bad date"),
			"the failure sentence inside the dialog",
		);
		assert.equal(document.activeElement, primary, "the retry stays focused");
		assert.equal(primary.getAttribute("aria-disabled"), "false");
		/* The next press IS the retry. */
		await clickIt(primary);
		assert.equal(call, 3, "the press after a failure retries");
		await act(async () => {
			resolveThird("row");
		});
		await poll(
			() => document.querySelector('[role="dialog"]') === null,
			"the retry that lands to close the dialog",
		);
		const success = components.toastCalls.find(
			(entry) => entry.kind === "success",
		);
		assert.match(success?.message ?? "", /^Moved to Done/);
	} finally {
		await unmountField(app, container);
	}
});

test("D9: a project gone underneath swaps the primary for Close", async () => {
	features = { projects: 2, projects_force_done: 1 };
	let call = 0;
	const { app, container } = await mountField(async () => {
		call += 1;
		if (call === 1) throw codedError();
		throw new components.DesktopControlError(
			404,
			"no project with id or name '0'.",
			undefined,
			"project_not_found",
		);
	});
	try {
		await clickIt("[data-project-force-done-door]");
		await clickIt("[data-project-force-done]");
		await poll(
			() => document.querySelector("[data-project-force-close]") !== null,
			"the primary to become Close after the 404",
		);
		const close = need("[data-project-force-close]");
		assert.equal(close.textContent?.trim(), "Close");
		assert.equal(
			byText('[role="dialog"] button', "Review milestones"),
			undefined,
			"a gone project has nothing to open",
		);
		assert.ok(
			(
				document.querySelector('[role="dialog"] [role="alert"]')?.textContent ??
				""
			).includes("This project could not be found."),
			"the app's own sentence for a vanished row",
		);
		await clickIt(close);
		assert.equal(document.querySelector('[role="dialog"]'), null);
	} finally {
		await unmountField(app, container);
	}
});

test("Escape closes the dialog without a write", async () => {
	features = { projects: 2, projects_force_done: 1 };
	let call = 0;
	const { app, container } = await mountField(async () => {
		call += 1;
		throw codedError();
	});
	try {
		await clickIt("[data-project-force-done-door]");
		need('[role="dialog"]');
		await act(() => {
			document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		await flush();
		assert.equal(
			document.querySelector('[role="dialog"]'),
			null,
			"Escape closes",
		);
		assert.equal(call, 1, "Escape wrote nothing");
	} finally {
		await unmountField(app, container);
	}
});
