/**
 * Driver for the asks-on-rail frames (#896): the seven cases, before and after,
 * driven through the real renderer over raw CDP.
 *
 *   node drive-asks.mjs --after http://localhost:5341 \
 *        --scratch <rig scratch> --out <out dir>            # one arm per invocation
 *
 * (`--before <url>` for the other arm, on a rig stood up again for it - see "THE
 * TWO ARMS" below for why the two flags are refused together. Each invocation
 * writes `run-<arm>-<palette>.json` and `<case>/<arm>/<palette>.webp` under
 * `--out`, so the two arms land side by side in one directory.)
 *
 * ONE private headless Chrome (the repository's `chrome-keychain` switch applied)
 * serves the whole run, and EVERY CASE GETS ITS OWN BROWSER CONTEXT inside it. The
 * context is the point: the drawer's flag rides the store's persisted blob and the
 * slot's pane flags are store state, so a case that shared a profile with the one
 * before it would inherit its open pane and photograph a state nobody drove - and
 * a fresh launch per case is the measured fleet problem this shape avoids
 * (`rig-lib.mjs` has the number).
 *
 * THE TWO ARMS ARE THE SAME DRIVER OVER THE SAME KIND OF BACKEND, NEVER THE SAME
 * ONE: ONE ARM PER INVOCATION, EACH ON A RIG STOOD UP FOR IT. `--before` serves
 * `origin/main` and `--after` serves this branch, and the only thing meant to
 * differ between a before frame and an after frame is the renderer tree - which
 * holds only if both arms start from the same backend state. Run back to back on
 * ONE rig they do not: the `ask-open` case ENQUEUES a pending ask onto B's queue
 * (and `fleet-draft`'s drawer lists every session's outstanding asks), so an arm
 * driven second over one rig would photograph a queue the first arm already
 * wrote. The driver therefore REFUSES both flags at once (see the check below),
 * and `rig-up.sh` is run once per arm; it wipes and restarts the whole rig, so
 * the second arm starts as clean as the first.
 *
 * WHAT EACH CASE READS, because a frame alone is a claim the pixels may not
 * carry. Every case records:
 *
 *  - `probe()` (rig-lib): which pane is MOUNTED (`drawn`), which rail item the app
 *    LIGHTS (`railLit`, computed over the five items - the asks one included, so
 *    the before arm's absence of the item reads as `null`, never as "not
 *    pressed"), the pane and column boxes, the asks chrome counts and the
 *    composer;
 *  - `doorSource` (this file): WHERE the ask door lives - `closest('[data-panel-rail]')`
 *    or `closest('[data-tour-tag="chat-header"]')` - plus its `data-ask-scope`,
 *    its pressed/expanded attribute and the badge inside it, and the drawer's own
 *    marker (`[data-lo-ask-surfaces]`, scope from `data-ask-drawer`). #896's whole
 *    claim is a move, so the door's LOCATION is a first-class reading;
 *  - `menuSource` (this file, the two menu cases): the `...` menu's items as
 *    rendered - the panel rows are filtered out of the full list rather than
 *    assumed, and the count recorded, because the change adds exactly one row.
 *
 * THE CASES (see the set's README for the matrix they fill):
 *
 *   rail-closed     B with nothing up: the door's home and the rail's items
 *   pane-open       the Browser pane holds the slot: what the rail lights
 *   menu-open       the header `...` menu's panel rows (plus `Open asks` after)
 *   menu-open-1024   the same menu at 1024x900
 *   swap            browser open, then the ask door: the drawer takes the slot
 *   ask-open        a pending ask raised DURING the view; the door pressed
 *   fleet-draft     New chat: the door's scope is the fleet's
 *
 * THE RAISE IS PACED, and the reason is the app's own open policy
 * (`ask-open-policy.ts`): an ask that existed before a view began opens the
 * drawer BY ITSELF, once. This set's `ask-open` claim is that the PRESS opened
 * it, so the ask is raised well AFTER B's view has begun (outside the policy's
 * 5 s arrival skew), and the reading taken immediately before the press is
 * checked to show the drawer DOWN - a raise that landed inside the skew would
 * otherwise make the door's press a toggle that CLOSES it, and the case fails
 * loudly instead of photographing the wrong claim.
 *
 * WHY `swap` RUNS BEFORE `ask-open`: with no pending asks on B, the policy has
 * nothing to open - the drawer in `swap`'s frame is the press's alone, on both
 * arms. After the enqueue, every later case would see a drawer the policy could
 * legitimately open on arrival, which would make a "the press swapped it" still a
 * picture of two effects instead of one.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	SESSION,
	backendReading,
	command,
	connect,
	launchChrome,
	makeProfile,
	openPage,
	wait,
} from "./rig-lib.mjs";

/* ------------------------------------------------------------------ arguments ---- */

