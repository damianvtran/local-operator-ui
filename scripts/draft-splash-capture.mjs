#!/usr/bin/env node
/**
 * Capture the composer band's new-chat states, before and after, from the
 * evidence harness.
 *
 *     LO_DRAFT_SPLASH_PORT=5205 \
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
 *     LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:<port> \
 *     VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> \
 *       node scripts/draft-splash-capture.mjs --label=before \
 *         --sizes=1380x872,900x572,830x572,800x572 --require-cap=830x572,900x572
 *
 * `--sizes` is the list of CSS viewports to photograph, each with its own page
 * load and its own full draft -> send -> settled pass; the FIRST one carries the
 * full per-frame flip trace (the others record their settled readings and the
 * counts). `--require-cap` names the sizes at which the run has to have reached
 * the suggestion stack's cap - see its comment, and `CAP_ATTEMPTS` for what a
 * run that cannot does.
 *
 * Run it once per tree, each from its own worktree, both against the SAME
 * isolated backend: `--label=after` is the tree carrying the fix and
 * `--label=before` a worktree at the merge-base that does not, and with the
 * harness files copied in (they are untracked on the branch, so `cp
 * scripts/draft-splash-evidence.* <before-worktree>/scripts/`). Two worktrees
 * at once is the only way the pair differs by the change under test rather than
 * by the order the captures ran in.
 *
 * WHAT WAS DRIVEN, AND WITH WHAT. `scripts/draft-splash-evidence.vite.mjs`
 * serves the REAL `ChatPage` - the shipped store, `useCanonicalSessionStream`,
 * composer and sidebar - and this script drives a private headless Chrome over
 * raw CDP: the mechanism `scripts/capture-evidence.mjs` and
 * `scripts/diff-body-evidence.mjs` already use (a temp `--user-data-dir`, the
 * already-installed Chrome, the built-in WebSocket). Nothing is downloaded and
 * no browser-automation dependency is added, and no login is involved because
 * the page is a localhost harness that talks to a throwaway
 * `local-operator serve` at `hosting: test` through the dev desktop proxy.
 *
 * It is NOT the operator's browser and NOT the app window: the operator's
 * browser bridge was unavailable at capture time (recorded in
 * docs/evidence/draft-splash/README.md, and in the manifest's `source`), which
 * is why the standing "drive the operator's own browser" rule was set aside for
 * this rig rather than worked around with a second browser stack.
 *
 * WHY THE ASSERTIONS ARE IN HERE. A capture that quietly photographs a
 * degraded run publishes something that looks like evidence and is not (the
 * incident `new-chat-row-evidence.mjs` exists for). So the run FAILS rather
 * than writes a frame when: an error surface is on screen, the draft state was
 * never entered, the band disagrees with what the label says it should show,
 * the band or its suggestion stack runs past the pane it is in, a row of chips
 * is cut through its glyphs, `src/` is dirty against the commit the readback
 * records, or the admission flip never painted. The frames are only written
 * once the readings behind them hold.
 */

import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertFramePaints } from "./check-evidence.mjs";

const ROOT = resolve(import.meta.dirname, "..");
/**
 * Chrome, overridable because this path is macOS-only - the same shape
 * `diff-body-evidence.mjs` uses, and for the same reason: a missing browser
 * should name the setting rather than throw an ENOENT naming a path inside
 * Node.
 */
const CHROME =
	process.env.CHROME_PATH ??
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = /ws:\/\/[^:]+:(\d+)\//;

const ARGS = process.argv.slice(2);
const flag = (name, fallback) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
};

const LABEL = flag("label");
if (LABEL !== "before" && LABEL !== "after") {
	console.error(
		"usage: node scripts/draft-splash-capture.mjs --label=before|after [--port=5204]",
	);
	process.exit(2);
}
const PORT = Number(flag("port", process.env.LO_DRAFT_SPLASH_PORT ?? "5204"));
const OUT = join(ROOT, "docs", "evidence", "draft-splash");
const THEME = "localOperatorDark";

/*
 * The two product constants this driver reads rather than restates, as
 * top-level patterns: a regex compiled inside a function is re-created per call
 * (the repository's own `useTopLevelRegex` rule), and both of these run once per
 * capture anyway, which is exactly when a reader should be able to find them.
 */
