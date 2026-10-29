/* Permanent assembled-app evidence producer, run by the EXISTING macOS NPX job.
 * Local source tests never invoke main(). Both cases use stock Electron/main,
 * preload, renderer, HTTP transport, ChatLayout handlers and real store writers.
 * Only the backend's synthetic HTTP data is a fixture; no injected UI/bridge.
 */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ASK_SESSION_IDS, startAsksAppFixture } from "./asks-app-fixture.mjs";
import { isEntryPoint } from "./entry-point.mjs";
const execute = promisify(execFile);
// Hosted macOS arm64 has 7 GB RAM, but Node 22 defaults this isolated builder
// to ~2 GB: run 39671897399 aborted in control-renderer chunk generation at
// that V8 limit. Bound only this serial build to 4 GiB; global NODE_OPTIONS
// would also enlarge Electron/fixture processes and defeat their own budgets.
// This is a V8 heap allowance, not a replacement for process-group ceilings.
export const CONTROL_BUILD_NODE_ARGS = [
	"--max-old-space-size=4096",
	"--input-type=module",
];
/**
 * The pristine revision the control leg renders: the BASE THE CANDIDATE WAS BUILT
 * FROM, resolved per run rather than fixed at one commit.
 *
 * WHY IT IS DERIVED. The control exists so its frames differ from the candidate's
 * for one reason only - the change under test - which requires the two legs to
 * share main, preload, the vite config and the lockfile BYTE FOR BYTE. A pinned
 * historical commit stops being able to satisfy that the moment `main` moves: the
 * pinned tree's `src/main` is then older than the merged head's, `prepareControl`'s
 * identity assertion fails, and the producer dies before it renders anything.
 * Measured on run 38916579072: `control reuse mismatch src/main`, actual
 * `adc7fdcc6` against the pinned `2461cfa3f3`.
 *
 * WHY THE MERGE-BASE IS THE RIGHT DERIVATION. In CI this job checks out GitHub's
 * RECOMPUTED `refs/pull/N/merge`, whose first parent is `main` as of that run, and
 * `git merge-base origin/main HEAD` resolves to that same commit here. The candidate
 * is a descendant of it. When this branch touches none of the four reused parts
 * (`CONTROL_REUSE_PARTS`, proved by the property test) the byte-identity assertion
 * holds and main/preload are reused. When it DOES touch main, preload or the vite
 * config, the control builds its own main/preload from its own source instead
 * (`controlReusePlan`); a differing lockfile installs the control's own dependencies
 * from its own lockfile. The identical case is not weakened - the rebuild is the
 * branch for a change that has to differ.
 *
 * WHAT IS LOST, STATED PLAINLY. A pinned commit let the control be any historical
 * revision at all, including one whose renderer predates this line of work. The
 * merge-base gives up that freedom: the control is instead "main as merged into this
 * PR", which is exactly the baseline the change must be judged against, and the one
 * a reviewer can reproduce with one git command. `ASKS_CONTROL_PINNED` keeps the
 * historical revision that the branch's own first scenes were captured against, for
 * the provenance record rather than for the boot.
 */
export const ASKS_CONTROL_PINNED = "2461cfa3f3beaa1124727a9de93dfe01c4381b0d";

/**
 * The control revision this run will boot: `ASKS_CONTROL_OVERRIDE` when CI passes
 * one, else the merge-base of `origin/main` and `HEAD`, else - when neither can be
 * resolved, as in a clone with no `origin/main` - the pinned revision, so a shallow
 * or detached tree degrades to the old behaviour instead of failing.
 */
export function resolveAsksControl() {
	const override = process.env.ASKS_CONTROL_OVERRIDE;
	if (override) return override;
	try {
		return git("merge-base", "origin/main", "HEAD");
	} catch {
		return ASKS_CONTROL_PINNED;
	}
}

