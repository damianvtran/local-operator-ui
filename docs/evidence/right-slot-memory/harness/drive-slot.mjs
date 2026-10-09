/**
 * Driver for the right-slot-memory frames (#894): the six cases, before and after,
 * driven through the real renderer over raw CDP.
 *
 *   node drive-slot.mjs --after http://localhost:5321 \
 *        --scratch <rig scratch> --out <out dir>            # one arm per invocation
 *
 * (`--before <url>` for the other arm, on a rig stood up again for it - see "THE
 * TWO ARMS" below for why the two flags are refused together. Each invocation
 * writes `run-<arm>.json` and `<case>/<arm>/<palette>.webp` under `--out`, so the
 * two arms land side by side in one directory.)
 *
 * ONE private headless Chrome (the repository's `chrome-keychain` switch applied)
 * serves the whole run, and EVERY CASE GETS ITS OWN BROWSER CONTEXT inside it. The
 * context is the point: the slot's occupant is remembered in `localStorage`, so a
 * case that shared a profile with the one before it would inherit its memories and
 * photograph a state nobody drove - and a fresh launch per case is the measured
 * fleet problem this shape avoids (`rig-lib.mjs` has the number).
 *
 * THE TWO ARMS ARE THE SAME DRIVER OVER THE SAME KIND OF BACKEND, NEVER THE SAME
 * ONE: ONE ARM PER INVOCATION, EACH ON A RIG STOOD UP FOR IT. `--before` serves
 * `origin/main` and `--after` serves this branch, and the only thing meant to
 * differ between a before frame and an after frame is the renderer tree - which
 * holds only if both arms start from the same backend state. Run back to back on
 * ONE rig they do not: the draft-admission case SENDS a message, which the daemon
 * admits as a new conversation, so an after arm driven second over one rig would
 * photograph a sidebar the before arm already wrote. The driver therefore REFUSES
 * both flags at once (see the check below), and `rig-up.sh` is run once per arm; it
 * wipes and restarts the whole rig, so the second arm starts as clean as the first.
 *
 * WHAT EACH CASE READS, because a frame alone is a claim the pixels may not carry:
 * `probe()` (which pane is MOUNTED, which rail item the app LIGHTS, the pane's box,
 * the leading column's box, the asks chrome, the composer, what holds focus, and
 * the size of the `ui-preferences-storage` blob), `memory()` (the store's own
 * `state()` verb: `rightSlotKey`, the memory pairs, the four flags and the asks
 * flag), and - for the cases whose claim is about an INSTANT rather than an end
 * state - the rAF sampler, one mark per animation frame (`probe-hop.mjs` is the
 * same sampler with a longer burst, for the hop's own bound).
 *
 * THE CASES (see the set's README for the matrix they fill):
 *
 *   s1 switch-restores     canvas on A, hop to B, hop back; a burst across each hop
 *   s2 restart-on-b        canvas on A, hop to B, RELOAD; B clean, A still remembers
 *   s3 draft-admission     panel on A, New chat, browser pane on the draft, send it
 *   s4 asks-borrow         B remembers the canvas, a pending ask, the drawer by hand
 *                          and closed by BOTH doors - the button and Escape
 *   s5 narrow-arrival      the same hop at 1024x900, where the canvas would overlay
 *   s6 run-frame-arrival   B remembers the run panel; the app's own arrival gate
 *                          (sampler, for the timeline) and the HELD-arrival still
 *                          (the daemon's frame-response hold; see the block below)
 *   s7 console-restore     B remembers the console; hop away and back - the pane
 *                          returns and draws its designed empty state
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	SAMPLER_COLUMNS,
	backendReading,
	backendSessions,
	command,
	connect,
	countMarks,
	launchChrome,
	makeProfile,
	openPage,
	summariseTimeline,
	wait,
	waitForAssistantTurn,
} from "./rig-lib.mjs";
import { SESSION } from "./rig-lib.mjs";

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
 * WHY THE PALETTE IS NOT A LOOP INSIDE THE RUN. Two of these cases WRITE to the
 * shared backend - the draft-admission case is admitted as a NEW conversation, and
 * the borrow case raises a pending ask - so a second palette driven over the same
 * backend would photograph a sidebar with one more conversation in it, or a queue
 * with one more ask, and the two stills of one case would then differ by something
 * that is not the theme. The same argument the header makes for the two arms, one
 * axis over: the README's commands stand a rig up per (arm, palette) and the rig is
 * wiped and restarted between them.
 *
 * The frame's FILE NAME is its palette, so each still is judged against the theme it
 * claims (`check-evidence.mjs`: a `.webp` whose stem resolves to no palette is
 * refused). Light seeds `ui-preferences-storage` before the app boots - the
 * mechanism the other live sets use - and dark seeds nothing, because dark IS the
 * app default and a seeded dark would be a second spelling of the same state.
 */