const SUGGESTIONS_BLOCK =
	/const DEFAULT_MESSAGE_SUGGESTIONS = \[([\s\S]*?)\n\];/;
const SUGGESTION_LABEL = /"([^"]+)"/g;
const MAX_SUGGESTIONS = /const MAX_SUGGESTIONS = (\d+);/;

/**
 * The app's own default window, whose CSS viewport is the window minus the
 * macOS title bar (`src/main/window-mode.ts`; measured 1380x872 in
 * `docs/evidence/chat-shell/`). The harness has no window chrome, so the
 * viewport is set to the CSS number the app actually paints into. Every other
 * size a run is given is a CSS viewport for the same reason.
 */

const MARKER = `draft-splash-probe-${process.pid}`;

if (
	!process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ||
	!process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL
) {
	console.error(
		"LOCAL_OPERATOR_DESKTOP_TOKEN and LOCAL_OPERATOR_DESKTOP_BACKEND_URL must both be set: the harness page reaches the backend through the dev desktop proxy, which reads them in the Vite process (they never reach the page).",
	);
	process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The chip list, read from the product rather than restated.
 *
 * How many chips the band carries and which list they come from is part of the
 * claim, so the driver parses `DEFAULT_MESSAGE_SUGGESTIONS` out of
 * `chat-content.tsx` (and `MAX_SUGGESTIONS`, the composer's sample size, out of
 * `message-input.tsx`) and asserts the rendered row against them. Hard-coded
 * numbers here would be a second copy of a product constant, and the copy is
 * what goes stale. The composer samples the list at RANDOM, so the labels
 * differ between runs and only the count and the membership are stable - which
 * is what is asserted.
 */
function readProduct() {
	const chat = readFileSync(
		join(ROOT, "src/renderer/src/features/chat/components/chat-content.tsx"),
		"utf8",
	);
	const block = chat.match(SUGGESTIONS_BLOCK);
	if (!block) throw new Error("DEFAULT_MESSAGE_SUGGESTIONS not found");
	const suggestions = [...block[1].matchAll(SUGGESTION_LABEL)].map((m) => m[1]);
	const input = readFileSync(
		join(ROOT, "src/renderer/src/features/chat/components/message-input.tsx"),
		"utf8",
	);
	const max = input.match(MAX_SUGGESTIONS);
	if (!max) throw new Error("MAX_SUGGESTIONS not found");
	return { suggestions, max: Number(max[1]) };
}

const PRODUCT = readProduct();
const CHIPS = PRODUCT.suggestions;

/**
 * What each tree is expected to show at a given size, so a broken run cannot
 * publish.
 *
 * The before tree is the defect: the band holds the hydration skeleton and
 * neither the greeting nor the chips. The after tree is the claim. Both live on
 * the SPLASH branch, which is gated on `!isSmallView` - so a window narrow
 * enough to take the small view shows the same thing on either tree, which is
 * what makes the minimum window the control for that branch.
 */
const expectedFor = ({ width }) => {
	if (width - SESSION_LIST_WIDTH < SMALL_VIEW_BELOW)
		return { greeting: 0, skeleton: 0, chips: 0 };
	if (LABEL === "before") return { greeting: 0, skeleton: 1, chips: 0 };
	return {
		greeting: 1,
		skeleton: 0,
		chips: Math.min(PRODUCT.max, CHIPS.length),
	};
};

/**
 * The commit each run is a picture of, recorded rather than asserted in prose.
 *
 * The manifest's other supplementaries carry `capturedAtHead` for exactly this
 * reason (code review round 1, M2): what makes a before/after pair mean anything
 * is which tree each half photographed, and a reader of the frames has no
 * worktree to check it in. `capturedAtSrcTree` is the stronger of the two - it is
 * the same stamp the manifest's own `srcTree` is held to - so a reader can see
 * at a glance that the frames are pictures of the committed source rather than of
 * somebody's working tree.
 */
const provenance = () => {
	const git = (...args) =>
		execFileSync("git", args, { cwd: ROOT }).toString().trim();
	return {
		capturedAtHead: git("rev-parse", "HEAD"),
		capturedAtSrcTree: git("rev-parse", "HEAD:src"),
		dirtySource: git("status", "--porcelain", "--", "src").length > 0,
	};
};

/**
 * The sizes a run photographs, in order, each with its own page load. The first
 * is the one that carries the full per-frame flip trace; pass the app's own
 * window first.
 *
 * 830x572 is the narrowest window that still takes the splash branch at the
 * app's own minimum HEIGHT (`WINDOW_MIN_HEIGHT = 600` minus the macOS title
 * bar), which is where design round 1 measured the band's overflow (D1/D2);
 * 800x572 is the minimum window itself, whose pane is narrow enough for the
 * small view.
 */
const SIZES = flag("sizes", "1380x872")
	.split(",")
	.map((entry) => entry.trim())
	.filter(Boolean)
	.map((entry) => {
		const match = /^(\d+)x(\d+)$/.exec(entry);
		if (!match)
			throw new Error(`--sizes entries are WxH; got ${JSON.stringify(entry)}`);
		return { id: entry, width: Number(match[1]), height: Number(match[2]) };
	});
const DEFAULT_SIZE = SIZES[0];

/**
 * The sizes at which a run must have EXERCISED the suggestion stack's cap - i.e.
 * the sample must have wrapped past the room the band has - because otherwise a
 * frame of "containment" is a frame of a stack that never needed containing.
 *
 * The chips are sampled at random per mount, so a short draw can be re-drawn but
 * not asserted away: the driver reloads and re-samples, and fails loudly rather
 * than publishing a frame that proves nothing.
 */
const REQUIRE_CAP = new Set(
	flag("require-cap", "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean),
);
const CAP_ATTEMPTS = Number(flag("cap-attempts", "6"));

/**
 * The chat column's width is the window minus the session list's default width,
 * and that width is what decides whether the pane takes the band's small-view
 * branch. The driver reads the band's own box back and fails if it disagrees, so
 * this figure cannot drift away from the layout it predicts.
 */
const SESSION_LIST_WIDTH = 280;
/** `isSmallView` is `contentRect.width < 550` (`chat-content.tsx`). */
const SMALL_VIEW_BELOW = 550;

async function waitFor(url, attempts = 120) {
	for (let i = 0; i < attempts; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error(`${url} never came up`);
}

/** A private headless Chrome over raw CDP, the shape the other harnesses use. */
async function launchChrome(profile) {
	if (!existsSync(CHROME))
		throw new Error(`no Chrome at ${CHROME} - set CHROME_PATH to one`);
	const chrome = spawn(CHROME, [
		"--headless=new",
		"--no-first-run",
		"--no-default-browser-check",
		"--remote-debugging-port=0",
		`--user-data-dir=${profile}`,
		"--disable-gpu",
		"--hide-scrollbars=false",
		"about:blank",
	]);
	const port = await new Promise((resolvePort, reject) => {
		chrome.stderr.on("data", (chunk) => {
			const match = DEBUG_PORT.exec(String(chunk));
			if (match) resolvePort(match[1]);
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
		setTimeout(() => reject(new Error("Chrome reported no debug port")), 20000);
	});
	const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page = list.find((target) => target.type === "page");
	let nextId = 1;
	const pending = new Map();
	/*
	 * Console and log events are kept rather than dropped: a harness page that
	 * does not come up is diagnosed by what its own console said, and a capture
	 * that fails without that is a run somebody has to repeat by hand.
	 */
	const events = [];
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.method) {
			events.push(message);
			return;
		}
		if (!message.id || !pending.has(message.id)) return;
		const { resolve: done, reject } = pending.get(message.id);
		pending.delete(message.id);
		message.error
			? reject(new Error(JSON.stringify(message.error)))
			: done(message.result);
	};
	await new Promise((opened) => {
		ws.onopen = opened;
	});
	const send = (method, params = {}) =>
		new Promise((done, reject) => {
			const id = nextId++;
			pending.set(id, { resolve: done, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
	return { chrome, send, events };
}

/** One CDP `Runtime.evaluate`, with the page's own exception surfaced. */
async function evaluate(send, expression, awaitPromise = false) {
	const { result, exceptionDetails } = await send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise,
	});
	if (exceptionDetails)
		throw new Error(
			`page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
		);
	return result.value;
}

/** The readback the harness page publishes, parsed. */
const readProbe = (send) =>
	evaluate(
		send,
		"JSON.parse(document.getElementById('probe').textContent || 'null')",
	);

/** Every `[role=alert]` text on screen, which no healthy frame may carry. */
const alertText = (send) =>
	evaluate(
		send,
		"[...document.querySelectorAll('[role=alert]')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())",
	);

/**
 * Click a control by the rect an expression reports, with real input events.
 *
 * `Input.dispatchMouseEvent` rather than `element.click()`: the composer's own
 * submit path and the sidebar row are both wired to real pointer events, and a
 * synthetic click would prove less about what a person's click does.
 */
async function clickRect(send, find) {
	const box = await evaluate(send, find);
	if (!box) throw new Error("the control to click is not in the document");
	const x = box.x + box.w / 2;
	const y = box.y + box.h / 2;
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x,
			y,
			button: "left",
			clickCount: 1,
		});
	}
}

const RECT = (selector, label) => `(() => {
	const el = ${selector};
	if (!el) return null;
	el.scrollIntoView({ block: "center" });
	const r = el.getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height, label: ${JSON.stringify(label)} };
})()`;

const NEW_CHAT_ROW = RECT(
	`[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'New chat')`,
	"sidebar New chat row",
);

async function main() {
	mkdirSync(OUT, { recursive: true });
	const profile = mkdtempSync(join(tmpdir(), "draft-splash-chrome-"));
	let chrome = null;
	const vite = spawn(
		join(ROOT, "node_modules", ".bin", "vite"),
		["--config", "scripts/draft-splash-evidence.vite.mjs"],
		{
			cwd: ROOT,
			env: {
				...process.env,
				/*
				 * The renderer's capability and catalogue calls take the SAME origin the
				 * proxy relays to. Defaulted here from the backend the caller already
				 * named, because the two disagreeing is a capture of a half-offline app
				 * rather than of the draft state.
				 */
				VITE_LOCAL_OPERATOR_API_URL:
					process.env.VITE_LOCAL_OPERATOR_API_URL ??
					process.env.LOCAL_OPERATOR_DESKTOP_BACKEND_URL,
			},
		},
	);
	let viteLog = "";
	const collect = (chunk) => {
		viteLog += chunk;
	};
	vite.stdout.on("data", collect);
	vite.stderr.on("data", collect);
	const teardown = () => {
		vite.kill("SIGKILL");
		/* And the browser: its stderr is piped for the debug-port handshake,
		   which is a live handle on the event loop - without this the driver
		   prints its last line and then hangs instead of exiting. */
		chrome?.kill("SIGKILL");
		try {
			rmSync(profile, { recursive: true, force: true });
		} catch {
			// Chrome may still hold a handle; the path is in /tmp.
		}
	};
	process.on("SIGINT", () => {
		teardown();
		process.exit(130);
	});

	const frames = [];

	try {
		const url = `http://localhost:${PORT}/draft-splash-evidence.html`;
		await waitFor(url);
		const launched = await launchChrome(profile);
		chrome = launched.chrome;
		const { send, events } = launched;
		await send("Page.enable");
		await send("Runtime.enable");
		await send("Log.enable");

		/** What the page itself said, for a run that has to be diagnosed. */
		const pageLog = () =>
			events
				.filter(
					(e) =>
						e.method === "Log.entryAdded" ||
						e.method === "Runtime.consoleAPICalled",
				)
				.slice(-12)
				.map((e) =>
					e.method === "Log.entryAdded"
						? `[${e.params.entry.level}] ${e.params.entry.text}`
						: `[${e.params.type}] ${(e.params.args ?? []).map((a) => a.value ?? a.description).join(" ")}`,
				);

		/*
		 * The frames are pictures of a COMMIT, and the readback says which (code
		 * review round 1, M2). An uncommitted edit under `src/` would make that
		 * claim false, so the run refuses rather than recording a head that is not
		 * what it photographed.
		 */
		const origin = provenance();
		if (origin.dirtySource)
			throw new Error(
				"src/ has uncommitted changes: this run records the commit it photographed, so commit the change first and capture after it (see docs/evidence/draft-splash/README.md)",
			);

		/*
		 * A headless page is never the focused window, and the composer's
		 * caret/`:focus` ring would be missing from a frame of a control the
		 * user is about to type into. This is the same switch
		 * `capture-evidence.mjs` uses, named here because it changes what the
		 * frame shows.
		 */
		await send("Emulation.setFocusEmulationEnabled", { enabled: true });
		/*
		 * The marker is installed on the DOCUMENT rather than evaluated after
		 * `Page.navigate` returns: navigation resolves before the new document
		 * exists, and a `Runtime.evaluate` raced against it can land in the
		 * outgoing context - which reads as "the transcript never painted" rather
		 * than as a missing probe. Installed once for every size, because each
		 * size is a fresh load of the same page.
		 */
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: [
				/*
				 * Each size is a FRESH app, not a reload of the one before it.
				 * The canonical sessions store persists to localStorage, so without this
				 * the second size opens the session the first size's send created -
				 * and `New chat` on a pane that already has a session is a different
				 * state from the one these frames are of (the run refuses it rather
				 * than photographing it). Clearing the store's own storage at document
				 * start is what the first launch of the app looks like; the harness
				 * sets the cwd it needs after this runs.
				 */
				"window.localStorage.clear();",
				`window.__draftSplashMarker = ${JSON.stringify(MARKER)};`,
				`window.__draftSplashChipList = ${JSON.stringify(CHIPS)};`,
			].join("\n"),
		});

		/**
		 * Park the pointer on neutral ground before the shutter.
		 *
		 * The driver's clicks leave the pointer where it put them, and the sidebar's
		 * rows carry a hover step (`hover:bg-elevated` - a colour step, per the
		 * design contract, not a lift). In the first pass that made the two runs'
		 * SIDEBARS differ by 15,619 pixels of hover wash, which is a difference
		 * between two photographs rather than between two trees, and the claim that
		 * the pair differs only inside the band is worth being able to check. The
		 * far corner is the chat column's own ground, where a pointer rests on
		 * nothing interactive, and the wait covers the style recalc.
		 */
		const parkPointer = async (size) => {
			await send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: size.width - 4,
				y: size.height - 4,
			});
			await evaluate(
				send,
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
				true,
			);
		};
		const shoot = async (size, name, clip = null) => {
			await parkPointer(size);
			const { data } = await send("Page.captureScreenshot", {
				format: "png",
				...(clip ? { clip: { ...clip, scale: 1 } } : {}),
			});
			const path = join(OUT, `${LABEL}-${name}.png`);
			writeFileSync(path, Buffer.from(data, "base64"));
			// The same guard the swept set goes through: a frame whose dominant
			// colour is not one of the theme's grounds, or that is one flat colour,
			// is a picture of nothing.
			assertFramePaints(path, THEME);
			frames.push(path);
			return path;
		};

		/**
		 * Everything the band's own containment has to satisfy, from the reading
		 * alone - the check the frames are only the illustration of.
		 */
		const containmentProblems = (size, band) => {
			const problems = [];
			const bandBox = band.boxes?.band;
			if (!bandBox) {
				problems.push("the band's own box was not read");
			} else if (bandBox.y + bandBox.h > size.height + 0.5) {
				problems.push(
					`the band's box runs to ${Math.round((bandBox.y + bandBox.h) * 10) / 10}px in a ${size.height}px window`,
				);
			}
			if (band.chips === 0) return problems;

			const stack = band.stack;
			if (!stack) {
				problems.push("the band carries chips but no stack box");
				return problems;
			}
			if (!stack.topEdgeInside)
				problems.push("the suggestion stack starts above the top of the window");
			if (!stack.lastVisibleRowInside)
				problems.push(
					`the last row inside the stack ends at y ${stack.lastVisibleRowBottom}, past the ${size.height}px window`,
				);
			if (!stack.boundaryInGap)
				problems.push(
					"the stack's boundary falls inside a row, so a row of chips is cut through its glyphs",
				);
			if (stack.visibleRows === 0)
				problems.push("no chip row is inside the stack's own box");
			return problems;
		};

		/** Whether this run's sample actually reached the cap. */
		const capEngaged = (band) =>
			Boolean(band.stack) &&
			band.stack.contentHeight > band.stack.height + 0.5 &&
			band.stack.visibleRows < band.stack.rowCount;

		/** Load the harness at a size and stage a New chat on it. */
		const loadDraft = async (size) => {
			await send("Emulation.setDeviceMetricsOverride", {
				width: size.width,
				height: size.height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Page.navigate", { url });

			/*
			 * Wait for the app's own readiness, not a harness flag: the sidebar's
			 * New chat row is DISABLED until the session catalogue has loaded, so
			 * "the row exists and is enabled" is the product telling us the surface
			 * is where the frames say it is. Capabilities and the catalogue are the
			 * two calls behind it.
			 */
			let armed = false;
			for (let attempt = 0; attempt < 120 && !armed; attempt++) {
				armed = Boolean(
					await evaluate(
						send,
						`(() => {
							const row = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'New chat');
							return Boolean(row) && !row.disabled;
						})()`,
					),
				);
				if (!armed) await sleep(500);
			}
			if (!armed) {
				console.error(`page log:\n${pageLog().join("\n")}`);
				console.error(
					`page text:\n${await evaluate(send, "document.body.innerText.slice(0, 600)")}`,
				);
				throw new Error(
					`${size.id}: the New chat row never became available`,
				);
			}
			const alerts = await alertText(send);
			if (alerts.length > 0)
				throw new Error(
					`the page is showing an error surface: ${alerts.join(" | ")}`,
				);

			/*
			 * The click is retried once: the dev server re-optimizes its deps when the
			 * harness files change and pushes a reload into the page it is serving, and
			 * a click that lands across that reload stages nothing (observed). A second
			 * click on a page that has finished loading is the same click the product's
			 * own New chat button gets, so retrying it costs no fidelity - it only
			 * stops a reload from looking like a broken store.
			 */
			let probe = null;
			for (let click = 0; click < 2 && !probe?.store?.activeDraftKey; click++) {
				await clickRect(send, NEW_CHAT_ROW);
				for (let attempt = 0; attempt < 20; attempt++) {
					probe = await readProbe(send);
					if (probe?.store?.activeDraftKey) break;
					await sleep(250);
				}
			}
			if (!probe?.store?.activeDraftKey)
				throw new Error(
					`${size.id}: clicking New chat did not stage a draft`,
				);
			if (probe.store.activeSessionId !== null)
				throw new Error(
					`the pane has a session (${probe.store.activeSessionId}), so this is not a New chat`,
				);
			return probe;
		};

		/**
		 * One size, photographed end to end in one page load.
		 *
		 * The chips are SAMPLED AT RANDOM per mount, so a run at a size where the
		 * stack is supposed to be under pressure can draw a sample short enough to
		 * prove nothing. The stack's own reading decides: a size named in
		 * `--require-cap` reloads and re-samples until the cap actually bit, and the
		 * run fails rather than publishing a frame of a stack that never needed
		 * containing.
		 */
		const captureSize = async (size) => {
			const expected = expectedFor(size);
			let settled = null;
			let problems = [];

			for (let attempt = 1; attempt <= CAP_ATTEMPTS; attempt++) {
				await loadDraft(size);
				/*
				 * Two consecutive frames of the settled state, as the operator's rule
				 * asks: anything that settles has to be captured across the settle, not
				 * once. The reading is taken after the pair, so what is recorded is what
				 * was photographed.
				 */
				await sleep(600);
				settled = (await readProbe(send)).bandNow;

				problems = containmentProblems(size, settled);
				for (const field of ["greeting", "skeleton", "chips"]) {
					if (settled[field] !== expected[field])
						problems.push(
							`the band shows ${field}=${settled[field]}, and this tree at ${size.id} is expected to show ${field}=${expected[field]}`,
						);
				}
				if (REQUIRE_CAP.has(size.id) && !capEngaged(settled))
					problems.push(
						"this sample never reached the cap, so the frame would show a stack that needed no containing",
					);
				if (problems.length === 0) break;
				if (attempt < CAP_ATTEMPTS)
					console.log(
						`${size.id}: attempt ${attempt} is not publishable (${problems.join("; ")}) - reloading for a new sample`,
					);
			}
			if (problems.length > 0)
				throw new Error(`${size.id}: ${problems.join("; ")}`);

			if (expected.chips > 0) {
				const labels = settled.chipLabels;
				if (labels.length !== expected.chips)
					throw new Error(
						`${LABEL}: the band shows ${labels.length} chips, and the composer's own MAX_SUGGESTIONS over ${CHIPS.length} suggestions is ${expected.chips}`,
					);
				for (const label of labels)
					if (!CHIPS.includes(label))
						throw new Error(
							`${LABEL}: a chip reads ${JSON.stringify(label)}, which is not one of DEFAULT_MESSAGE_SUGGESTIONS`,
						);
				if (new Set(labels).size !== labels.length)
					throw new Error(`${LABEL}: the same suggestion is rendered twice`);
			}
			console.log(
				`${size.id}: draft settled - band ${settled.bandHeight}px, ` +
					`greeting ${settled.greeting}, skeleton ${settled.skeleton}, chips ${settled.chips}, ` +
					`stack rows ${settled.stack?.visibleRows ?? 0}/${settled.stack?.rowCount ?? 0} visible in ${settled.stack?.height ?? 0}px ` +
					`(content ${settled.stack?.contentHeight ?? 0}px, room ${settled.stack?.room ?? 0}px)`,
			);

			await shoot(size, `draft-${size.id}-frame1`);
			await sleep(400);
			await shoot(size, `draft-${size.id}-frame2`);
			const draft = await readProbe(send);
			const bandBox = draft.bandNow.boxes?.band;
			if (bandBox)
				await shoot(size, `draft-band-${size.id}`, {
					x: bandBox.x,
					y: bandBox.y,
					width: bandBox.w,
					height: bandBox.h,
				});

			/*
			 * The admission flip, which is the other half of the claim: when a send
			 * is admitted the pane becomes a real session, and the band must not
			 * flash the greeting or the skeleton over the optimistic echo. The
			 * readback carries a per-frame trace of the band for exactly this, and
			 * what is asserted below is the property rather than a frame count.
			 */
			await clickRect(
				send,
				RECT("document.querySelector('textarea')", "composer"),
			);
			await send("Input.insertText", { text: MARKER });
			await clickRect(
				send,
				RECT(
					`document.querySelector('[aria-label="Send message"]')`,
					"Send message",
				),
			);
			/*
			 * The band as it stood when the send was clicked - the frame the user was
			 * looking at when they pressed it. On the after tree that is the greeting
			 * and the chips, i.e. the same band as before the click; on the before tree
			 * it is the skeleton, which is the defect.
			 */
			const atClick = await readProbe(send);
			/*
			 * Named for what it shows rather than for the instant of the click. The
			 * screenshot round trip is slower than the admission on this backend, so
			 * what lands here is the state just AFTER the identity flip - a real
			 * session whose page is owed, which still waits on both trees. It is NOT
			 * the instant of Enter, and whether the echo has painted by the time of
			 * the shutter is a race this frame does not claim to have won: the
			 * readback's `bandAtFlipShot` is taken immediately after the shutter and
			 * says which of the two it caught.
			 * That instant is what the per-frame trace in the readback carries, because
			 * no still can be timed to it. What this frame shows is read back
			 * immediately AFTER the shutter, so the record says which state it is
			 * rather than which state it was meant to be.
			 */
			if (size.id === DEFAULT_SIZE.id) await shoot(size, "send-after-flip");
			const atFlipShot = await readProbe(send);

			let painted = false;
			let firstPainted = null;
			for (let attempt = 0; attempt < 100 && !painted; attempt++) {
				const reading = await readProbe(send);
				if (reading?.bandNow?.transcriptPainted) {
					painted = true;
					firstPainted = reading;
					break;
				}
				await sleep(100);
			}
			if (!painted)
				throw new Error(
					`${size.id}: the send never painted a row in the transcript, so there is no flip to photograph`,
				);
			if (size.id === DEFAULT_SIZE.id) await shoot(size, "send-first-painted");
			await sleep(1500);
			const afterSend = await readProbe(send);
			await shoot(size, `send-settled-${size.id}-frame1`);
			if (size.id === DEFAULT_SIZE.id) {
				await sleep(400);
				await shoot(size, "send-settled-frame2");
			}

			/*
			 * The traced frames are the record, and the trace is what makes the
			 * check possible at all: a greeting or a skeleton painted over the echo
			 * is a one-frame state that two stills cannot show. `transcriptPainted`
			 * says the echo was on screen for that frame, so the property is
			 * "no traced frame had a message painted AND a claim about what is in
			 * the pane".
			 */
			const overEcho = (afterSend.frames ?? []).filter(
				(frame) =>
					frame.transcriptPainted &&
					(frame.greeting > 0 || frame.skeleton > 0 || frame.chips > 0),
			);
			if (overEcho.length > 0)
				throw new Error(
					`${size.id}: ${overEcho.length} traced frame(s) showed the greeting/skeleton/chips over the painted echo: ${JSON.stringify(overEcho.slice(0, 3))}`,
				);
			const flipFrames = (afterSend.frames ?? []).filter(
				(frame) => frame.transcriptPainted,
			).length;
			if (flipFrames === 0)
				throw new Error(
					`${size.id}: the trace holds no frame with the echo painted, so the property above was never exercised`,
				);

			/*
			 * The admitted-send state, which the peer change at the same height
			 * budget (PR #155) also has to hold in: the greeting and the chips are
			 * gone and the band is the composer and its readings alone. Nothing is
			 * capped in it - the constraint is only that it is still inside the pane.
			 */
			const sendProblems = containmentProblems(size, afterSend.bandNow);
			if (afterSend.bandNow.chips > 0)
				sendProblems.push(
					"the suggestion chips are still in the band after the send was admitted",
				);
			if (sendProblems.length > 0)
				throw new Error(
					`${size.id}: the admitted-send band is not contained: ${sendProblems.join("; ")}`,
				);

			return {
				viewport: size.id,
				expected,
				draft,
				/*
				 * The full traced frames are kept once, at the default size: the
				 * property is asserted at every size above, but four copies of a
				 * per-animation-frame trace is a megabyte of JSON that says the same
				 * thing four times.
				 */
				afterSend: {
					bandNow: afterSend.bandNow,
					frames:
						size.id === DEFAULT_SIZE.id ? (afterSend.frames ?? []) : [],
				},
				flip: {
					framesWithEchoPainted: flipFrames,
					tracedFrames: (afterSend.frames ?? []).length,
					firstPaintedBand: firstPainted?.bandNow ?? null,
					bandAtSendClick: atClick?.bandNow ?? null,
					bandAtFlipShot: atFlipShot?.bandNow ?? null,
					bandStates: (afterSend.frames ?? []).map((frame) => ({
						at: frame.at,
						echo: frame.transcriptPainted,
						greeting: frame.greeting > 0,
						skeleton: frame.skeleton > 0,
						chips: frame.chips > 0,
					})),
				},
			};
		};

		const sizes = [];
		for (const size of SIZES) {
			sizes.push(await captureSize(size));
		}

		/*
		 * The band's own column width is asserted rather than assumed: whether a
		 * window takes the small view or the splash is decided by the column's
		 * width, so a session list that changed width would silently move every
		 * expectation in this file.
		 */
		for (const captured of sizes) {
			const [width] = captured.viewport.split("x").map(Number);
			const bandWidth = captured.draft.bandNow.boxes?.band?.w;
			if (bandWidth !== width - SESSION_LIST_WIDTH)
				throw new Error(
					`${captured.viewport}: the band is ${bandWidth}px wide, and this run predicts the window minus a ${SESSION_LIST_WIDTH}px session list`,
				);
		}

		const readback = {
			label: LABEL,
			capturedAt: new Date().toISOString(),
			...origin,
			instrument:
				"scripts/draft-splash-capture.mjs - private headless Chrome over raw CDP driving scripts/draft-splash-evidence.html (the shipped ChatPage) against an isolated local-operator serve through the dev desktop proxy",
			url,
			theme: THEME,
			chipList: "DEFAULT_MESSAGE_SUGGESTIONS (chat-content.tsx)",
			expected: Object.fromEntries(
				SIZES.map((size) => [size.id, expectedFor(size)]),
			),
			sizes,
			frames: frames.map((path) => path.slice(ROOT.length + 1)),
		};
		const readbackPath = join(OUT, `readback-${LABEL}.json`);
		writeFileSync(readbackPath, `${JSON.stringify(readback, null, 2)}\n`);
		console.log(
			`${LABEL}: ${frames.length} frames at ${SIZES.map((size) => size.id).join(", ")}`,
		);
		console.log(`readback: ${readbackPath}`);
		teardown();
	} catch (error) {
		teardown();
		console.error(viteLog.split("\n").slice(-8).join("\n"));
		throw error;
	}
}

await main();