const argv = process.argv.slice(2);
const flag = (name) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? null : (argv[at + 1] ?? "");
};
const AFTER = flag("after");
const BEFORE = flag("before");
const SCRATCH = flag("scratch");
const OUT = flag("out");
const ONLY = (flag("only") ?? "").split(",").filter(Boolean);
/*
 * ONE PALETTE PER INVOCATION, and one rig lifetime per (arm, palette) pair.
 *
 * WHY THE PALETTE IS NOT A LOOP INSIDE THE RUN. The ask cases WRITE to the shared
 * backend - `ask-open` enqueues a pending ask onto B - so a second palette driven
 * over the same backend would photograph a queue carrying the previous palette's
 * ask, and the two stills of one case would then differ by something that is not
 * the theme. The same argument the header makes for the two arms, one axis over:
 * the README's commands stand a rig up per (arm, palette) and the rig is wiped
 * and restarted between them.
 *
 * The frame's FILE NAME is its palette, so each still is judged against the theme
 * it claims (`check-evidence.mjs`: a `.webp` whose stem resolves to no palette is
 * refused). Light seeds `ui-preferences-storage` before the app boots - the
 * mechanism the other live sets use - and dark seeds nothing, because dark IS the
 * app default and a seeded dark would be a second spelling of the same state.
 */
const THEME = flag("theme") ?? "localOperatorDark";
const EXPLORE = argv.includes("--explore");
if ((!AFTER && !BEFORE) || !SCRATCH || (!OUT && !EXPLORE)) {
	console.error(
		"usage: drive-asks.mjs (--after <url> | --before <url>) --scratch <rig scratch> --out <dir> [--theme localOperatorDark] [--only rail-closed,ask-open] [--explore]",
	);
	process.exit(2);
}
if (AFTER && BEFORE) {
	/*
	 * A REFUSAL, NOT A WARNING: a run that photographs both arms over one backend
	 * produces a complete-looking pair whose only defect is that the second arm saw
	 * the first arm's write (the header note has the readings), and nothing in the
	 * frames says so. Stand the rig up once per arm instead - the README's commands
	 * are exactly that.
	 */
	console.error(
		"drive-asks.mjs: ONE ARM PER INVOCATION. The ask-open case enqueues a pending ask on the backend, so an arm run on the same backend photographs a queue the other arm already wrote. Run rig-up.sh, drive ONE arm, run rig-down.sh, then do the other arm on a freshly started rig.",
	);
	process.exit(2);
}

/* ------------------------------------------------------------------- constants ---- */

const SETTLE = 2500;
/**
 * How long B's view is left alone before the ask is raised (the pacing note in
 * the header): the policy's arrival skew is 5000 ms, so 6000 leaves the raise
 * outside it with the enqueue's own round trip on top.
 */
const RAISE_DELAY_MS = 6000;
const DOOR = '[data-tour-tag="ask-pane-trigger"]';
const DRAWER = "[data-lo-ask-surfaces]";
const CHIP = "[data-lo-ask-item-toggle]";
const BADGE = '[data-tour-tag="ask-pane-badge"]';
const MENU_TRIGGER = '[aria-label="Conversation actions"]';
const MENU = '[role="menu"]';
const COMPOSER = 'textarea[aria-label="Message"]';