const THEME = flag("theme") ?? "localOperatorDark";
const EXPLORE = argv.includes("--explore");
if ((!AFTER && !BEFORE) || !SCRATCH || (!OUT && !EXPLORE)) {
	console.error(
		"usage: drive-slot.mjs (--after <url> | --before <url>) --scratch <rig scratch> --out <dir> [--theme localOperatorDark] [--only s1,s3] [--explore]",
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
		"drive-slot.mjs: ONE ARM PER INVOCATION. The draft-admission case sends a message, which admits a new conversation on the backend, so an after arm run on the same backend photographs a sidebar the before arm already wrote. Run rig-up.sh, drive ONE arm, run rig-down.sh, then do the other arm on a freshly started rig.",
	);
	process.exit(2);
}

/* ------------------------------------------------------------------- constants ---- */

const SETTLE = 2500;
/** The burst across one hop: long enough to hold the arrival and its settle. */
const HOP_MS = 2500;
const MESSAGE =
	"Carry on with the checklist - I will confirm the deploy target shortly.";
const DRAWER = '[data-tour-tag="ask-drawer-slot"]';
const CHIP = "[data-lo-ask-item-toggle]";
const CLOSE_ASKS = '[aria-label="Close asks"]';
const COMPOSER = 'textarea[aria-label="Message"]';
const PAGE_HOOKS = ["canvas", "run", "browser", "console", "ask"];

const at = (name) => `#/chat/${SESSION[name]}`;
/* The conversation column, by the app's own layout handle (see `rig-lib.mjs`). */
const COLUMN = `document.querySelector('[data-tour-tag="chat-column"]') !== null`;
const paneDrawn = (pane) => {
	const hook = { canvas: "canvas-dock", run: "run-panel-dock", browser: "browser-pane-slot", console: "console-pane-slot", ask: "ask-drawer-slot" }[pane];
	return `document.querySelector('[data-tour-tag="${hook}"]') !== null`;
};
const stateStep = (expression) => `window.__loDevDriver.call("state").${expression}`;
/** Which shape the canvas is in at this width - the app writes its own `docked`/`overlay` fact. */
const canvasMode = (page) =>
	page.evaluate(
		`document.querySelector('[data-tour-tag="canvas-dock"]')?.getAttribute("data-canvas-mode") ?? null`,
	);

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

/** A hop the way a user switches conversation: press the row, wait for the route. */
const hop = (page, key) => page.pressRow(key);

const seq = { n: 0 };
const ask = (body) => command(SCRATCH, SESSION.B, body, seq);

/*
 * THE PRE-FRAME ARRIVAL, IN TWO RECORDINGS (design review round 1, D1). The window
 * this case is about is ~60ms wide - the flag projects at the bind, the pane draws
 * when its canonical frame lands - and ONE recording cannot carry both its length
 * and its pixels:
 *
 *  - the app's OWN gate, for the timeline: the sampler marks every animation frame
 *    IN THE PAGE (`startSampler`), so the window is recorded every run whether or
 *    not a shutter could catch it - no race, and the numbers are the app's. A
 *    screenshot cannot replace this: CDP `Page.captureScreenshot` paints/fetches a
 *    fresh surface, and a capture requested inside the window was measured - while
 *    iterating this round - to produce a frame of the DRAWN pane while two DOM
 *    readings bracketing the request both showed the empty column.
 *  - the HELD arrival, for the still: the same state, with its stay extended by the
 *    daemon's own hold (`HoldStreamStart` in `serve-slot.py` - the design round's
 *    approved "hold the frame response", because the window's end IS this stream's
 *    snapshot). The driver writes `<scratch>/hold/<session>` before the held hop,
 *    keeps it while the still is taken, and removes it; the pane draws after the
 *    release, and the bound in the middleware means a stray file cannot hang the
 *    rig.
 *
 * The two recordings are disclosed where the numbers and the still are quoted: the
 * README says which recording the still came from. Nothing else about the arrival
 * changes.
 */