const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
export const ASKS_CONTROL = resolveAsksControl();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * A PRESS LANDS ONLY WHERE THE TARGET CAN RECEIVE IT (#1131's red leg).
 *
 * `press` used to wait for the target to EXIST, take its centre and dispatch one
 * mouse sequence - no hit test, no retry. That is enough while the tree is quiet and
 * silently wrong while it is not: the header-menu case switches session (the header is
 * re-keyed and re-rendered) and marks and presses almost immediately, so a press that
 * lands in that window is swallowed by an element about to be replaced, and the wait
 * for the menu that follows times out with nothing but the expression to go on.
 * Measured on run 38966398557: `header-menu/candidate` captured ZERO frames with
 * `Unsettled real UI: document.querySelectorAll('[role="menuitem"]').length > 0`,
 * while the same case's control leg - second, on a warm app - passed on identical
 * content.
 *
 * SO THE GATE IS ACTIONABILITY, NOT A RETRY OF THE PRESS: the point must hit-test to
 * the target itself or something it contains, and the target must be the same element
 * across two consecutive reads, before the ONE press is dispatched. The stability half
 * is what covers the session switch, and the claim that carries it is a JS property on
 * the node: invisible to the app and to CSS, and lost with the node it was set on,
 * which is exactly the identity question being asked.
 *
 * A press that is never deliverable FAILS NAMING THE OCCLUDER - the point, the element
 * that owns it and whether the target was still being replaced - so the next reader
 * knows it was occlusion rather than re-deriving it. Deliberately NOT a retry loop on
 * the press itself: a press delivered twice is a different bug from a press never
 * delivered, and the gate plus the stability read covers the way this one was
 * swallowed.
 */
let pressClaim = 0;

export function describePressRead(read) {
	if (!read) return "no read was taken";
	if (!read.present) return "the target left the document";
	if (!read.painted) return "the target has an empty box";
	const owner =
		read.at === "nothing"
			? "hit-tests to nothing (off-screen, or owned by a layer that paints nothing)"
			: `is covered by ${read.at}`;
	const settling = read.stable
		? ""
		: ", and the target is still being replaced (unstable across two reads)";
	return `the point (${read.x},${read.y}) ${owner}${settling}`;
}

export async function pressWhenActionable({
	selector,
	probe,
	dispatch,
	reads = 25,
	intervalMs = 60,
}) {
	let last = null;
	for (let taken = 1; taken <= reads; taken++) {
		last = await probe();
		if (last.present && last.painted && last.hit && last.stable) {
			await dispatch({ x: last.x, y: last.y });
			return { reads: taken, at: last };
		}
		if (taken < reads) await pause(intervalMs);
	}
	throw Error(
		`pointer target never became actionable after ${reads} bounded reads: ${selector} - ${describePressRead(last)}`,
	);
}

/*
 * WHAT A MENU TIMEOUT SHOULD SAY (same run): with a press that can be swallowed, "the
 * menu did not open" is ambiguous between a press that never landed and a menu that
 * never rendered, so the timeout reports where the trigger is and what owns that point.
 */
const MENU_TRIGGER_SEEN = `(()=>{const el=document.querySelector('[data-ci-menu]');if(!el)return 'the menu trigger is not in the document';const r=el.getBoundingClientRect();const x=Math.round(r.x+r.width/2);const y=Math.round(r.y+r.height/2);const at=document.elementFromPoint(x,y);const owner=at===el||el.contains(at)?'the trigger itself':(at?at.tagName.toLowerCase()+String(at.getAttribute('role')?'[role="'+at.getAttribute('role')+'"]':''):'nothing');return 'no menu items appeared; the trigger at ('+x+','+y+') hit-tests to '+owner})()`;
/*
 * WHAT THE RAIL'S CLOSE MEANS (#1079), AND WHY A CONTROL NO LONGER OWES THE
 * OPPOSITE OF IT (remediation round 1, stream A).
 *
 * The asks fix made a press on the lit rail item EMPTY the slot instead of handing
 * the borrowed pane back, so a control from before the fix restored the pane while a
 * candidate empties it - and this file used to encode exactly that as a per-leg
 * literal: `expectedRailClose("control") === true`. That literal is only true while
 * the control PREDATES the fix. The control is now DERIVED (the merge-base of
 * `origin/main` and `HEAD`), so on any head cut from a main that already carries the
 * fix - every head from 2026-10-16 on - the control empties the slot too, and the
 * literal failed a correct run. Measured on run 38951889082: the macOS leg died at
 * its FIRST case, `--case asks --leg control`, with `control rail-close wrong restore
 * policy: false !== true`, because the merge-base `a23faab0` already contains
 * `2424010d2ae4`.
 *
 * SO THE DECLARATION IS ONE VALUE, NOT ONE PER LEG: the post-state the fix promises.
 * A candidate must exhibit it, and a control that exhibits it too is a CORRECT,
 * PASSING outcome rather than a mismatch to assert against. What the control owes
 * instead is its READING, recorded in its frames beside the candidate's, so the pair
 * still shows which policy each revision has.
 */
export const ASKS_RAIL_CLOSE_POST_STATE = false;

/**
 * The policy assertion a leg owes, or `undefined` when it owes only a reading.
 *
 * Only the CANDIDATE owes the assertion: it is the revision under test, so a
 * candidate that restores the pane where it must empty the slot has to fail. The
 * control is a historical revision whose policy is whatever that revision does, so
 * asserting the literal failed every control that post-dates the fix - which, with
 * a derived control, is all of them.
 */
export function railCloseAssertion(kind) {
	assert(["control", "candidate"].includes(kind));
	return kind === "candidate" ? ASKS_RAIL_CLOSE_POST_STATE : undefined;
}

/**
 * What a leg's close actually did, in the words a reader of the artifact needs.
 *
 * BOTH BRANCHES ARE ORDINARY OUTCOMES, so this cannot be a pass/fail: a control that
 * EMPTIES the slot already carries the fix (`main` does) and a control that RESTORES
 * the pane is one from before it. Recording it is the point - the artifact says
 * which, instead of a reviewer inferring it from a frame's raw boolean.
 */
export function railCloseReading(kind, observed) {
	assert(["control", "candidate"].includes(kind));
	assert.equal(typeof observed, "boolean");
	return {
		leg: kind,
		observed,
		declaredPostState: ASKS_RAIL_CLOSE_POST_STATE,
		reading:
			observed === ASKS_RAIL_CLOSE_POST_STATE
				? "this revision EMPTIES the slot when the lit asks item closes - the #1079 policy is present"
				: "this revision RESTORES the displaced pane when the lit asks item closes - the pre-#1079 policy",
	};
}
function files(root) {
	return readdirSync(root).flatMap((name) => {
		const path = join(root, name);
		return readdirSync(root, { withFileTypes: true })
			.find((x) => x.name === name)
			.isDirectory()
			? files(path)
			: [path];
	});
}
/**
 * Whether the control may REUSE the candidate's built main + preload, or must
 * build its own.
 *
 * WHY IT IS A FUNCTION OF FOUR TREE IDS. The control leg exists so its frames differ
 * from the candidate's for ONE reason - the change under test. Reusing the
 * candidate's `out/main` and `out/preload` for the control is only honest when those
 * sources are byte-identical at both revisions; then the reuse saves a build and
 * changes nothing. A PR that changes main-process or preload code (a window option,
 * an IPC channel, a preload bridge) is exactly the PR whose frames most need a real
 * control, and used to die here with `control reuse mismatch src/main` before
 * rendering anything - so a main-touching change could not pass the one job that
 * photographs it. Now it takes the other branch: the control's main and preload are
 * BUILT from the control's own source, so the pair still differs by the change only.
 *
 * TWO PARTS ARE NOT PART OF "REUSE":
 *  - `pnpm-lock.yaml`: a differing lockfile means the control cannot share the
 *    candidate's `node_modules`; it installs its own from its own lockfile, so the
 *    comparison stays "base tree with base dependencies".
 *  - a missing tree: a revision whose source cannot be read stops dispatch.
 * The byte-identical case keeps its original assertion; only the mismatch of the
 * three build INPUTS (`src/main`, `src/preload`, `electron.vite.config.js`) is
 * redirected to a rebuild instead of a throw.
 */
export const CONTROL_REUSE_PARTS = [
	"src/main",
	"src/preload",
	"electron.vite.config.js",
	"pnpm-lock.yaml",
];
export function controlReusePlan(revParse, control, head) {
	const differing = CONTROL_REUSE_PARTS.filter(
		(part) => revParse(`${control}:${part}`) !== revParse(`${head}:${part}`),
	);
	return {
		reuse: differing.length === 0,
		differing,
		lockDiffers: differing.includes("pnpm-lock.yaml"),
	};
}
/** The provenance line for a plan: the manifest's `mainPreloadReuse`. */
export function describeMainPreloadReuse(plan) {
	if (plan.reuse) return "byte-identical source/config/lock";
	if (plan.lockDiffers) {
		return "rebuilt from control source (lockfile differs; control dependencies installed from its own lockfile)";
	}
	return `rebuilt from control source (main/preload differ: ${plan.differing.join(", ")})`;
}
async function prepareControl(root, output) {
	// Real historical source, not a callback mutation. Main/preload are reused
	// from the candidate only when the source identities agree (`controlReusePlan`);
	// otherwise they are built from the control's own source below.
	const plan = controlReusePlan(
		(spec) => git("rev-parse", spec),
		ASKS_CONTROL,
		"HEAD",
	);
	const tar = join(output, "control-source.tar");
	execFileSync("git", [
		"archive",
		"--format=tar",
		`--output=${tar}`,
		ASKS_CONTROL,
		"src",
		"scripts",
		"resources",
		"build",
		"i18n",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"electron.vite.config.js",
		"tsconfig.node.json",
		"tsconfig.app.json",
		"tsconfig.web.json",
		"tsconfig.json",
	]);
	mkdirSync(root);
	execFileSync("tar", ["-xf", tar, "-C", root]);
	/*
	 * A DEPENDENCY-ADDING PR IS STILL A VALID EXPERIMENT. The control normally
	 * shares the candidate's node_modules, which is only honest when the lockfile
	 * is byte-identical. When the lockfile differs, sharing would boot the control
	 * on dependencies it was not built for, so the control gets its OWN install
	 * from its own lockfile instead. That preserves the comparison (the control is
	 * the base tree with base dependencies) and lets a reviewed dependency addition
	 * run through the same gate rather than being forced to bypass it.
	 */
	if (plan.lockDiffers) {
		await execute(
			"pnpm",
			["install", "--frozen-lockfile", "--ignore-scripts"],
			{
				cwd: root,
				env: { ...process.env, CI: "true" },
				timeout: 300000,
				maxBuffer: 8 * 1024 * 1024,
			},
		);
	} else {
		symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
	}
	if (plan.reuse) {
		for (const part of ["main", "preload"])
			cpSync(join("out", part), join(root, "out", part), { recursive: true });
	}
	/*
	 * Same `resolveConfig` approach as the renderer, run in the control's root so the
	 * control's own `electron.vite.config.js` and sources are what build. Main and
	 * preload are built only when they could not be reused; the renderer always is.
	 */
	const targets = plan.reuse
		? "renderer"
		: "main, c.config.preload, c.config.renderer";
	const code = `import {resolveConfig} from 'electron-vite';import {build} from 'vite';const c=await resolveConfig({},'build','production');for (const cfg of [c.config.${targets}]) await build(cfg);`;
	await execute(process.execPath, [...CONTROL_BUILD_NODE_ARGS, "-e", code], {
		cwd: root,
		env: { ...process.env, LOCAL_OPERATOR_UI_NO_BYTECODE: "true" },
		// A rebuild adds two bundles (main, preload) to the renderer build.
		timeout: plan.reuse ? 120000 : 240000,
		maxBuffer: 4 * 1024 * 1024,
	});
	return {
		commit: ASKS_CONTROL,
		srcTree: git("rev-parse", `${ASKS_CONTROL}:src`),
		mainPreloadReuse: describeMainPreloadReuse(plan),
		rendererOutputs: Object.fromEntries(
			files(join(root, "out/renderer")).map((p) => [
				p.slice(root.length + 1),
				sha(readFileSync(p)),
			]),
		),
	};
}
/**
 * Wait for the renderer to be READY for a verb: painted, with the dev-driver
 * bridge answering, on whichever driver tree this run imported.
 *
 * The candidate tree exports both waits and they are preferred; the pinned
 * historical control tree carries the same two functions INTERNALLY without
 * exporting them (verified at 2461cfa3: `waitForPage` at 1761, `waitForBridge`
 * at 1777, neither on the facade), so there the equivalent polls are repeated.
 * What the scene needs - a mounted page whose `__loDevDriver` answers `verbs()`
 * with `hello` - is the same requirement on both trees.
 */
async function waitForSceneReady(cdp, api, timeoutMs = 90_000) {
	if (
		typeof api?.waitForPage === "function" &&
		typeof api?.waitForBridge === "function"
	) {
		await api.waitForPage(cdp);
		await api.waitForBridge(cdp);
		return;
	}
	const started = Date.now();
	for (;;) {
		const state = await cdp
			.evaluate(
				"({ ready: document.readyState, mounted: Boolean(document.getElementById('app')?.childElementCount), verbs: typeof window.__loDevDriver?.verbs === 'function' ? window.__loDevDriver.verbs() : null })",
			)
			.catch(() => null);
		if (
			state?.ready === "complete" &&
			state.mounted &&
			Array.isArray(state.verbs) &&
			state.verbs.includes("hello")
		)
			return;
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the renderer never registered the dev driver verbs (last: ${JSON.stringify(state)})`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

/**
 * Wait for the app's own debugging port to ANSWER, whatever driver tree this run
 * imported.
 *
 * The candidate tree exports `waitForDevtools` on `rendererDriverApi` and is
 * preferred when present, so the shared implementation stays the one caller
 * contract. The control leg imports a pinned historical driver whose facade does
 * not carry it; there the equivalent bounded poll is repeated, because the
 * requirement is about the PORT being ready and not about which revision of the
 * driver is on disk.
 */
async function waitForDevtoolsPort(handle, api, timeoutMs = 60_000) {
	if (typeof api?.waitForDevtools === "function") {
		await api.waitForDevtools(handle, timeoutMs);
		return;
	}
	const started = Date.now();
	for (;;) {
		try {
			const response = await fetch(
				`http://127.0.0.1:${handle.port}/json/version`,
			);
			if (response.ok) return;
		} catch {
			/* not listening yet */
		}
		if (Date.now() - started > timeoutMs)
			throw new Error(
				`the app's debugging port ${handle.port} never answered in ${timeoutMs}ms`,
			);
		await new Promise((resumed) => setTimeout(resumed, 250));
	}
}

