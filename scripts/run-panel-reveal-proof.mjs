#!/usr/bin/env node
/**
 * Measure the app frame before and after the composer's plan chip is pressed.
 *
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=<token> LOCAL_OPERATOR_CONFIG_DIR=<isolated> \
 *       node scripts/run-panel-reveal-proof.mjs --session=<12 hex> \
 *       [--backend=http://127.0.0.1:1111] [--width=1380] [--height=900] \
 *       [--theme=<ThemeName>] [--out=<dir>] [--expect=region-only] [--rail=collapsed] \
 *       [--reader=first]
 *
 * `--expect=region-only` is the CLAIM, checked rather than printed: the run exits
 * non-zero if any box outside `[data-run-panel-region]` changed `scrollLeft` or
 * `scrollTop` across the press, or if the To-dos section did not land at the top
 * of that region. Leave it off for a `before-fix` run, where a mover outside the
 * pane is the whole point.
 *
 * `--rail=collapsed|expanded` sets the icon rail's state before anything is
 * measured or captured, because the pane's fit depends on it (220px expanded,
 * 48px collapsed, out of the same row).
 *
 * Why this stands beside the supported dev driver instead of inside it:
 * `docs/agent-driver.md`'s `renderer-driver.mjs` is the house way through, and its
 * `press` verb is the press this file uses (hit-test the painted centre, dispatch
 * a real pointer sequence). What it deliberately refuses is a generic `eval` on
 * the page, which is exactly what this proof needs - every scrolling box in the
 * chip's and the section's ancestor chains, read before and after. Adding a
 * geometry verb to the shared driver to serve one proof would widen a tool whose
 * value is that it cannot be scripted into anything; a second rig that says so is
 * the smaller cost, and this note is that "says so".
 *
 * Why this is a committed script rather than a throwaway rig: the claim it
 * checks - "pressing the plan chip moves the pane's own reading position and
 * nothing else" - is a claim about a RUNNING application and about boxes that no
 * unit test can lay out. `scrollIntoView` walks every scrolling box up to the
 * viewport, so the defect it replaces was invisible to the DOM and visible only
 * as geometry in the real window: at 1024x673 the chat column's slot row scrolled
 * 108px sideways, at 800x600 221px, because the run pane does not fit beside the
 * column at those widths. A green typecheck cannot see any of that.
 *
 * How it drives the app: the BUILT app (`pnpm build`), in `headless` window mode
 * (never shown, never focused - the operator's rule for every agent-driven run),
 * over raw CDP with Node's built-in WebSocket. No browser-automation dependency
 * is installed for this. The press is a real `Input.dispatchMouseEvent` at the
 * chip's painted centre after asking the page who owns that point, not a
 * synthetic `element.click()`, so a chip that is painted but not hit-testable
 * fails here rather than passing.
 *
 * What it needs around it: a backend the app is paired with, holding a session
 * that has a plan (`scripts/seed-plan-session.mjs` writes one into an isolated
 * config dir) and a provider credential, because the app opens its first-run
 * onboarding modal over an unconfigured backend and a modal swallows the press.
 * Read the README beside the frames for the three commands that stand that up.
 *
 * The token is read from the environment and never printed, logged or written
 * into the report.
 */

import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The `--key=value` prefix, hoisted so parsing argv builds no regex per entry. */
const ARG_PREFIX = /^--/;

const args = new Map(
	process.argv
		.slice(2)
		.filter((arg) => arg.startsWith("--"))
		.map((arg) => {
			const [key, ...rest] = arg.replace(ARG_PREFIX, "").split("=");
			return [key, rest.join("=")];
		}),
);

const SESSION = args.get("session") ?? "";
const BACKEND = args.get("backend") ?? "http://127.0.0.1:1111";
const WIDTH = Number(args.get("width") ?? 1380);
const HEIGHT = Number(args.get("height") ?? 900);
const THEME = args.get("theme") ?? "";
const OUT = resolve(args.get("out") ?? "out/run-panel-reveal");
/*
 * REALpath, not the path as typed. The app compares the frame it was asked to
 * load against its own trusted path by RESOLVED path (`desktop-transport.ts`),
 * and on macOS `/tmp` is a symlink to `/private/tmp` - so `--repo=/tmp/...` loads
 * nothing, and the first thing the run then misses is the chip, which it reported
 * as "seed a session with a To-dos plan": a fixture accused of a security
 * refusal. Node's `cwd` is already physical, which is why the documented
 * invocation never hit it.
 */