const at = (name) => `#/chat/${SESSION[name]}`;
/* The conversation column, by the app's own layout handle (see `rig-lib.mjs`). */
const COLUMN = `document.querySelector('[data-tour-tag="chat-column"]') !== null`;
const paneDrawn = (pane) => {
	const hook = { canvas: "canvas-dock", run: "run-panel-dock", browser: "browser-pane-slot", console: "console-pane-slot", ask: "ask-drawer-slot" }[pane];
	return `document.querySelector('[data-tour-tag="${hook}"]') !== null`;
};
const drawerUp = `document.querySelector(${JSON.stringify(DRAWER)}) !== null`;
const stateStep = (expression) => `window.__loDevDriver.call("state").${expression}`;

/* ============================ page-side readers ============================== */

/**
 * WHERE THE ASK DOOR LIVES, what it reports, and what the rail holds, at one
 * instant.
 *
 * WHY LOCATION IS THE FIRST READING. #896's claim is a MOVE: the control that was
 * the header's trigger is the rail's fifth item. `closest` is the reading rather
 * than a class match because it answers the claim directly - the door element is
 * the same `data-tour-tag` in both arms (that tag is the drawer's focus-return
 * anchor and did not change), so only its ancestor says which half shipped.
 *
 * THE RAIL TABLE IS READ WHOLE (id, pressed, label) rather than pre-filtered: the
 * `lit` list is derived from it here, and the report keeps the raw rows so a
 * reader can check the derivation. On the before arm the asks item is ABSENT -
 * `null` for its hook, never `"false"` - which is the difference the frames show.
 */