/* ------------------------------------------------------------------ *
 * THE CASE TABLE
 * ------------------------------------------------------------------ */
/**
 * Every assembled-app frame case this producer can run, keyed by the name
 * `--case` takes.
 *
 * WHY A TABLE RATHER THAN ANOTHER SCENE SCRIPT. The UI programme's design and UX
 * rounds are gated on frames of the REAL assembled app, and the asks scenario
 * proved the shape of that evidence: a candidate leg plus a control leg built
 * from a real historical revision, real pointer presses, state read back through
 * the dev driver, and PNGs a reviewer can look at. What differs from one UI head
 * to the next is only WHICH steps are driven, WHICH states must hold and WHICH
 * frames are worth capturing, so those are what a case declares and the runner
 * (launch, attach, control derivation, reaping, manifest) is shared rather than
 * copied per head.
 *
 * `purpose` is prose for the reviewer, not executed. `frames` IS a contract: the
 * runner asserts every promised label was captured, so a case that stops halfway
 * fails rather than publishing an artifact thinner than it claims. A case that
 * cannot run refuses loudly - `--case`/`--leg` outside this table, or missing
 * environment names, exit 1 before any artifact root exists or any Electron
 * binary is resolved.
 */
export const CASES = {
	asks: {
		purpose:
			"The asks rail's open/close policy, driven through every door the user has (rail item, drawer X, Escape, header menu, composer chip) with the browser pane underneath it. The first case, and the one the 1107 rounds were reviewed against.",
		route: "/chat",
		/*
		 * PER LEG, NOT ONE LIST, because the legs are not the same drive: the
		 * candidate runs the closers the change is about (the drawer's X, Escape,
		 * the header menu, the composer chip, the emptied queue, the connection
		 * error) while the control - a real historical revision that predates them -
		 * stops after the shared steps. One list would promise the control leg frames
		 * it cannot take, which is a red run for a correct case.
		 */
		frames: {
			control: [
				"session-loading",
				"before-browser",
				"populated-asks",
				"rail-close",
				"session-a-b-a",
			],
			candidate: [
				"session-loading",
				"before-browser",
				"populated-asks",
				"rail-close",
				"session-a-b-a",
				"header-menu",
				"x-close",
				"escape-give-back",
				"menu-close",
				"chip-close",
				"empty-session-queue",
				"connection-error",
			],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		/*
		 * THE LEGACY OUTPUT LAYOUT IS KEPT FOR THIS CASE ON PURPOSE: its frames sit
		 * at `<output>/control` and `<output>/candidate`, which is where the QA howto
		 * for the asks work points and where the review threads' artifact paths
		 * resolve. Moving every case to one `<case>/<leg>` scheme is mechanical and
		 * has its own blast radius (artifacts, docs, recorded howtos), so this slice
		 * deliberately does not do it.
		 */
		legacyOutputLayout: true,
		drive: async (ctx) => {
			const {
				kind,
				cdp,
				wait,
				press,
				pressEscape,
				waitFor,
				facts,
				frame,
				stamp,
				fixtureMode,
				session,
			} = ctx;
			/*
			 * OPEN THE BROWSER DOOR, AND WAIT FOR THE PANE RATHER THAN SAMPLING IT ONCE.
			 *
			 * The press is a real pointer press on the real rail item, and the store's
			 * `browser` arm sets `isBrowserPaneOpen` in one step with no gate
			 * (`panel-rail-actions.ts`), so the flag does follow the press - what is NOT
			 * synchronous is React's commit of it. Reading `facts()` once, immediately after
			 * the pointer events, samples the store at whatever moment the round trip lands
			 * on, and under load that moment can still be the pre-commit one: measured on run
			 * 38929174267, candidate leg, `Expected values to be strictly equal: false !== true`
			 * at the assertion below, with the pane not yet committed.
			 *
			 * WHY A BOUNDED POLL AND NOT A LONGER PAUSE. What is being waited FOR is a state
			 * change, so the same expression that reads it is the one that has to retry - the
			 * shape this file already uses for every other readiness wait (`wait`, and the
			 * two port/bridge polls above). The timeout keeps the failure mode honest: a door
			 * that never opens still fails, and the message carries the whole state plus what
			 * the press reported, so a genuine regression cannot be mistaken for slowness.
			 *
			 * THE PRESS'S OWN ANSWER IS KEPT. `press` returns nothing today, so the state is
			 * read back instead; if the item were absent or refused the flag would never
			 * settle and the refusal below names it with the state in hand.
			 */
			async function browser() {
				if ((await facts()).dom.ask) await pressEscape();
				if (!(await facts()).state.browserPaneOpen)
					await press('[data-panel-rail-item="browser"]');
				const opened = await waitFor(
					async () => (await facts()).state.browserPaneOpen === true,
					15_000,
				);
				assert.equal(
					opened.state.browserPaneOpen,
					true,
					`the browser door did not open its pane within 15s: browserPaneOpen=${opened.state.browserPaneOpen} state=${JSON.stringify(opened.state)}`,
				);
			}
			async function asks() {
				await press('[data-panel-rail-item="ask"]');
				await wait('!!document.querySelector("[data-ask-drawer]")');
			}
			async function closed(label, expected) {
				await wait('!document.querySelector("[data-ask-drawer]")');
				const x = await frame(label);
				/*
				 * NO POLICY IS OWED ON A CONTROL LEG (`railCloseAssertion`): the drawer being
				 * shut and the focus still connected are asserted either way, and the pane's
				 * state is left to the frame's `railClosePolicy` reading.
				 */
				if (expected !== undefined)
					assert.equal(
						x.state.browserPaneOpen,
						expected,
						`${kind} ${label} wrong restore policy`,
					);
				assert.equal(x.dom.focusedConnected, true);
				return x;
			}
			/*
			 * The conversation is opened by PRESSING THE ROW, not by a disclosure press
			 * first. `[data-tour-tag="chat-all-chats"]` was pressed here unguarded and
			 * that selector has NO home in `src/` at either this head or the pinned
			 * control one (the shared driver's own comment at its `--backend` scene says
			 * so, and `git grep` over `src` in both trees finds nothing), so the press
			 * waited fifteen seconds for an element the app never draws and the whole
			 * case died with `Unsettled real UI: Boolean(document.querySelector(
			 * "[data-tour-tag=\"chat-all-chats\"]"))` - measured on run 38846903646.
			 *
			 * `session()` below is the shape the driver's own scenes use instead: wait
			 * for the seeded row, mark it, press that. The rail this scene is about is
			 * on every route and needs no conversation at all.
			 */
			await session(0);
			await frame("session-loading");
			await fixtureMode("populated");
			await wait(
				'Boolean(document.querySelector("[data-panel-rail-item=ask]"))',
			);
			if ((await facts()).dom.ask) await pressEscape();
			await browser();
			await frame("before-browser");
			await asks();
			await frame("populated-asks");
			await press('[data-panel-rail-item="ask"]');
			/*
			 * THE CLOSE, WITH THE LEG'S OWN OBLIGATION: the candidate must empty the slot;
			 * the control is READ, not asserted, because a control that already carries the
			 * fix is a correct outcome. Its reading goes on the frame below, so the pair
			 * still records which policy each revision has.
			 */
			const railClose = await closed("rail-close", railCloseAssertion(kind));
			stamp(
				"railClosePolicy",
				railCloseReading(kind, railClose.state.browserPaneOpen),
			);
			await session(1);
			await session(0);
			/*
			 * A->B->A, AGAINST THIS RUN'S OWN CLOSE RATHER THAN A LITERAL (round 1, stream
			 * A). The pane's state after the sessions switch must equal what the close left:
			 * a revision that empties the slot must NOT bring the pane back when the
			 * conversation is re-entered (that is the memory the fix retracts), and a
			 * pre-fix revision that restored it must restore it again. Comparing against
			 * the observation keeps that a real gate on BOTH legs - a candidate whose close
			 * empties the slot but whose memory still restores it fails here - without
			 * hard-coding one revision's policy.
			 */
			assert.equal(
				(await facts()).state.browserPaneOpen,
				railClose.state.browserPaneOpen,
				`${kind}: the pane after A->B->A must equal what the rail's close left (${railClose.state.browserPaneOpen})`,
			);
			await frame("session-a-b-a");
			if (kind === "candidate") {
				await browser();
				await asks();
				await press('[data-tour-tag="close-asks-button"]');
				await closed("x-close", false);
				await browser();
				await asks();
				await pressEscape();
				await closed("escape-give-back", true);
				await asks();
				await cdp.evaluate(
					`(()=>{const h=document.querySelector('[data-tour-tag="chat-header"]');const e=[...h.querySelectorAll('button')].find(e=>e.getAttribute('aria-haspopup')==='menu');if(!e)throw Error('real header menu unavailable');e.setAttribute('data-ci-menu','')})()`,
				);
				await press("[data-ci-menu]");
				await cdp.evaluate(
					`(()=>{const e=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Close asks');if(!e)throw Error('real Close asks menu item absent');e.setAttribute('data-ci-close-asks','')})()`,
				);
				await frame("header-menu");
				await press("[data-ci-close-asks]");
				await closed("menu-close", false);
				await browser();
				await asks();
				await press('[data-status-asks][aria-expanded="true"]');
				await closed("chip-close", false);
				await session(1);
				await frame("empty-session-queue");
				await session(0);
				await fixtureMode("error");
				await wait(
					"/reconnect|connection|retry|unavailable|could not/i.test(document.body.innerText)",
				);
				await frame("connection-error");
			}
		},
	},
	palette: {
		purpose:
			"The command palette: an INTERACTIVE surface with a real state, opened from its own sidebar row and closed with Escape, with commandPaletteOpen read from the store at each end so the pair shows one state reached and one left.",
		route: "/chat",
		frames: {
			control: ["palette-open", "palette-closed"],
			candidate: ["palette-open", "palette-closed"],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		drive: async (ctx) => {
			const {
				wait,
				press,
				pressEscape,
				waitFor,
				facts,
				frame,
				fixtureMode,
				session,
			} = ctx;
			await fixtureMode("populated");
			await session(0);
			/*
			 * THE SIDEBAR ROW IS THE DOOR THE SHARED DRIVER'S OWN PALETTE SCENES USE
			 * (`renderer-driver.mjs` presses `[data-command-palette-trigger]` and then
			 * asserts the dialog and the focused field), so this case drives the same
			 * control rather than inventing a second way in.
			 */
			await press("[data-command-palette-trigger]");
			const opened = await waitFor(
				async () => (await facts()).state.commandPaletteOpen === true,
				15_000,
			);
			assert.equal(
				opened.state.commandPaletteOpen,
				true,
				`the command palette never opened: commandPaletteOpen=${opened.state.commandPaletteOpen} state=${JSON.stringify(opened.state)}`,
			);
			await wait(
				'Boolean(document.querySelector("[data-tour-tag=command-palette-dialog]"))',
			);
			await frame("palette-open");
			/*
			 * ESCAPE IS THE PALETTE'S OWN CLOSE PATH (the dialog's `onOpenChange`
			 * writes `closeCommandPalette`), so the pair is a real open and a real
			 * close rather than a state poked from the driver.
			 */
			await pressEscape();
			const shut = await waitFor(
				async () => (await facts()).state.commandPaletteOpen === false,
				15_000,
			);
			assert.equal(
				shut.state.commandPaletteOpen,
				false,
				`the command palette never closed on Escape: commandPaletteOpen=${shut.state.commandPaletteOpen} state=${JSON.stringify(shut.state)}`,
			);
			await frame("palette-closed");
		},
	},
	"header-menu": {
		purpose:
			"The chat header's real menu: a COPY-ONLY surface. Its rows are still LITERAL English on this head - the chat-header extraction belongs to #1070's held scope - so this case does not claim extracted copy: it asserts that every row renders with copy at all (rather than a screenshot of an empty popup) and that the asks row is present, which is the 'the surface still renders' half of the i18n evidence pair.",
		route: "/chat",
		frames: {
			control: ["header-menu", "header-menu-closed"],
			candidate: ["header-menu", "header-menu-closed"],
		},
		coverage:
			"real assembled app renderer/handlers/store; not native WCV compositor pixels or macOS z-order",
		drive: async (ctx) => {
			const { cdp, wait, press, pressEscape, frame, fixtureMode, session } =
				ctx;
			await fixtureMode("populated");
			await session(0);
			/*
			 * THE MENU BUTTON IS FOUND THE WAY THE ASKS CASE FINDS IT - the header's
			 * own `aria-haspopup` control, marked so the press can address it - which
			 * keeps one way of reaching this control in the file.
			 */
			await cdp.evaluate(
				`(()=>{const h=document.querySelector('[data-tour-tag="chat-header"]');const e=[...h.querySelectorAll('button')].find(e=>e.getAttribute('aria-haspopup')==='menu');if(!e)throw Error('real header menu unavailable');e.setAttribute('data-ci-menu','')})()`,
			);
			await press("[data-ci-menu]");
			await wait(
				`document.querySelectorAll('[role="menuitem"]').length > 0`,
				MENU_TRIGGER_SEEN,
			);
			const labels = await cdp.evaluate(
				`[...document.querySelectorAll('[role="menuitem"]')].map(e=>e.textContent.trim())`,
			);
			assert(labels.length > 0, "the header menu rendered no rows");
			assert(
				labels.every((label) => label.length > 0),
				`a header menu row rendered empty copy: ${JSON.stringify(labels)}`,
			);
			/*
			 * THE ASKS ROW IS THE ONE ROW THIS CASE CAN NAME WITHOUT PINNING A
			 * DIRECTION: it reads "Open asks" or "Close asks" depending on whether the
			 * drawer is up, and the case does not open it. So what is asserted is that
			 * the row is there and that every row carries copy.
			 */
			assert(
				labels.some((label) => /asks/i.test(label)),
				`the header menu lost its asks row: ${JSON.stringify(labels)}`,
			);
			await frame("header-menu");
			await pressEscape();
			await wait(`document.querySelectorAll('[role="menuitem"]').length === 0`);
			await frame("header-menu-closed");
		},
	},
};

/**
 * Run one case's one leg, in its own process.
 *
 * The runner owns what every case needs and no case should re-implement: the
 * working directory the app launches from, the driver import (so a control leg
 * imports the HISTORICAL tree's driver), the launch and CDP attach, the
 * onboarding-script reload, the readiness waits, the frame/measurement store, and
 * a finally that reaps exactly the app this run started.
 */
async function runCase(scenarioName, kind, root, output, records) {
	process.chdir(root);
	process.argv.push(
		"--backend",
		"http://127.0.0.1:8080",
		"--backend-records",
		records,
		"--out",
		output,
	);
	const { rendererDriverApi: api } = await import(
		pathToFileURL(join(root, "scripts/renderer-driver.mjs"))
	);
	/*
	 * THE CASE IS RESOLVED BEFORE ANYTHING IS LAUNCHED, so a name outside the table
	 * cannot get as far as an artifact root, a fixture or an Electron binary.
	 */
	const scenario = CASES[scenarioName];
	assert(scenario, `unknown case ${scenarioName}`);
	let cdp;
	let rc = 1;
	const frames = [];
	const failures = [];
	for (const name of ["SIGTERM", "SIGINT"])
		process.once(
			name,
			() => void api.reapLiveBoots({ code: 143, why: `CI ${name}` }),
		);
	const save = () =>
		writeFileSync(
			join(output, "measurements.json"),
			JSON.stringify({ case: scenarioName, kind, frames, failures }, null, 2),
		);
	/**
	 * Wait for a condition, and ON TIMEOUT SAY WHAT WAS SEEN (#1131). The bare expression
	 * is not enough to tell a press that never landed from a menu that never rendered, so
	 * a caller can pass a second expression read only on the failure path; a diagnostic
	 * that itself fails is reported as such rather than replacing the timeout.
	 */
	async function wait(expression, diagnose) {
		for (let i = 0; i < 150; i++) {
			if (await cdp.evaluate(expression)) return;
			await pause(100);
		}
		let seen = "";
		if (diagnose) {
			try {
				seen = ` - ${await cdp.evaluate(diagnose)}`;
			} catch (error) {
				seen = ` - the diagnostic read itself failed: ${error.message}`;
			}
		}
		throw Error(`Unsettled real UI: ${expression}${seen}`);
	}
	async function press(selector) {
		const target = JSON.stringify(selector);
		await wait(`Boolean(document.querySelector(${target}))`);
		const claim = JSON.stringify(`press-${++pressClaim}`);
		await pressWhenActionable({
			selector,
			/*
			 * The reading is taken IN THE PAGE, because the box, the hit test and the
			 * identity claim all live there. `stable` compares the claim this press set on
			 * the previous read: one press = one unique claim, so the first read is always
			 * unstable and the press waits for a read that sees its own claim still there.
			 */
			probe: async () =>
				cdp.evaluate(
					`(()=>{const el=document.querySelector(${target});if(!el)return{present:false};const r=el.getBoundingClientRect();const label=(n)=>n?[n.tagName.toLowerCase(),n.getAttribute("data-tour-tag")?'[data-tour-tag="'+n.getAttribute("data-tour-tag")+'"]':"",n.getAttribute("role")?'[role="'+n.getAttribute("role")+'"]':"",n.getAttribute("aria-label")?'[aria-label="'+n.getAttribute("aria-label")+'"]':""].join(""):"nothing";if(r.width<=0||r.height<=0)return{present:true,painted:false,at:label(el)};const x=r.x+r.width/2,y=r.y+r.height/2,at=document.elementFromPoint(x,y);const stable=el.__lopPressClaim===${claim};el.__lopPressClaim=${claim};return{present:true,painted:true,hit:at===el||el.contains(at),at:label(at),stable,x:Math.round(x),y:Math.round(y)}})()`,
				),
			dispatch: async (point) => {
				for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
					await cdp.send("Input.dispatchMouseEvent", {
						type,
						button: type === "mouseMoved" ? "none" : "left",
						clickCount: 1,
						...point,
					});
			},
		});
	}
	/**
	 * Poll `probe` until it answers true, and hand back the LAST state read.
	 *
	 * It does not raise: the caller's own assertion is the gate, so the requirement
	 * has exactly one failure path and that path can carry the diagnostics. On a
	 * timeout it simply returns what it last saw, which the caller reports.
	 */
	async function waitFor(probe, timeoutMs) {
		const started = Date.now();
		for (;;) {
			if (await probe()) return await facts();
			if (Date.now() - started > timeoutMs) return await facts();
			await pause(250);
		}
	}
	async function pressEscape() {
		for (const type of ["keyDown", "keyUp"])
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "Escape",
				code: "Escape",
				windowsVirtualKeyCode: 27,
			});
	}
	async function facts() {
		return {
			state: await api.verb(cdp, "state"),
			dom: await cdp.evaluate(
				`({ask:!!document.querySelector('[data-ask-drawer]'),focus:document.activeElement?.outerHTML.slice(0,400),focusedConnected:!!document.activeElement?.isConnected,panes:[...document.querySelectorAll('[data-ask-drawer],[data-tour-tag="browser-pane"]')].map(e=>({ask:e.hasAttribute('data-ask-drawer'),rect:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})),text:document.body.innerText.slice(-1800)})`,
			),
		};
	}
	async function frame(label) {
		const first = await api.capture(cdp, `${kind}-${label}-first`, {
			assertPalette: false,
		});
		const firstFacts = await facts();
		await pause(180);
		const settled = await api.capture(cdp, `${kind}-${label}-settled`, {
			assertPalette: false,
		});
		const measured = await facts();
		for (const pane of measured.dom.panes)
			assert(
				pane.scrollWidth <= pane.clientWidth + 1,
				`${label} horizontal overflow`,
			);
		frames.push({ label, first, settled, firstFacts, ...measured });
		save();
		return measured;
	}
	/**
	 * Record a reading on the case's most recent frame - THE RUNNER'S OWN DOOR, because
	 * the frame store is this function's local and a case cannot reach it (round 2,
	 * Q-4).
	 *
	 * A case stamping `frames.at(-1).something = ...` itself compiles, reads as an
	 * ordinary mutation and dies only where `frames` does not exist: measured on run
	 * 38955215215 as `ReferenceError: frames is not defined at Object.drive
	 * (asks-app-regression.mjs:455:4)`, on the FIRST leg, before either new case had
	 * ever run. So the stamp goes through here, and the guard beside this file drives a
	 * real case against stub helpers so the same slip fails locally.
	 */
	function stamp(key, value) {
		assert(frames.length > 0, `stamp(${key}) with no frame captured yet`);
		frames.at(-1)[key] = value;
		save();
		return frames.at(-1);
	}
	async function fixtureMode(mode) {
		const response = await fetch("http://127.0.0.1:8080/__fixture/state", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ mode }),
		});
		assert.equal(response.status, 200);
	}
	async function session(index) {
		await wait(
			'document.querySelectorAll("[data-tour-tag=chat-session-row]").length===2',
		);
		await cdp.evaluate(
			`(()=>{const e=[...document.querySelectorAll('[data-tour-tag="chat-session-row"]')].find(e=>e.textContent.includes('Synthetic CI session ${index + 1}'));if(!e)throw Error('seeded session row missing');e.setAttribute('data-ci-session','${index}')})()`,
		);
		await press(`[data-ci-session="${index}"]`);
		/*
		 * The open is confirmed by READING the state through the driver, from Node,
		 * in a bounded poll. Calling `window.__loDevDriver.call('state')` inside a
		 * page expression and awaiting its `.then` does NOT work: the verb's return
		 * is not a page promise, so the expression threw
		 * `TypeError: window.__loDevDriver.call(...).then is not a function` (run
		 * 38849663528) and took the case down before any frame. `verb()` already
		 * resolves the answer over CDP - that is the documented door, and it is how
		 * the shared driver's own scenes read this exact field.
		 */
		const wanted = ASK_SESSION_IDS[index];
		const deadline = Date.now() + 20_000;
		for (;;) {
			const live = await api.verb(cdp, "state");
			if (live.activeSessionId === wanted) return;
			if (Date.now() > deadline)
				throw Error(
					`session ${index} never became active (active=${JSON.stringify(live.activeSessionId)})`,
				);
			await pause(250);
		}
	}
	/*
	 * WHAT A CASE DRIVES WITH: the generic helpers only. The asks-only doors
	 * (`browser`, `asks`, `closed`) live inside the asks case, because putting a
	 * case-specific door on a shared context is how a framework starts growing.
	 */
	const ctx = {
		kind,
		api,
		get cdp() {
			return cdp;
		},
		wait,
		press,
		waitFor,
		pressEscape,
		facts,
		frame,
		stamp,
		fixtureMode,
		session,
	};
	try {
		api.prepareDriverContext({ apiUrl: "http://127.0.0.1:8080" });
		const app = await api.launchApp({
			armed: true,
			apiUrl: "http://127.0.0.1:8080",
			tag: `asks-ci-${kind}`,
		});
		writeFileSync(
			join(output, "owned-app.json"),
			JSON.stringify({ pid: app.pid, inspector: app.inspectPort }),
		);
		/*
		 * The debugging endpoint answers `/json/version` before the app has a
		 * window, and `CdpClient.attach` then waits for the page TARGET - so the
		 * endpoint wait comes first, as it does at every other caller in the shared
		 * driver. Attaching straight after `launchApp` is the defect CI caught: the
		 * port was not listening yet, `fetch` REJECTED, and the rejection escaped
		 * the attach loop as a bare `TypeError: fetch failed`.
		 *
		 * WHY THIS IS NOT JUST `api.waitForDevtools`. This case runs against TWO
		 * driver trees: the candidate one from the checkout, and - in the control
		 * leg - the PINNED HISTORICAL tree unpacked from `control-source.tar`,
		 * which is imported from `root/scripts/renderer-driver.mjs` below. That
		 * historical facade exports six keys and no wait (2461cfa3), so calling
		 * the newer surface directly would make the control leg throw for a reason
		 * unrelated to the app. The wait is therefore resolved through the api when
		 * the tree offers it and otherwise repeated here, and what the control leg
		 * needs - a port that is listening before anybody attaches - holds either
		 * way. Same bounded poll, same 60s ceiling, same message.
		 */
		await waitForDevtoolsPort(app, api);
		cdp = await api.CdpClient.attach(app.port, "out/renderer/index.html");
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source:
				'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));',
		});
		await cdp.send("Page.reload", { ignoreCache: false });
		/*
		 * The page paint and the bridge registration, in the order every scene in
		 * the shared driver uses them. Waiting on `Boolean(window.__loDevDriver)`
		 * instead - which is what this did - is satisfied the moment the object
		 * EXISTS, before it has registered a single verb, and the first
		 * `api.verb(cdp, "navigate", …)` then failed with "no dev driver verb
		 * navigate (have: none yet)". Both waits go through the same api-else-poll
		 * resolution as the port wait above, because the control leg imports the
		 * pinned historical facade, which does not export them either.
		 */
		await waitForSceneReady(cdp, api);
		const windowFacts = await cdp.evaluate("window.__loDevDriver.facts()");
		assert.equal(windowFacts.visible, false);
		assert.equal(windowFacts.focused, false);
		await api.verb(cdp, "navigate", scenario.route);
		await scenario.drive(ctx);
		/*
		 * THE PROMISED FRAMES ARE A CONTRACT, not a wish: a case that stops early or
		 * loses a capture fails here rather than publishing an artifact thinner than
		 * it declares. The acceptance row is pushed after this check, so it cannot
		 * stand in for a missing frame.
		 */
		const promised = scenario.frames[kind];
		assert(
			Array.isArray(promised) && promised.length > 0,
			`${scenarioName}: no frames promised for the ${kind} leg`,
		);
		for (const label of promised)
			assert(
				frames.some((entry) => entry.label === label),
				`${scenarioName} ${kind}: promised frame ${JSON.stringify(label)} was not captured (have ${JSON.stringify(frames.map((entry) => entry.label))})`,
			);
		frames.push({
			label: "acceptance",
			verdict: "PASS",
			coverage: scenario.coverage,
		});
		save();
		rc = 0;
	} catch (error) {
		failures.push(error.stack);
		save();
	} finally {
		cdp?.close();
		await api.reapLiveBoots({
			code: rc,
			why: `CI ${scenarioName} ${kind} case complete`,
		});
	}
}