const REPO = realpathSync(resolve(args.get("repo") ?? "."));
const PORT = Number(args.get("port") ?? 9451);
const EXPECT = args.get("expect") ?? "";
/**
 * Which rail state to measure in: "collapsed", "expanded", or empty for whatever
 * the profile opens with.
 *
 * The pane's fit is RAIL-DEPENDENT - the rail is 220px expanded and 48px
 * collapsed, on a row that also holds the chat list and the column's own 220px
 * floor - so a frame set that shows one state cannot say whether the pane is
 * clipped in general or clipped HERE. The toggle is reached the way a user reaches
 * it: the control is `opacity-0 pointer-events-none` until the rail is hovered.
 */
const RAIL = args.get("rail") ?? "";
/**
 * "first" opens the first openable roster row's reader before the press, so the
 * measured gesture is the reveal's READER-FIRST branch rather than its plain one.
 */
const READER = args.get("reader") ?? "";
/**
 * A CSS selector inside the pane to FOCUS, reporting every ancestor's scroll
 * offsets across the focus. `--focus-probe=[data-run-panel-row]:last-child button`
 * is round 1's M1: `focus()` without `preventScroll` does its own
 * scroll-into-view through the SAME ancestor chain `scrollIntoView` walks, so a
 * row whose right edge is in the clipped strip could move a box outside the pane.
 * It is a probe rather than a press because the reader-first state (a plan chip
 * AND an openable roster in one session) is not reachable with a seeded fixture:
 * the plan needs an engaged runtime and the engage replaces the job store the
 * roster rows come from. It therefore drives the app's own DOM in the geometry
 * the concern names, and says so rather than claiming the full gesture.
 */
const FOCUS = args.get("focus-probe") ?? "";

const TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? "";
if (!SESSION || !TOKEN) {
	console.error(
		"usage: LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/run-panel-reveal-proof.mjs --session=<id> [--backend=…] [--width=…] [--height=…] [--theme=…] [--out=…]",
	);
	process.exit(1);
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

/*
 * Every box in the chain, not a ranked subset: the point of the measurement is
 * that the mover is a box NOBODY would have named, so the script cannot decide
 * in advance which ancestors are worth reading.
 */
const MEASURE = `(() => {
	const box = (node) => {
		const style = getComputedStyle(node);
		const rect = node.getBoundingClientRect();
		return {
			name: node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + "|" + String(node.className || "").split(" ").slice(0, 3).join("."),
			isRegion: node.hasAttribute("data-run-panel-region"),
			overflowY: style.overflowY,
			overflowX: style.overflowX,
			scrollTop: node.scrollTop,
			scrollLeft: node.scrollLeft,
			verticalOverflow: node.scrollHeight - node.clientHeight,
			horizontalOverflow: node.scrollWidth - node.clientWidth,
			top: Math.round(rect.top * 100) / 100,
			left: Math.round(rect.left * 100) / 100,
		};
	};
	const chain = (root) => {
		const rows = [];
		for (let node = root; node; node = node.parentElement) rows.push(box(node));
		return rows;
	};
	const todos = (() => {
		const pane = document.querySelector("[data-run-panel-pane]");
		if (!pane) return null;
		for (const section of pane.querySelectorAll("section")) {
			if (/^To-dos/.test(section.textContent.trim())) return section;
		}
		return null;
	})();
	const chip = document.querySelector("[data-status-plan]");
	const seen = new Set();
	const scrollBoxes = [];
	for (const root of [chip, todos]) {
		for (let node = root; node; node = node.parentElement) {
			if (seen.has(node)) continue;
			seen.add(node);
			scrollBoxes.push(box(node));
		}
	}
	const surfaces = {};
	const add = (name, node) => {
		if (!node) {
			surfaces[name] = null;
			return;
		}
		const rect = node.getBoundingClientRect();
		surfaces[name] = {
			top: Math.round(rect.top * 100) / 100,
			left: Math.round(rect.left * 100) / 100,
			width: Math.round(rect.width * 100) / 100,
			height: Math.round(rect.height * 100) / 100,
		};
	};
	add("iconRailAndList", document.querySelector("nav.group"));
	add("chatList", document.querySelector('nav[aria-label="Chats"]'));
	add("chatColumn", document.querySelector('div[class*="@container/chatcol"]'));
	add("transcript", document.querySelector("[data-lo-canonical-transcript]"));
	add("composerBand", document.querySelector("[data-lo-composer-band]"));
	add("runPane", document.querySelector("[data-run-panel-pane]"));
	add("todosSection", todos);
	/*
	 * The pane's FIT, which is the other half of the reported defect (round 1,
	 * D1/U1): a reveal that does not move the frame still has to reveal something
	 * readable. clipPx is how much of the pane is outside the viewport, the close
	 * control is read AND hit-tested (its centre may sit inside the viewport while
	 * an overlay owns the point), and truncatingRows counts the pane's own text
	 * that its layout cannot fit - the state the round measured as characters cut
	 * mid-word with no ellipsis.
	 */
	const paneEl = document.querySelector("[data-run-panel-pane]");
	const closeEl = document.querySelector('[aria-label="Close run details"]');
	const acceptance = {
		clipPx: null,
		closeControl: null,
		closeControlHit: null,
		elidedRows: 0,
		cutRows: 0,
		collapsedTextRows: 0,
		outsideRegionRows: 0,
		collapsedTextExamples: [],
		outsideRegionExamples: [],
	};
	if (paneEl) {
		const paneRect = paneEl.getBoundingClientRect();
		acceptance.clipPx = Math.max(0, Math.round(paneRect.right - window.innerWidth));
		/*
		 * A TEXT BOX COLLAPSED TO NOTHING, and it is a defect class of its own
		 * (design round 2, D7). The predicate below used to SKIP a box with
		 * 'clientWidth <= 0', which is exactly the failure it was written to see: at
		 * the pane width this change newly renders at, every row's name was 0px wide
		 * with 'scrollWidth' 60-133 — not elided, gone, and reachable by no gesture,
		 * because there is nothing to scroll to. A box with text in it, no children
		 * of its own, zero width and content that wants some, is that class and only
		 * that class; 'display: none' (scrollWidth 0) and a 1px 'sr-only' clip
		 * (clientWidth 1) are both excluded by those two terms.
		 */
		const label = (node) =>
			node.tagName.toLowerCase() +
			(node.className ? "." + String(node.className).split(" ").slice(0, 2).join(".") : "") +
			" " +
			JSON.stringify((node.textContent ?? "").trim().slice(0, 40));
		const regionEl = document.querySelector("[data-run-panel-region]");
		/*
		 * The client box the pane's content was actually given, so "past the box" is
		 * measured against the region that owns it rather than against the window:
		 * the earlier predicate only saw a truncating box whose elision point fell
		 * outside the WINDOW, and a trailing value that simply overflows its
		 * container without being truncated ('scrollWidth == clientWidth') was
		 * invisible to it. Design's own predicate over the same geometry found four
		 * such rows on a frame this one scored 0 on.
		 */
		const regionClientRight = regionEl
			? regionEl.getBoundingClientRect().right -
				(regionEl.offsetWidth - regionEl.clientWidth)
			: null;
		for (const node of paneEl.querySelectorAll("*")) {
			const text = (node.textContent ?? "").trim();
			const leaf = node.children.length === 0 && text.length > 0;
			const rect = node.getBoundingClientRect();
			if (leaf && node.clientWidth <= 0 && node.scrollWidth > 0) {
				acceptance.collapsedTextRows += 1;
				if (acceptance.collapsedTextExamples.length < 8)
					acceptance.collapsedTextExamples.push(label(node));
				continue;
			}
			if (leaf && regionClientRight !== null && node.clientWidth > 0 && rect.right > regionClientRight + 1) {
				acceptance.outsideRegionRows += 1;
				if (acceptance.outsideRegionExamples.length < 8)
					acceptance.outsideRegionExamples.push(label(node));
				continue;
			}
			/*
			 * Truncation is two different things and only one of them is a defect. A
			 * row whose text-overflow is an ellipsis and that fits INSIDE the viewport
			 * is the design working: the reader sees the three dots. The same row with
			 * its elision point outside the viewport is the failure the round measured
			 * - the pane's right edge is past the window, so the text ends at a hard
			 * screen edge with no ellipsis anywhere on screen.
			 */
			if (node.clientWidth <= 0 || node.scrollWidth <= node.clientWidth + 1) continue;
			if (rect.right > window.innerWidth) acceptance.cutRows += 1;
			else acceptance.elidedRows += 1;
		}
	}
	if (closeEl) {
		const rect = closeEl.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		acceptance.closeControl = {
			left: Math.round(rect.left * 100) / 100,
			right: Math.round(rect.right * 100) / 100,
			insideViewport: rect.left >= 0 && rect.right <= window.innerWidth,
		};
		const hit = document.elementFromPoint(x, y);
		acceptance.closeControlHit = Boolean(
			hit && (hit === closeEl || closeEl.contains(hit)),
		);
	}
	const region = document.querySelector("[data-run-panel-region]");
	const todosOffsetInRegion =
		todos && region
			? Math.round(
					(todos.getBoundingClientRect().top -
						region.getBoundingClientRect().top -
						region.clientTop) *
						100,
				) / 100
			: null;
	return {
		viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
		paneOpen: Boolean(document.querySelector("[data-run-panel-pane]")),
		dialog: Boolean(document.querySelector("div[role='dialog']")),
		documentScrollTop: document.documentElement.scrollTop,
		bodyScrollTop: document.body.scrollTop,
		todosOffsetInRegion,
		acceptance,
		scrollBoxes,
		surfaces,
	};
})()`;

/*
 * The scratch profile and the spawned tree live OUTSIDE the launch IIFE, because
 * the teardown below must be able to reach them when the LAUNCH ITSELF fails.
 * This is not defensive style, it is a measured leak (QA round 2, Q1):
 * `no app page target after 60s` throws INSIDE that IIFE, above the instrumented
 * block whose `finally` owns the reap, so the throw returned before `app` existed
 * and the app was left reparented to `launchd` - three processes under a `ppid=1`
 * root, unchanged a minute later - with the mkdtemp'd profile on disk for good.
 * Every other failure path (a missing chip, a bad `--expect`, the rail) throws
 * inside the instrumented block and reaped correctly, which is why this one hid.
 */
const PROFILE = mkdtempSync(join(tmpdir(), "lo-reveal-proof-"));
/** The `npx` child, as soon as it exists, so a launch failure is reaped too. */
let spawned = null;

const app = await (async () => {
	/*
	 * A port somebody else is already holding is the one start-up failure that
	 * looks exactly like a slow launch: the window comes up, `/json/list` answers,
	 * and the page target this script waits for never appears because the port
	 * belongs to another process. Name it here rather than waiting 60s for it.
	 */
	try {
		const busy = await fetch(`http://127.0.0.1:${PORT}/json/version`);
		if (busy.ok)
			throw new Error(
				`port ${PORT} already has a devtools endpoint; pass --port=<free port>`,
			);
	} catch (error) {
		if (error instanceof Error && error.message.includes("already has"))
			throw error;
		// Nothing listening: the normal case.
	}
	const child = spawn(
		"npx",
		[
			"electron",
			".",
			`--remote-debugging-port=${PORT}`,
			`--user-data-dir=${PROFILE}`,
			`--window-size=${WIDTH}x${HEIGHT}`,
		],
		{
			cwd: REPO,
			env: (() => {
				const env = {
					...process.env,
					LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
				};
				/*
				 * Every inherited cmux/lop variable is REMOVED rather than named: an inherited
				 * workspace id has already renamed the operator's real workspaces from a
				 * headless run in this project, and the gate's rule is the whole prefix, not
				 * the two variables the first version of this rig happened to know about.
				 */
				for (const key of Object.keys(env)) {
					if (key.startsWith("CMUX_") || key.startsWith("LOP_"))
						delete env[key];
				}
				return env;
			})(),
			stdio: ["ignore", "pipe", "pipe"],
			/*
			 * Own the whole tree, because `npx` is in the middle of it. This spawns
			 * `npx` -> `node .../electron/cli.js` -> `Electron.app`, so a signal to the
			 * direct child alone stops the SHIM and leaves the app reparented to
			 * launchd - one leaked app per run, INCLUDING on green runs, each of them
			 * still answering on its devtools port (measured: seven green runs in a
			 * capture matrix left seven apps, and the next run that picked one of their
			 * ports reported "already has a devtools endpoint", which reads as a slow
			 * launch rather than as a collision). `detached` puts the tree in its own
			 * process group so `stop` below can signal the group, the same rule
			 * `scripts/browser-host-proof.mjs` records; the profile-scoped reap in the
			 * teardown catches an app that outlives even that.
			 */
			detached: true,
		},
	);
	spawned = child;
	child.unref();
	const log = [];
	child.stdout.on("data", (chunk) => log.push(String(chunk)));
	child.stderr.on("data", (chunk) => log.push(String(chunk)));

	let target = null;
	for (let attempt = 0; attempt < 120 && !target; attempt++) {
		await wait(500);
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${PORT}/json/list`)
			).json();
			target =
				list.find(
					(entry) => entry.type === "page" && entry.url.startsWith("file://"),
				) ?? null;
		} catch {
			// The endpoint is not up yet.
		}
	}
	if (!target)
		throw new Error(
			`no app page target after 60s:\n${log.join("").slice(-2000)}`,
		);

	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolveOpen, rejectOpen) => {
		socket.addEventListener("open", resolveOpen, { once: true });
		socket.addEventListener("error", rejectOpen, { once: true });
	});
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (!message.id || !pending.has(message.id)) return;
		const { resolveIt, rejectIt } = pending.get(message.id);
		pending.delete(message.id);
		message.error
			? rejectIt(new Error(JSON.stringify(message.error)))
			: resolveIt(message.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolveIt, rejectIt) => {
			const id = ++nextId;
			pending.set(id, { resolveIt, rejectIt });
			socket.send(JSON.stringify({ id, method, params }));
		});
	await send("Page.enable");
	await send("Runtime.enable");

	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				result.exceptionDetails.exception?.description ?? "evaluate failed",
			);
		return result.result.value;
	};
	const clientPoint = async (selector) =>
		evaluate(`(() => {
			const node = document.querySelector(${JSON.stringify(selector)});
			if (!node) return null;
			const rect = node.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		})()`);
	const click = async (selector) => {
		const point = await clientPoint(selector);
		if (!point) return false;
		await send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: point.x,
			y: point.y,
		});
		for (const type of ["mousePressed", "mouseReleased"]) {
			await send("Input.dispatchMouseEvent", {
				type,
				x: point.x,
				y: point.y,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			});
		}
		return true;
	};
	const screenshot = async (path) => {
		const shot = await send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		});
		writeFileSync(path, Buffer.from(shot.data, "base64"));
	};
	// A headless window cannot be focused, so a key event is dropped without it.
	await send("Emulation.setFocusEmulationEnabled", { enabled: true });
	return { child, send, evaluate, click, screenshot, log, socket };
})();

const outDir = join(OUT, `press-${WIDTH}x${HEIGHT}`);
mkdirSync(outDir, { recursive: true });
const theme = THEME || "default";

try {
	if (THEME) {
		/*
		 * The app's own persisted preference, written the way the app writes it,
		 * so a frame is of the theme the app itself paints.
		 */
		await app.evaluate(`(() => {
			const key = "ui-preferences-storage";
			const current = JSON.parse(localStorage.getItem(key) ?? "{}");
			current.state = { ...(current.state ?? {}), themeName: ${JSON.stringify(THEME)} };
			localStorage.setItem(key, JSON.stringify(current));
		})()`);
	}
	await app.send("Page.navigate", {
		url: `file://${join(REPO, "out", "renderer", "index.html")}#/chat/${SESSION}`,
	});
	await wait(10000);

	/*
	 * Warm the session the way the composer does on its first keystroke. The
	 * plan does not reach the renderer until a runtime is engaged, and a proof
	 * should not need a synthetic keystroke to make its own subject exist.
	 *
	 * The engage is ASYNC and the plan arrives over the canonical stream a moment
	 * after it, so this polls for the chip and asks again rather than racing a
	 * fixed sleep: a cold engage under load measured longer than the 9s this used
	 * to wait, and the failure it produced ("the session has no plan chip") named
	 * the fixture instead of the race. Asking twice costs one round trip when the
	 * runtime was already engaged, which is the normal case for a re-run.
	 */
	const warm = () =>
		fetch(`${BACKEND}/v1/desktop/sessions/${SESSION}/warm`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				"Content-Type": "application/json",
			},
			body: "{}",
		}).catch(() => {});
	/*
	 * The plan chip is the subject of a press run. The focus probe needs the COLD
	 * projection instead (its roster is the one with openable rows), so it skips the
	 * engage and the chip entirely.
	 */
	if (!FOCUS) {
		for (let attempt = 0; attempt < 8; attempt++) {
			await warm();
			for (let tick = 0; tick < 10; tick++) {
				await wait(1500);
				if (
					await app.evaluate(
						`Boolean(document.querySelector("[data-status-plan]"))`,
					)
				)
					break;
			}
			if (
				await app.evaluate(
					`Boolean(document.querySelector("[data-status-plan]"))`,
				)
			)
				break;
		}
	}

	if (
		await app.evaluate(`Boolean(document.querySelector("div[role='dialog']"))`)
	)
		throw new Error(
			"the app is showing a modal (unconfigured backend); the press would be swallowed",
		);
	if (
		!FOCUS &&
		!(await app.evaluate(
			`Boolean(document.querySelector("[data-status-plan]"))`,
		))
	)
		throw new Error(
			"the session has no plan chip: seed a session with a To-dos plan",
		);

	/*
	 * The rail state, set BEFORE anything is measured or captured: the pane's
	 * available width is the row minus the rail, minus the chat list, minus the
	 * column's own floor, so the same window can show a pane that fits and a pane
	 * that does not. Hovering first is not politeness - the toggle is
	 * `opacity-0 pointer-events-none` until the rail is hovered, so a press without
	 * it lands on whatever is beneath and the state silently never changes.
	 */
	if (RAIL === "collapsed" || RAIL === "expanded") {
		const railWidth = () =>
			app.evaluate(
				`Math.round(document.querySelector("nav.group")?.getBoundingClientRect().width ?? 0)`,
			);
		const railBefore = await railWidth();
		/*
		 * WHICH state a profile opens in is not a constant, so the target is reached
		 * from whatever state the launch is actually in rather than assumed. A fresh
		 * scratch profile already opens EXPANDED (220px), and the toggle's own label
		 * in that state is `Collapse sidebar` - so the flag's old unconditional press
		 * for `Expand sidebar` had nothing to press and threw, which meant
		 * `--rail=expanded` could not run at all and the README's expanded rows
		 * cannot have come from that flag (QA round 2, Q2). Collapsed is 48px against
		 * expanded 220px, so the split is at 100 and the press is skipped when the
		 * launch is already where the flag wants it.
		 */
		const collapsedPx = (width) => width < 100;
		const alreadyThere =
			RAIL === "collapsed" ? collapsedPx(railBefore) : !collapsedPx(railBefore);
		if (alreadyThere) {
			console.error(
				`[rail] ${RAIL}: already at ${railBefore}px, no press needed`,
			);
		} else {
			const want = RAIL === "collapsed" ? "Collapse sidebar" : "Expand sidebar";
			const railPoint = await app.evaluate(`(() => {
			const node = document.querySelector("nav.group");
			if (!node) return null;
			const rect = node.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + 120 };
		})()`);
			if (!railPoint) throw new Error(`no rail to set to ${RAIL}`);
			await app.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: railPoint.x,
				y: railPoint.y,
			});
			await wait(500);
			if (!(await app.click(`[aria-label="${want}"]`)))
				throw new Error(
					`the rail's "${want}" control is not on screen; the rail is at ${railBefore}px`,
				);
			await wait(900);
			const railAfter = await railWidth();
			if (Math.abs(railAfter - railBefore) < 4)
				throw new Error(
					`the rail did not ${RAIL}: it was ${railBefore}px and is ${railAfter}px, so the press would be measured in the other state`,
				);
			console.error(`[rail] ${RAIL}: ${railBefore}px -> ${railAfter}px`);
		}
	} else if (RAIL !== "") {
		throw new Error(`unknown --rail=${RAIL}; use collapsed or expanded`);
	}

	/*
	 * The reader-first branch of the reveal (round 1, M1): the press has to LEAVE a
	 * child reader and then bring the plan in, in one request. That branch is the
	 * one the review could not reach without a fixture whose roster rows are
	 * openable (`--openable` on the seeder), and it is the branch where a
	 * `focus()` on a roster row inside a clipped pane could move something outside
	 * the pane again.
	 */
	if (FOCUS) {
		/*
		 * Open the pane by its trigger (the chip is not on screen in this mode) and
		 * focus one element inside it, reporting every ancestor's scroll offsets
		 * across the focus. `focus()` without `preventScroll` performs its own
		 * scroll-into-view, through the same ancestor chain `scrollIntoView` walks,
		 * so an element in the pane's clipped strip is the condition under test.
		 */
		if (!(await app.click("[data-run-panel-trigger]")))
			throw new Error("no header trigger to open the pane with");
		await wait(1500);
		const probe = await app.evaluate(`(() => {
			const target = document.querySelector(${JSON.stringify(FOCUS)});
			if (!target) return { error: "no element matches " + ${JSON.stringify(FOCUS)} };
			const boxes = () => {
				const rows = [];
				for (let node = target; node; node = node.parentElement)
					rows.push({
						name:
							node.tagName.toLowerCase() +
							"|" +
							String(node.className || "").split(" ").slice(0, 2).join("."),
						scrollTop: node.scrollTop,
						scrollLeft: node.scrollLeft,
					});
				return rows;
			};
			const rect = target.getBoundingClientRect();
			const before = boxes();
			target.focus();
			const after = boxes();
			return {
				selector: ${JSON.stringify(FOCUS)},
				viewport: [window.innerWidth, window.innerHeight],
				targetRect: {
					left: Math.round(rect.left * 100) / 100,
					right: Math.round(rect.right * 100) / 100,
					top: Math.round(rect.top * 100) / 100,
					bottom: Math.round(rect.bottom * 100) / 100,
				},
				fullyInsideViewport:
					rect.left >= 0 &&
					rect.right <= window.innerWidth &&
					rect.top >= 0 &&
					rect.bottom <= window.innerHeight,
				activeIsTarget: document.activeElement === target,
				movers: after.filter(
					(row, index) =>
						row.scrollTop !== before[index].scrollTop ||
						row.scrollLeft !== before[index].scrollLeft,
				),
				ancestors: after,
			};
		})()`);
		console.log(JSON.stringify(probe, null, 2));
	} else {
		if (READER === "first") {
			if (!(await app.click("[data-run-panel-trigger]")))
				throw new Error("no header trigger to open the pane with");
			await wait(1200);
			const rosterState = await app.evaluate(`(() => ({
			pane: Boolean(document.querySelector("[data-run-panel-pane]")),
			rows: document.querySelectorAll("[data-run-panel-row]").length,
			buttons: document.querySelectorAll("[data-run-panel-row] button").length,
			sections: [...document.querySelectorAll("[data-run-panel-pane] section")].map((node) => (node.textContent || "").trim().slice(0, 24)),
		}))()`);
			if (!(await app.click("[data-run-panel-row] button")))
				throw new Error(
					`no openable roster row: ${JSON.stringify(rosterState)} - a row is a control only when the wire gives it a child session (seed the session with \`--openable\`)`,
				);
			await wait(1500);
			if (
				await app.evaluate(
					`Boolean(document.querySelector("[data-run-panel-row]"))`,
				)
			)
				throw new Error(
					"the roster is still on screen: the row press did not open a reader",
				);
		} else if (READER !== "") {
			throw new Error(`unknown --reader=${READER}; the only value is first`);
		} else {
			// A known closed pane, so the press is the whole change. The pane's own close
			// control first; Escape is the ladder's own rung for a window too narrow for
			// the chrome to be on screen (measured at 800x600), and it needs the press's
			// target to be `body`, hence the blur.
			for (let attempt = 0; attempt < 3; attempt++) {
				if (
					!(await app.evaluate(
						`Boolean(document.querySelector("[data-run-panel-pane]"))`,
					))
				)
					break;
				if (!(await app.click('[aria-label="Close run details"]'))) {
					await app.evaluate(
						"document.activeElement instanceof HTMLElement && document.activeElement.blur()",
					);
					for (const type of ["keyDown", "keyUp"])
						await app.send("Input.dispatchKeyEvent", {
							type,
							key: "Escape",
							code: "Escape",
							windowsVirtualKeyCode: 27,
							nativeVirtualKeyCode: 27,
						});
				}
				await wait(700);
			}
			if (
				await app.evaluate(
					`Boolean(document.querySelector("[data-run-panel-pane]"))`,
				)
			)
				throw new Error("could not close the pane before the press");
		}

		const before = await app.evaluate(MEASURE);
		await app.screenshot(join(outDir, `${theme}-before.png`));

		const chip = await app.evaluate(`(() => {
		const node = document.querySelector("[data-status-plan]");
		const rect = node.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const at = document.elementFromPoint(x, y);
		return {
			label: node.getAttribute("aria-label"),
			x,
			y,
			hit: at === node || node.contains(at),
			owner: at ? at.tagName.toLowerCase() + "." + String(at.className || "").split(" ")[0] : null,
		};
	})()`);
		if (!chip.hit)
			throw new Error(
				`the plan chip is not hit-testable at its centre: ${chip.owner} owns it`,
			);

		await app.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: chip.x,
			y: chip.y,
		});
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", {
				type,
				x: chip.x,
				y: chip.y,
				button: "left",
				buttons: type === "mousePressed" ? 1 : 0,
				clickCount: 1,
			});
		}
		await wait(500);
		await app.evaluate(
			"new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 300))))",
		);
		const after = await app.evaluate(MEASURE);
		await app.screenshot(join(outDir, `${theme}-after.png`));

		const movers = [];
		const names = new Set(after.scrollBoxes.map((row) => row.name));
		for (const name of names) {
			const first = before.scrollBoxes.find((row) => row.name === name);
			const second = after.scrollBoxes.find((row) => row.name === name);
			if (!second) continue;
			if (
				second.scrollTop !== (first?.scrollTop ?? 0) ||
				second.scrollLeft !== (first?.scrollLeft ?? 0)
			)
				movers.push({
					name,
					region: Boolean(second.isRegion),
					scrollTop: [first?.scrollTop ?? 0, second.scrollTop],
					scrollLeft: [first?.scrollLeft ?? 0, second.scrollLeft],
				});
		}
		const report = {
			session: SESSION,
			backend: BACKEND,
			viewport: before.viewport,
			press: chip.label,
			paneOpen: [before.paneOpen, after.paneOpen],
			movers,
			before,
			after,
		};
		writeFileSync(
			join(outDir, `${theme}.json`),
			JSON.stringify(report, null, 2),
		);
		console.log(
			JSON.stringify(
				{
					viewport: before.viewport,
					press: chip.label,
					paneOpen: [before.paneOpen, after.paneOpen],
					movers,
					todosOffsetInRegion: after.todosOffsetInRegion,
					acceptance: {
						clipPx: after.acceptance.clipPx,
						cutRows: after.acceptance.cutRows,
						elidedRows: after.acceptance.elidedRows,
						collapsedTextRows: after.acceptance.collapsedTextRows,
						outsideRegionRows: after.acceptance.outsideRegionRows,
					},
				},
				null,
				2,
			),
		);
		console.log(`frames and readings in ${outDir}`);
		/*
		 * The claim, checked rather than printed. `region-only` says the press may move
		 * the pane's own reading position and nothing else; a mover that is not the
		 * region is the defect this repository shipped once already (the slot row
		 * sliding 108px sideways with the whole frame). Without this the numbers were
		 * re-derivable only by a human reading JSON, and a run that moved everything
		 * still exited 0.
		 */
		if (EXPECT === "region-only") {
			const stray = movers.filter((mover) => !mover.region);
			if (stray.length > 0)
				throw new Error(
					`expected only the pane's own region to move, but ${stray.length} other box(es) moved: ${JSON.stringify(stray)}`,
				);
			/*
			 * The other half of the claim: the press actually got somewhere. A run that
			 * moved nothing at all would pass the check above while proving nothing, so
			 * the section's offset inside the region is asserted to be flush with its top
			 * (both when the reveal had to scroll and when the section was already there).
			 * A mover list is allowed to be empty - the region at 0 with the section first
			 * has nothing to move - but the section's POSITION is not optional.
			 */
			const offset = after.todosOffsetInRegion;
			if (offset === null || Math.abs(offset) > 1)
				throw new Error(
					`expected the To-dos section at the top of the pane's own region, but its offset in that region is ${offset}`,
				);
			/*
			 * And the third half: the pane's own rows stayed LEGIBLE in the width it was
			 * given. A text box collapsed to nothing is the failure design round 2's D7
			 * named - the predicate used to skip exactly that box, so a run whose pane
			 * rendered every row's name at 0px reported `cutRows: 0` and passed. Gated
			 * rather than reported, because a number nothing fails on is the same defect
			 * one step along; `outsideRegionRows` is reported beside it and not gated,
			 * because a scroll region's content may legitimately exceed its client box
			 * (that is what its own scrollbar is for) and the cases that matter are
			 * graded by the row grammar.
			 */
			if (after.acceptance.collapsedTextRows > 0)
				throw new Error(
					`expected no text box collapsed to nothing in the pane, but ${after.acceptance.collapsedTextRows} did: ${JSON.stringify(after.acceptance.collapsedTextExamples)}`,
				);
		} else if (EXPECT !== "") {
			throw new Error(
				`unknown --expect=${EXPECT}; the only value is region-only`,
			);
		}
	}
} finally {
	app?.socket?.close();
	/*
	 * Kill the process GROUP, not the direct child, and tolerate a group that has
	 * already gone away: the direct child here is `npx`, whose exit says nothing
	 * about the `Electron.app` two levels below it. Signalling a bare `child.kill`
	 * is what left one app per run alive on this lane.
	 */
	const killGroup = (signal) => {
		if (!spawned) return;
		try {
			process.kill(-spawned.pid, signal);
		} catch {
			try {
				spawned.kill(signal);
			} catch {
				// Already gone.
			}
		}
	};
	killGroup("SIGTERM");
	/*
	 * WAIT for the exit before returning. A run that leaves the app holding its
	 * devtools port makes the NEXT run fail with "no app page target", which reads
	 * as a slow launch rather than as the collision it is (measured: two of three
	 * consecutive sizes failed that way). SIGKILL is the backstop for an app that
	 * ignores the term.
	 */
	for (
		let attempt = 0;
		attempt < 20 && spawned && spawned.exitCode === null;
		attempt++
	)
		await wait(250);
	if (spawned && spawned.exitCode === null) {
		killGroup("SIGKILL");
		await wait(500);
	}
	/*
	 * The group kill above covers the shape this driver spawns; this reap covers
	 * the shape it CANNOT see. An app that outlived its group - reparented to
	 * launchd before the signal, or a helper that detached itself - is reachable by
	 * the one thing every launch of it carries: its own scratch profile. The pattern
	 * is scoped to the mkdtemp'd path, so a peer's run and the operator's own app
	 * cannot be matched by it.
	 */
	try {
		execFileSync("pkill", ["-f", `user-data-dir=${PROFILE}`]);
	} catch {
		// `pkill` exits 1 when nothing matched, which is the good case.
	}
	await wait(250);
	/*
	 * The profile is this run's own mkdtemp; leave the machine as it was found.
	 */
	try {
		rmSync(PROFILE, { recursive: true, force: true });
	} catch {
		// A profile an app is still holding can refuse removal; not this run's failure.
	}
	/*
	 * The child's pipes keep this process alive on their own: a CLI that spawned
	 * Electron with `stdio: ["ignore", "pipe", "pipe"]` and only killed it waits
	 * forever for streams nobody will close, which is a hang AFTER the whole
	 * measurement is already on disk (measured: the work finished at 10:40 and the
	 * process was still alive when the run was timed out). Destroy them and exit
	 * on the result the run already has.
	 */
	spawned?.stdout?.destroy();
	spawned?.stderr?.destroy();
	spawned?.unref();
}