const doorSource = () => {
	const door = document.querySelector('[data-tour-tag="ask-pane-trigger"]');
	const rail = door ? door.closest("[data-panel-rail]") : null;
	const header = door ? door.closest('[data-tour-tag="chat-header"]') : null;
	const badge = door ? door.querySelector('[data-tour-tag="ask-pane-badge"]') : null;
	const items = [...document.querySelectorAll("[data-panel-rail-item]")].map((el) => ({
		id: el.getAttribute("data-panel-rail-item"),
		pressed: el.getAttribute("aria-pressed"),
		label: (el.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim(),
	}));
	const surfaces = document.querySelector("[data-lo-ask-surfaces]");
	return {
		door: {
			present: Boolean(door),
			location: rail ? "rail" : header ? "header" : door ? "elsewhere" : null,
			ariaLabel: door ? door.getAttribute("aria-label") : null,
			ariaPressed: door ? door.getAttribute("aria-pressed") : null,
			ariaExpanded: door ? door.getAttribute("aria-expanded") : null,
			dataAskScope: door ? door.getAttribute("data-ask-scope") : null,
			badge: {
				present: Boolean(badge),
				text: badge ? (badge.textContent ?? "").trim() : null,
			},
		},
		rail: {
			present: document.querySelector("[data-panel-rail]") !== null,
			itemCount: items.length,
			items,
			lit: items.filter((item) => item.pressed === "true").map((item) => item.id),
		},
		drawer: {
			up: Boolean(surfaces),
			scope: surfaces ? surfaces.getAttribute("data-ask-drawer") : null,
			label: surfaces ? surfaces.getAttribute("aria-label") : null,
		},
	};
};

/**
 * The header `...` menu's items as rendered, with the PANEL rows filtered out of
 * the full list.
 *
 * WHY THE FULL LIST AND THE FILTER. The menu holds conversation actions as well
 * as panel rows, and which rows the panes contribute is a function of the
 * conversation (Run details is gated on `runDetails`, the asks row on the host's
 * offer). Recording the whole list means the count in the README is checkable
 * against the record, and the filter is a predicate over the rendered strings -
 * not a pre-written list of what the case expects to find.
 */
const menuSource = () => {
	const menu = document.querySelector('[role="menu"]');
	if (!menu) return { open: false, items: [], panelRows: [], count: 0 };
	const items = [...menu.querySelectorAll('[role="menuitem"]')].map((el) => ({
		text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
		disabled:
			el.getAttribute("aria-disabled") === "true" ||
			el.hasAttribute("data-disabled"),
	}));
	const PANEL = /^(Run details|Open asks|Close asks|Open browser|Close browser|Open console|Close console|Open canvas|Close canvas)$/;
	return {
		open: true,
		items,
		panelRows: items.map((item) => item.text).filter((text) => PANEL.test(text)),
		count: items.length,
	};
};

/* ---------------------------------------------------------------------- chrome ---- */

const profile = makeProfile();
const chrome = launchChrome({ profile });
let chromeExited = false;
chrome.on("exit", () => {
	chromeExited = true;
});
const { raw, close } = await connect(chrome);
const openPageFor = (url, arm, outDir, options = {}) =>
	openPage(raw, { url, outDir, arm, ...options });

/* --------------------------------------------------------------------- helpers ---- */

/** Wait for the composer: the conversation (or the draft) is up. */
const ready = (page) =>
	page.waitFor(`document.querySelector('${COMPOSER}') !== null`, "the composer");

const openAt = async (page, key) => {
	await page.open(at(key));
	await page.waitFor(
		`location.hash.includes(${JSON.stringify(SESSION[key])})`,
		`the ${key} route`,
	);
};

/** One page-side read of the door/rail/drawer, as a plain object. */
const readDoor = (page) => page.call(doorSource);
/** One page-side read of the open menu. */
const readMenu = (page) => page.call(menuSource);

const seq = { n: 0 };
const ask = (body) => command(SCRATCH, SESSION.B, body, seq);

/* --------------------------------------------------------------------- the cases ---- */

const CASES = [
	{
		name: "rail-closed",
		label: "rail-closed",
		title: "B with nothing up: where the ask door lives; the rail's items",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await ready(page);
			const reading = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			const frames = { closed: await page.shot("rail-closed") };
			return { frames, readings: { closed: reading } };
		},
	},
	{
		name: "pane-open",
		label: "pane-open",
		title: "the Browser pane holds the slot; what the rail lights",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await page.pressRail("browser");
			await page.waitFor(paneDrawn("browser"), "the browser pane");
			await wait(SETTLE);
			const reading = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			const frames = { open: await page.shot("pane-open") };
			return { frames, readings: { open: reading } };
		},
	},
	{
		name: "menu-open",
		label: "menu-open",
		title: "the header `...` menu's panel rows",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await page.press(MENU_TRIGGER, "the conversation-actions menu trigger");
			await page.waitFor(`document.querySelector('${MENU}') !== null`, "the menu");
			await wait(600);
			const reading = {
				menu: await readMenu(page),
				probe: await page.probe(),
				door: await readDoor(page),
			};
			const frames = { menu: await page.shot("menu-open") };
			return { frames, readings: { menu: reading } };
		},
	},
	{
		name: "menu-open-1024",
		label: "menu-open-1024",
		title: "the same menu at 1024x900 (the narrow window's door)",
		arms: ["before", "after"],
		viewport: { width: 1024, height: 900 },
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await page.press(MENU_TRIGGER, "the conversation-actions menu trigger");
			await page.waitFor(`document.querySelector('${MENU}') !== null`, "the menu");
			await wait(600);
			const reading = {
				menu: await readMenu(page),
				probe: await page.probe(),
				door: await readDoor(page),
			};
			const frames = { menu: await page.shot("menu-open-1024") };
			return { frames, readings: { menu: reading } };
		},
	},
	{
		name: "swap",
		label: "swap",
		title: "with the browser open, the ask door's press takes the slot",
		arms: ["before", "after"],
		async run(page) {
			/*
			 * BEFORE THE RAISE, DELIBERATELY (see the header's pacing note): with no
			 * pending asks the policy has nothing to open, so the drawer in this frame
			 * is the press's alone on both arms.
			 */
			await openAt(page, "B");
			await wait(SETTLE);
			await page.pressRail("browser");
			await page.waitFor(paneDrawn("browser"), "the browser pane");
			await wait(SETTLE);
			const before = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			await page.press(DOOR, "the ask door");
			await page.waitFor(drawerUp, "the asks drawer", 15_000);
			await wait(1200);
			const swapped = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			const frames = { swapped: await page.shot("swap") };
			return { frames, readings: { before, swapped } };
		},
	},
	{
		name: "ask-open",
		label: "ask-open",
		title: "a pending ask raised during the view; the door pressed",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await ready(page);
			/*
			 * THE RAISE IS PACED (header note): left alone past the policy's 5 s arrival
			 * skew so the ask is an ARRIVAL - the drawer it could open by itself stays
			 * down, and the press below is the one door the frame shows.
			 */
			const before = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			await wait(RAISE_DELAY_MS);
			const enqueued = await ask({
				op: "enqueue",
				question: "Which environment should I deploy the release candidate to?",
				options: ["Staging", "Production", "Hold off"],
			});
			await page.waitFor(
				`document.querySelector('${CHIP}') !== null || document.querySelector('${BADGE}') !== null`,
				"the ask to arrive",
				20_000,
			);
			await wait(SETTLE);
			const arrived = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			if (arrived.door.drawer.up) {
				throw new Error(
					"ask-open: the drawer was already up before the press - the raise landed inside the open policy's arrival skew, and a press would toggle it shut rather than open it",
				);
			}
			await page.press(DOOR, "the ask door");
			await page.waitFor(drawerUp, "the asks drawer", 15_000);
			await wait(1200);
			const open = {
				probe: await page.probe(),
				door: await readDoor(page),
				memory: await page.memory(),
			};
			const frames = { open: await page.shot("ask-open") };
			return {
				frames,
				readings: { before, arrived, open },
				enqueued: enqueued.ask_id ?? null,
				backend: backendReading(SCRATCH, SESSION.B, null),
			};
		},
	},
	{
		name: "fleet-draft",
		label: "fleet-draft",
		title: "New chat: the door's scope is the fleet's, and the drawer follows",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await page.pressNewChat();
			await page.waitFor(`${stateStep("activeDraftKey")} !== null`, "the draft");
			await ready(page);
			await wait(SETTLE);
			/*
			 * THE DOOR ON A DRAFT IS OFFERED BY THE FLEET ROUTE (`fleetAsks.answered`),
			 * so it can arrive a moment after the composer does - waited for rather than
			 * assumed, and its scope read off the element before the press.
			 */
			await page.waitFor(
				`document.querySelector('${DOOR}') !== null`,
				"the ask door on the draft",
				20_000,
			);
			const before = {
				probe: await page.probe(),
				door: await readDoor(page),
			};
			await page.press(DOOR, "the ask door");
			await page.waitFor(drawerUp, "the fleet drawer", 15_000);
			await wait(1200);
			const open = {
				probe: await page.probe(),
				door: await readDoor(page),
			};
			const frames = { open: await page.shot("fleet-draft") };
			return { frames, readings: { before, open } };
		},
	},
];