const arrivalOpen = (key) => `(() => {
	const state = window.__loDevDriver?.call?.("state") ?? {};
	return state.runPanelOpen === true
		&& document.querySelector('[data-tour-tag="run-panel-dock"]') === null
		&& location.hash.includes(${JSON.stringify(SESSION[key])});
})()`;

async function waitArrivalWindow(page, key, timeoutMs = 1500) {
	const start = Date.now();
	for (;;) {
		if (await page.evaluate(arrivalOpen(key))) return true;
		if (Date.now() - start > timeoutMs) return false;
	}
}

const inArrivalWindow = (reading, key) =>
	reading.drawn.length === 0 &&
	reading.state?.runPanelOpen === true &&
	reading.hash.includes(SESSION[key]);

/** The hold file's path for one session - the driver's side of `HoldStreamStart`. */
const holdFileFor = (key) => join(SCRATCH, "hold", SESSION[key]);

/* --------------------------------------------------------------------- the cases ---- */

	/*
	 * THE NARROW ARRIVAL, AT THE TWO WIDTHS THAT MATTER. The decision record's
	 * [call] is that a remembered panel is STILL RESTORED at a width where the canvas
	 * would cover the conversation rather than dock, because whether the destination
	 * will overlay depends on the sidebar yield the pane itself causes - a fixpoint
	 * that cannot be decided at bind time. The width in the brief (1024x900) is
	 * measured here rather than assumed, and it does NOT overlay: the canvas DOCKs at
	 * 444px and the SIDEBAR yields to its icon rail instead (`nav` absent, no
	 * `[data-session-row]`), which is why the hop goes through the palette - the door
	 * the rail's own Search row carries the chord for. The app's declared floor
	 * (`WINDOW_MIN_WIDTH` x `WINDOW_MIN_HEIGHT`, 800x600) is where the canvas really
	 * does overlay (220px over the conversation, `overlap > 0`), so that width is
	 * captured too: the [call]'s own shape is the second cell, and the first is the
	 * width the brief named, with the mode each frame carries recorded as a number.
	 */
	const narrowCase = (name, label, width, height) => ({
		name,
		label,
		title: `the same hop in a ${width}x${height} window`,
		arms: ["before", "after"],
		viewport: { width, height },
		async run(page) {
			await openAt(page, "A");
			await wait(SETTLE);
			await page.pressRail("canvas");
			await page.waitFor(paneDrawn("canvas"), "the canvas pane");
			await wait(SETTLE);
			const onA = {
				probe: await page.probe(),
				memory: await page.memory(),
				mode: await canvasMode(page),
			};
			const frames = { onA: await page.shot(`${label}-canvas-on-a`) };

			await page.pressPaletteChat("B");
			await page.waitFor(COLUMN, "B's transcript column");
			const arrival = await page.probe();
			await wait(SETTLE);
			const settled = {
				probe: await page.probe(),
				memory: await page.memory(),
				mode: await canvasMode(page),
			};
			frames.arrival = await page.shot(`${label}-arrival-b`);

			/*
			 * AND BACK, WHICH IS THE DECISION RECORD'S OWN [call]: at a width where the
			 * pane competes for the row, a conversation that REMEMBERS one still gets it
			 * restored - the record refuses "suppress on arrival" because whether the
			 * destination will overlay depends on the sidebar yield the pane itself
			 * causes, a fixpoint no bind-time rule can settle. The arrival at B above is
			 * the other half (B remembers nothing, so B is empty); this hop is the
			 * remembered one, and it is what the [call] is about.
			 */
			await page.pressPaletteChat("A");
			await page.waitFor(COLUMN, "A's transcript column");
			await wait(SETTLE);
			const backOnA = {
				probe: await page.probe(),
				memory: await page.memory(),
				mode: await canvasMode(page),
			};
			frames.backOnA = await page.shot(`${label}-back-on-a`);

			return { frames, readings: { onA, arrival, settled, backOnA } };
		},
	});
	const NARROW_CASES = [
		narrowCase("s5a", "s5a-narrow-1024", 1024, 900),
		narrowCase("s5b", "s5b-overlay-800", 800, 600),
	];