async function main() {
	if (process.argv.includes("--case")) {
		const i = process.argv.indexOf("--case");
		const scenario = process.argv[i + 1];
		const j = process.argv.indexOf("--leg");
		const kind = j >= 0 ? process.argv[j + 1] : undefined;
		const needed = ["ASKS_APP_ROOT", "ASKS_OUTPUT", "ASKS_RECORDS"];
		const missing = needed.filter((name) => !process.env[name]);
		if (
			!Object.hasOwn(CASES, scenario) ||
			!["control", "candidate"].includes(kind) ||
			missing.length > 0
		) {
			console.error(
				`asks-app-regression: --case needs <scenario> from ${Object.keys(CASES).join("|")} --leg control|candidate and ${needed.join(", ")} (missing ${missing.join(", ") || "none"})`,
			);
			process.exitCode = 1;
			return;
		}
		return runCase(
			scenario,
			kind,
			process.env.ASKS_APP_ROOT,
			process.env.ASKS_OUTPUT,
			process.env.ASKS_RECORDS,
		);
	}
	assert.equal(
		process.platform,
		"darwin",
		"Existing macOS NPX leg owns native execution; no Linux sandbox waiver",
	);
	assert(
		process.env.CI,
		"Native regression producer runs in normal CI only; source unit tests import exports",
	);
	const output = resolve("artifacts/asks-app");
	mkdirSync(output, { recursive: true });
	const scratch = join(tmpdir(), `asks-app-ci-${process.pid}`);
	mkdirSync(scratch);
	const token = randomBytes(24).toString("hex");
	const fixture = await startAsksAppFixture({ root: scratch, token });
	for (const entry of [
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	])
		assert(existsSync(entry), `Production build missing ${entry}`);
	const manifest = {
		format: 1,
		requestedHead: process.env.QA_REQUESTED_HEAD,
		checkout: git("rev-parse", "HEAD"),
		sourceTree: git("rev-parse", "HEAD:src"),
		scriptsTree: git("rev-parse", "HEAD:scripts"),
		productionOutputs: Object.fromEntries(
			files(resolve("out")).map((p) => [
				p.slice(resolve("out").length + 1),
				sha(readFileSync(p)),
			]),
		),
		control: ASKS_CONTROL,
		cases: Object.keys(CASES),
		captures: [],
		physical1106:
			"NOT COVERED: capturePage excludes sibling native WebContentsView/compositor",
		fixture: "owned loopback HTTP; no bridge or UI replacements",
	};
	let primaryError = null;
	try {
		manifest.controlIdentity = await prepareControl(
			join(scratch, "control-app"),
			output,
		);
		const controlArchive = join(output, "control-source.tar");
		manifest.controlSourceArchive = {
			path: "control-source.tar",
			sha256: sha(readFileSync(controlArchive)),
		};
		for (const [scenarioName, scenario] of Object.entries(CASES)) {
			for (const kind of ["control", "candidate"]) {
				fixture.setMode("loading");
				const root =
					kind === "control" ? join(scratch, "control-app") : process.cwd();
				/*
				 * THE ASKS CASE KEEPS `<output>/control|candidate` (see its
				 * `legacyOutputLayout` note); every other case gets its own directory,
				 * so two cases cannot overwrite each other's measurements.
				 */
				const dir = scenario.legacyOutputLayout
					? join(output, kind)
					: join(output, scenarioName, kind);
				mkdirSync(dir, { recursive: true });
				await execute(
					process.execPath,
					[
						fileURLToPath(import.meta.url),
						"--case",
						scenarioName,
						"--leg",
						kind,
					],
					{
						cwd: root,
						env: {
							...process.env,
							LOCAL_OPERATOR_DESKTOP_TOKEN: token,
							LOCAL_OPERATOR_CONFIG_DIR: scratch,
							LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
							LOCAL_OPERATOR_UI_TELEMETRY: "off",
							ASKS_APP_ROOT: root,
							ASKS_OUTPUT: dir,
							ASKS_RECORDS: fixture.records,
						},
						timeout: 150000,
						maxBuffer: 4 * 1024 * 1024,
					},
				);
				const measured = JSON.parse(
					readFileSync(join(dir, "measurements.json"), "utf8"),
				);
				assert(measured.frames.some((x) => x.verdict === "PASS"));
				/*
				 * A CASE'S RECORDED READINGS ARE LIFTED INTO THE MANIFEST, so a reviewer
				 * skimming `manifest.json` sees the evidence pair without unpacking every
				 * leg's `measurements.json`: the asks case records which close policy each
				 * revision has here, control beside candidate (remediation round 1, stream A).
				 */
				const readings = Object.fromEntries(
					measured.frames
						.filter((frame) => frame.railClosePolicy)
						.map((frame) => [frame.label, frame.railClosePolicy]),
				);
				manifest.captures.push({
					case: scenarioName,
					kind,
					...(Object.keys(readings).length > 0 ? { readings } : {}),
					files: files(dir).map((p) => ({
						path: p.slice(output.length + 1),
						sha256: sha(readFileSync(p)),
					})),
				});
			}
		}
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		manifest.requests = fixture.requests;
		writeFileSync(
			join(output, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);
		/*
		 * THE CLOSE COMES BEFORE THE TRAFFIC ASSERTIONS, and that ordering is the
		 * fix for a measured hang rather than a tidiness preference. The assertions
		 * used to sit ahead of it, so the first one that threw skipped
		 * `fixture.close()` entirely: the fixture's HTTP listener stayed open, the
		 * child producer was left holding it, and the CI step ran on with nothing
		 * to do until GitHub killed it at its own 8-minute ceiling (measured on run
		 * 38844071896: the assertion failed at 03:30:46, the step was killed at
		 * 03:37:55, and `node` was then reaped as an orphan). A failed assertion is
		 * a verdict; a leaked listener is an outage that hides it.
		 *
		 * The assertions also do not run over a run that ALREADY failed: a second
		 * message about traffic says nothing the first failure did not, and burying
		 * a real failure under a derived one is the pattern this suite exists to
		 * remove.
		 */
		await fixture.close();
		if (primaryError === null) assertTrafficAllowed(fixture.requests);
	}
}

/**
 * Every request this run made of the fixture, against what the fixture is
 * allowed to have served.
 *
 * Reads only, plus the two modelled POSTs: `/watch`, the push subscription the
 * fixture answers, and `/__fixture/state`, its own control door. The Radient
 * proxy (`POST /v1/desktop/radient`) is a POST the app legitimately makes for its
 * quota notice and the fixture answers for the READ operations only, so it is
 * admitted here as a read door - the forbidden-write pattern below is what keeps
 * the turn and answer routes shut, and it is checked first.
 */
function assertTrafficAllowed(requests) {
	const forbidden =
		/\/(send|answer|answers|interrupt|steer|messages|turns)(\/|$|\?)/;
	for (const request of requests) {
		assert(
			!forbidden.test(request.path),
			`fixture traffic reached a forbidden write: ${request.method} ${request.path}`,
		);
		const allowedPost = [
			"/watch",
			"/__fixture/state",
			"/v1/desktop/radient",
		].some((suffix) => request.path.endsWith(suffix));
		assert(
			request.method === "GET" || allowedPost,
			`fixture traffic used an unmodelled method: ${request.method} ${request.path}`,
		);
		/*
		 * THE PROPERTY IS "NO UNAUTHENTICATED WRITE", NOT "EVERY READ CARRIES A
		 * BEARER", and the difference is measured rather than assumed. The app's
		 * desktop transport attaches `Authorization` only when it holds a token
		 * (`desktop-transport.ts`: the header is spread in `...(token ? … : {})`, and
		 * `request.op !== "capabilities" && !token` is an explicit no-token path), so
		 * a read issued before the app has resolved one is ordinary app behaviour -
		 * measured here as 7 unauthenticated requests out of 153 in run 38852393821,
		 * of them `/v1/credentials` (3) beside `/health` (4). The fixture answers
		 * those 401, so nothing unauthenticated is ever served.
		 *
		 * What the scene must refuse is an unauthenticated request that is not a
		 * READ, and that is what is asserted: a bare read is the app asking a
		 * question, while a bare write would be this fixture's door left open.
		 */
		assert(
			request.authenticated || request.method === "GET",
			`fixture traffic was an unauthenticated non-read: ${request.method} ${request.path}`,
		);
	}
}
if (isEntryPoint(import.meta.url))
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