/*
 * THE RUN ORDER IS PART OF THE DESIGN, not a convenience: `swap` must run before
 * the raise (header note), so the policy has nothing to open, and the two menu
 * cases run with B's queue empty for the same reason. Sorted rather than authored
 * in this order so the list above stays readable.
 */
const RUN_ORDER = ["rail-closed", "pane-open", "menu-open", "menu-open-1024", "swap", "ask-open", "fleet-draft"];
for (const testCase of CASES) {
	if (!RUN_ORDER.includes(testCase.name)) {
		throw new Error(`case ${testCase.name} is missing from RUN_ORDER`);
	}
}
CASES.sort((a, b) => RUN_ORDER.indexOf(a.name) - RUN_ORDER.indexOf(b.name));

/* ------------------------------------------------------------------------- run ---- */

const report = {
	arms: {},
	notes: {
		after: AFTER,
		before: BEFORE,
		theme: THEME,
		viewport:
			"1380x900 @1x unless the case names a size; one headless Chrome, one browser context per case",
		doorSelector: DOOR,
		pacing: `the ask is raised ${RAISE_DELAY_MS} ms after B's view is up (outside the open policy's 5000 ms arrival skew)`,
	},
};

/** One case on one arm in this invocation's palette, in its own browser context; a failure is a record, not a stop. */
async function runCase(testCase, arm, url, theme) {
	const page = await openPageFor(url, arm, OUT, {
		viewport: testCase.viewport,
		theme,
	});
	const started = Date.now();
	try {
		const result = await testCase.run(page, arm);
		return {
			title: testCase.title,
			theme,
			ok: true,
			ms: Date.now() - started,
			...result,
		};
	} catch (error) {
		const failure = {
			title: testCase.title,
			ok: false,
			error: String(error?.stack ?? error),
		};
		try {
			failure.probe = await page.probe();
			failure.door = await readDoor(page);
			failure.failureFrame = await page.shot(`${testCase.label}-failure`);
		} catch {
			/* the page may be gone; the error above is the record */
		}
		return failure;
	} finally {
		await page.close();
	}
}