const CASES = [
	...NARROW_CASES,
	{
		name: "s1",
		label: "s1-switch-restores",
		title: "canvas on A; hop to B; hop back to A",
		arms: ["before", "after"],
		sampler: HOP_MS,
		async run(page) {
			await openAt(page, "A");
			await wait(SETTLE);
			await page.pressRail("canvas");
			await page.waitFor(paneDrawn("canvas"), "the canvas pane");
			await wait(SETTLE);
			const canvasOnA = { probe: await page.probe(), memory: await page.memory() };
			const frames = { canvasOnA: await page.shot("s1-canvas-on-a") };

			await page.startSampler(HOP_MS);
			await wait(150);
			await hop(page, "B");
			await page.waitFor(COLUMN, "B's transcript column");
			const arrivalB = await page.probe();
			await wait(SETTLE);
			const settledB = { probe: await page.probe(), memory: await page.memory() };
			const timelineAB = summariseTimeline(await page.timeline());
			frames.arrivalB = await page.shot("s1-arrival-b");

			await page.startSampler(HOP_MS);
			await wait(150);
			await hop(page, "A");
			await page.waitFor(COLUMN, "A's transcript column");
			const arrivalA = await page.probe();
			await wait(SETTLE);
			const settledA = { probe: await page.probe(), memory: await page.memory() };
			const timelineBA = summariseTimeline(await page.timeline());
			frames.backOnA = await page.shot("s1-back-on-a");

			return {
				frames,
				readings: { canvasOnA, arrivalB, settledB, arrivalA, settledA },
				hopAtoB: timelineAB,
				hopBtoA: timelineBA,
			};
		},
	},
	{
		name: "s2",
		label: "s2-restart-on-b",
		title: "canvas on A; hop to B; reload the page (the relaunch)",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "A");
			await wait(SETTLE);
			await page.pressRail("canvas");
			await page.waitFor(paneDrawn("canvas"), "the canvas pane");
			await wait(SETTLE);
			const canvasOnA = { probe: await page.probe(), memory: await page.memory() };
			const frames = { canvasOnA: await page.shot("s2-canvas-on-a") };

			await hop(page, "B");
			await wait(SETTLE);
			const onB = await page.probe();
			frames.onB = await page.shot("s2-b-before-reload");

			/*
			 * THE RELAUNCH IS A PAGE RELOAD: `localStorage` survives one and the
			 * browser context keeps it, which is what a quit-and-reopen does to the
			 * store's persisted blob. The frame is taken as soon as the composer
			 * exists - "the first paint after reload" - and again once settled, so the
			 * pair says whether the arrival was decided before the first paint or
			 * filled in a frame later.
			 */
			await page.reload();
			await ready(page);
			const firstPaint = await page.probe();
			frames.firstPaint = await page.shot("s2-b-first-paint");
			await wait(SETTLE);
			const settled = { probe: await page.probe(), memory: await page.memory() };
			frames.settled = await page.shot("s2-b-settled");

			await hop(page, "A");
			await page.waitFor(COLUMN, "A's transcript column");
			await wait(SETTLE);
			const backOnA = { probe: await page.probe(), memory: await page.memory() };
			frames.backOnA = await page.shot("s2-a-still-remembers");

			return { frames, readings: { canvasOnA, onB, firstPaint, settled, backOnA } };
		},
	},
	{
		name: "s3",
		label: "s3-draft-admission",
		title: "canvas on A; New chat; browser pane on the draft; send it",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "A");
			await wait(SETTLE);
			await page.pressRail("canvas");
			await page.waitFor(paneDrawn("canvas"), "the canvas pane");
			await wait(SETTLE);
			const onA = { probe: await page.probe(), memory: await page.memory() };
			const frames = { onA: await page.shot("s3-a-canvas-open") };

			await page.pressNewChat();
			await page.waitFor(`${stateStep("activeDraftKey")} !== null`, "the draft");
			await ready(page);
			await wait(SETTLE);
			const draftClean = { probe: await page.probe(), memory: await page.memory() };
			frames.draftClean = await page.shot("s3-draft-clean");

			await page.pressRail("browser");
			await page.waitFor(paneDrawn("browser"), "the browser pane on the draft");
			await wait(SETTLE);
			const draftPanel = { probe: await page.probe(), memory: await page.memory() };
			frames.draftPanel = await page.shot("s3-draft-panel-open");

			const beforeAdmission = backendSessions(SCRATCH);
			await page.startSampler(5000);
			await page.press(COMPOSER, "the composer");
			await page.type(MESSAGE);
			await wait(300);
			await page.key("Enter", "Enter", 13, "\r");
			await page.waitFor(`${stateStep("activeDraftKey")} === null`, "the admission", 30_000);
			const atAdmission = await page.probe();
			await page.waitFor(
				`document.body.innerText.includes(${JSON.stringify(MESSAGE.slice(0, 40))})`,
				"the sent message in the transcript",
			);
			/*
			 * Watched on DISK, not in a sentence: the conversation the draft was admitted
			 * as is hosted by the rig's own routes process, so its turn is the installed
			 * runtime's `mock` provider rather than this rig's stub (`waitForAssistantTurn`
			 * states the argument). Waiting for the transcript's own assistant row is the
			 * same fact without coupling the frame to one generation's mock copy.
			 */
			const createdId = backendSessions(SCRATCH).find(
				(id) => !beforeAdmission.includes(id),
			);
			if (!createdId) throw new Error("the admission created no conversation");
			const turn = await waitForAssistantTurn(SCRATCH, createdId);
			const atReply = await page.probe();
			await wait(SETTLE);
			const admitted = { probe: await page.probe(), memory: await page.memory() };
			frames.admitted = await page.shot("s3-after-admission");
			const timeline = summariseTimeline(await page.timeline());

			const afterAdmission = backendSessions(SCRATCH);
			const created = afterAdmission.filter((id) => !beforeAdmission.includes(id));
			const notes = created.map((id) => ({
				session: id,
				...backendReading(SCRATCH, id, MESSAGE.slice(0, 40)),
			}));

			return {
				frames,
				readings: { onA, draftClean, draftPanel, atAdmission, atReply, admitted },
				admission: {
					before: beforeAdmission,
					after: afterAdmission,
					created,
					notes,
					turn,
				},
				timeline,
			};
		},
	},
	{
		name: "s4",
		label: "s4-asks-borrow",
		title: "B remembers the canvas; a pending ask; the drawer opened by hand",
		arms: ["before", "after"],
		async run(page) {
			await openAt(page, "B");
			await wait(SETTLE);
			await page.pressRail("canvas");
			await page.waitFor(paneDrawn("canvas"), "the canvas pane on B");
			await wait(SETTLE);
			const remembersCanvas = { probe: await page.probe(), memory: await page.memory() };
			const frames = { remembersCanvas: await page.shot("s4-b-remembers-canvas") };

			const enqueued = await ask({
				op: "enqueue",
				question: "Which environment should I deploy the release candidate to?",
				options: ["Staging", "Production", "Hold off"],
			});
			await page.waitFor(`document.querySelector('${CHIP}') !== null`, "the asks chip", 20_000);
			await wait(SETTLE);
			const chipUp = { probe: await page.probe(), memory: await page.memory() };
			frames.chipUp = await page.shot("s4-ask-arrives-over-the-canvas");

			await page.pressAskChip();
			await page.waitFor(`document.querySelector('${DRAWER}') !== null`, "the drawer", 15_000);
			await wait(1200);
			const borrow = { probe: await page.probe(), memory: await page.memory() };
			frames.borrow = await page.shot("s4-drawer-borrows-the-slot");

			await page.press(CLOSE_ASKS, "the Close asks dismiss");
			await page.waitFor(`document.querySelector('${DRAWER}') === null`, "the drawer to close", 15_000);
			await wait(SETTLE);
			const restored = { probe: await page.probe(), memory: await page.memory() };
			frames.restored = await page.shot("s4-canvas-returns");

			/*
			 * AND THE OTHER DOOR (N1, and the proof of UX round 1's U2 fix): the drawer
			 * closed by ESCAPE. This is the press the canvas's own window listener used
			 * to double-take - the drawer claims it with `preventDefault` and the close
			 * re-projects the memory, which re-mounts the canvas inside the same
			 * dispatch, so the canvas's listener then closed the canvas too and DELETED
			 * the conversation's entry; it now stands down on `defaultPrevented` (this
			 * round's fix, `canvas/index.tsx`). The readings are the claim: the canvas
			 * drawn again and the memory untouched - the same give-back the button's door
			 * shows, through the other door.
			 */
			await page.pressAskChip();
			await page.waitFor(
				`document.querySelector('${DRAWER}') !== null`,
				"the drawer reopened",
				15_000,
			);
			await wait(1200);
			const escapeOpen = { probe: await page.probe(), memory: await page.memory() };
			await page.key("Escape", "Escape", 27);
			await page.waitFor(
				`document.querySelector('${DRAWER}') === null`,
				"the drawer to close on Escape",
				15_000,
			);
			await wait(SETTLE);
			const escaped = { probe: await page.probe(), memory: await page.memory() };
			frames.escapeReturn = await page.shot("s4-canvas-returns-via-escape");

			return {
				frames,
				readings: { remembersCanvas, chipUp, borrow, restored, escapeOpen, escaped },
				enqueued: enqueued.ask_id ?? null,
				backend: backendReading(SCRATCH, SESSION.B, null),
			};
		},
	},

	{
		name: "s6",
		label: "s6-run-frame-arrival",
		title: "B remembers the run panel; the pre-frame arrival after the hop vs settled",
		arms: ["before", "after"],
		async run(page, arm) {
			await openAt(page, "A");
			await wait(SETTLE);
			await hop(page, "B");
			await page.waitFor(COLUMN, "B's transcript column");
			await wait(SETTLE);
			/*
			 * A STAGED INPUT, disclosed in the README: the plan is seeded through the
			 * runtime's own `restore_todos` so the pane has a body to draw. Without it
			 * the pane still mounts (its model is non-null whenever the canonical frame
			 * exists), but the frame would say less about which pane it is.
			 */
			await ask({ op: "todos" });
			await page.pressRail("run");
			await page.waitFor(paneDrawn("run"), "the run pane", 20_000);
			await wait(SETTLE);
			const openOnB = { probe: await page.probe(), memory: await page.memory() };
			const frames = { openOnB: await page.shot("s6-b-run-panel-open") };

			await hop(page, "A");
			await page.waitFor(COLUMN, "A's transcript column");
			await wait(SETTLE);
			const onA = { probe: await page.probe(), memory: await page.memory() };
			frames.onA = await page.shot("s6-on-a");

			/*
			 * RECORDING 1 - THE APP'S OWN GATE, for the timeline. No shutter: the
			 * sampler is in-page, so the window cannot be missed, and these are the
			 * numbers the README quotes.
			 */
			await page.startSampler(4000);
			await wait(150);
			await hop(page, "B");
			await page.waitFor(COLUMN, "B's transcript column");
			if (!(await waitArrivalWindow(page, "B"))) {
				throw new Error("s6: the unheld arrival window never opened");
			}
			await wait(SETTLE);
			const timeline = summariseTimeline(await page.timeline());

			/*
			 * RECORDING 2 - THE HELD ARRIVAL, for the still. Hop away, arm the hold
			 * file, hop back; the daemon holds the stream's start, so the window stays
			 * open until the still is taken and the hold is released.
			 */
			await hop(page, "A");
			await page.waitFor(COLUMN, "A's transcript column");
			await wait(SETTLE);
			const holdFile = holdFileFor("B");
			mkdirSync(join(SCRATCH, "hold"), { recursive: true });
			writeFileSync(holdFile, "hold\n");
			await hop(page, "B");
			await page.waitFor(COLUMN, "B's transcript column");
			if (!(await waitArrivalWindow(page, "B"))) {
				rmSync(holdFile, { force: true });
				throw new Error("s6: the held arrival window never opened");
			}
			const before = await page.probe();
			frames.firstPaint = await page.shot("s6-back-first-paint");
			const after = await page.probe();
			rmSync(holdFile, { force: true });
			if (!(inArrivalWindow(before, "B") && inArrivalWindow(after, "B"))) {
				throw new Error(
					"s6: the held still's readings disagree with the window it was taken in",
				);
			}
			await wait(SETTLE);
			const settled = { probe: await page.probe(), memory: await page.memory() };
			frames.settled = await page.shot("s6-back-settled");

			/* Clear the plan so the conversation is left as the other cases found it. */
			await ask({ op: "todos", phases: [] });

			return {
				frames,
				readings: {
					openOnB,
					onA,
					firstPaint: { before, after },
					settled,
				},
				timeline,
			};
		},
	},
	{
		name: "s7",
		label: "s7-console-restore",
		title: "B remembers the console; hop to A; hop back - the pane returns and draws its empty state",
		arms: ["before", "after"],
		async run(page) {
			/*
			 * THE CONSOLE'S OWN STORY, because the decision record promises the
			 * restored browser and console panes "draw their designed empty states" and
			 * neither was photographed (design review round 1, D5). The BROWSER's
			 * designed state cannot be reached from this rig - the web fallback ("the
			 * browser is only available in the desktop app") draws instead, since the
			 * native view is Electron's - so the console carries the state's evidence:
			 * the pane mounts without Electron and draws "No console in this session".
			 */
			await openAt(page, "B");
			await wait(SETTLE);
			await page.pressRail("console");
			await page.waitFor(paneDrawn("console"), "the console pane on B", 20_000);
			await wait(SETTLE);
			const openOnB = { probe: await page.probe(), memory: await page.memory() };
			const frames = { openOnB: await page.shot("s7-console-on-b") };

			await hop(page, "A");
			await page.waitFor(COLUMN, "A's transcript column");
			await wait(SETTLE);
			const onA = { probe: await page.probe(), memory: await page.memory() };
			frames.onA = await page.shot("s7-arrival-a");

			await hop(page, "B");
			await page.waitFor(COLUMN, "B's transcript column");
			await wait(SETTLE);
			const restored = { probe: await page.probe(), memory: await page.memory() };
			frames.restored = await page.shot("s7-console-restored");

			return { frames, readings: { openOnB, onA, restored } };
		},
	},
];