try {
	if (EXPLORE) {
		const arm = AFTER ? "after" : "before";
		const page = await openPageFor(AFTER ?? BEFORE, arm, OUT ?? "/tmp", {});
		const out = {};
		await openAt(page, "B");
		await wait(SETTLE);
		out.railClosed = { probe: await page.probe(), door: await readDoor(page) };
		await page.press(MENU_TRIGGER, "the conversation-actions menu trigger");
		await page.waitFor(`document.querySelector('${MENU}') !== null`, "the menu");
		out.menu = await readMenu(page);
		report.explore = out;
		await page.close();
	} else {
		mkdirSync(OUT, { recursive: true });
		const arms = ["before", "after"].filter((arm) => (arm === "before" ? BEFORE : AFTER));
		for (const arm of arms) {
			report.arms[arm] = {};
			for (const testCase of CASES) {
				if (!testCase.arms.includes(arm)) continue;
				if (ONLY.length > 0 && !ONLY.includes(testCase.name)) continue;
				report.arms[arm][testCase.name] = await runCase(
					testCase,
					arm,
					arm === "before" ? BEFORE : AFTER,
					THEME,
				);
			}
			writeFileSync(
				join(OUT, `run-${arm}-${THEME}.json`),
				`${JSON.stringify(
					{
						arm,
						theme: THEME,
						origin: arm === "before" ? BEFORE : AFTER,
						cases: report.arms[arm],
					},
					null,
					2,
				)}\n`,
			);
		}
	}
} catch (error) {
	report.fatal = String(error?.stack ?? error);
} finally {
	console.log(JSON.stringify(report, null, 2));
	try {
		await close();
	} catch {
		/* already gone */
	}
	if (!chromeExited) chrome.kill();
	await wait(800);
	/*
	 * Survivors, by the profile path this run created (never by program name):
	 * Chrome's helper processes carry the same `--user-data-dir`, so a leaked one is
	 * visible here.
	 */
	const { spawnSync } = await import("node:child_process");
	const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
	const leaked = ps.stdout
		.split("\n")
		.filter((line) => line.includes(profile) && !line.includes("ps -axo"));
	console.error(
		leaked.length === 0
			? `reaped: no process holds ${profile}`
			: `LEAKED ${leaked.length} process(es) holding ${profile}:\n${leaked.join("\n")}`,
	);
	report.reap = { profile, leaked: leaked.length };
}