const RUN_ORDER = ["s1", "s2", "s5a", "s5b", "s3", "s6", "s7", "s4"];
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
		samplerColumns: SAMPLER_COLUMNS,
		paneHooks: PAGE_HOOKS,
	},
};

/** One case on one arm in this invocation's palette, in its own browser context; a failure is a record, not a stop. */
async function runCase(testCase, arm, url, theme) {
	const page = await openPageFor(url, arm, OUT, {
		sampler: Boolean(testCase.sampler),
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
			failure.memory = await page.memory();
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
		for (const name of ["A", "B"]) {
			await openAt(page, name);
			await wait(SETTLE);
			out[name] = {
				probe: await page.probe(),
				memory: await page.memory(),
				state: await page.callDevState(),
			};
		}
		out.sidebarButtons = await page.evaluate(
			`[...document.querySelectorAll("nav button")].map((b) => (b.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 70)).filter(Boolean)`,
		);
		out.railItems = await page.evaluate(
			`[...document.querySelectorAll("[data-panel-rail-item]")].map((b) => ({ id: b.getAttribute("data-panel-rail-item"), pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label") }))`,
		);
		out.newChat = await page.call(
			// eslint-disable-next-line no-undef -- serialised page-side helper
			() => {
				const rows = [...document.querySelectorAll("nav button")].filter((b) =>
					/^New chat/.test((b.innerText ?? "").replace(/\s+/g, " ").trim()),
				);
				return rows.map((r) => ({
					text: (r.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
					aria: r.getAttribute("aria-label"),
				}));
			},
		);
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
