#!/usr/bin/env node
/**
 * Capture the composer band's new-chat states, before and after, from the
 * evidence harness.
 *
 *     LO_DRAFT_SPLASH_PORT=5205 \
 *     LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
 *     LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:<port> \
 *     VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> \
 *       node scripts/draft-splash-capture.mjs --label=before
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
 * never entered, the band disagrees with what the label says it should show, or
 * the admission flip never painted. The frames are only written once the
 * readings behind them hold.
 */

import { spawn } from "node:child_process";
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
 * viewport is set to the CSS number the app actually paints into.
 */
const WIDTH = 1380;
const HEIGHT = 872;

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
 * What each tree is expected to show, so a broken run cannot publish.
 *
 * The before tree is the defect: the band holds the hydration skeleton and
 * neither the greeting nor the chips. The after tree is the claim.
 */
const EXPECTED =
	LABEL === "before"
		? { greeting: 0, skeleton: 1, chips: 0 }
		: {
				greeting: 1,
				skeleton: 0,
				chips: Math.min(PRODUCT.max, CHIPS.length),
			};

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
	const parkPointer = async (send) => {
		await send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: WIDTH - 4,
			y: HEIGHT - 4,
		});
		await evaluate(
			send,
			"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			true,
		);
	};
	const shoot = async (send, name, clip = null) => {
		await parkPointer(send);
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
		 * Consecutive frames, the app's default viewport, and no reload between
		 * states: the composer's textarea is a growable part that keeps whatever
		 * height its previous content gave it, so a state entered from a fresh
		 * load is the only one comparable to another state's.
		 */
		await send("Emulation.setDeviceMetricsOverride", {
			width: WIDTH,
			height: HEIGHT,
			deviceScaleFactor: 1,
			mobile: false,
		});
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
		 * than as a missing probe.
		 */
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: [
				`window.__draftSplashMarker = ${JSON.stringify(MARKER)};`,
				`window.__draftSplashChipList = ${JSON.stringify(CHIPS)};`,
			].join("\n"),
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
			console.error(
				`readback:\n${await evaluate(send, "(document.getElementById('probe')?.textContent ?? 'none').slice(0, 400)")}`,
			);
			throw new Error("the New chat row never became available");
		}
		const alerts = await alertText(send);
		if (alerts.length > 0)
			throw new Error(
				`the page is showing an error surface: ${alerts.join(" | ")}`,
			);

		await clickRect(send, NEW_CHAT_ROW);
		let probe = null;
		for (let attempt = 0; attempt < 40; attempt++) {
			probe = await readProbe(send);
			if (probe?.store?.activeDraftKey) break;
			await sleep(250);
		}
		if (!probe?.store?.activeDraftKey)
			throw new Error("clicking New chat did not stage a draft");
		if (probe.store.activeSessionId !== null)
			throw new Error(
				`the pane has a session (${probe.store.activeSessionId}), so this is not a New chat`,
			);

		// Two consecutive frames of the settled state, as the operator's rule
		// asks: anything that settles has to be captured across the settle, not
		// once.
		await sleep(600);
		await shoot(send, "draft-1380x872-frame1");
		await sleep(400);
		await shoot(send, "draft-1380x872-frame2");
		const settled = await readProbe(send);
		const band = settled.bandNow;
		const clip = band.boxes?.band;
		if (clip)
			await shoot(send, "draft-band", {
				x: clip.x,
				y: clip.y,
				width: clip.w,
				height: clip.h,
			});

		for (const field of ["greeting", "skeleton", "chips"]) {
			if (band[field] !== EXPECTED[field])
				throw new Error(
					`${LABEL}: the band shows ${field}=${band[field]}, and this tree is expected to show ${field}=${EXPECTED[field]} - the run is not of the state it claims`,
				);
		}
		if (EXPECTED.chips > 0) {
			const labels = band.chipLabels;
			if (labels.length !== EXPECTED.chips)
				throw new Error(
					`${LABEL}: the band shows ${labels.length} chips, and the composer's own MAX_SUGGESTIONS over ${CHIPS.length} suggestions is ${EXPECTED.chips}`,
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
			`${LABEL}: draft settled - band ${band.bandHeight}px, ` +
				`greeting ${band.greeting}, skeleton ${band.skeleton}, chips ${band.chips}; ` +
				`band text ${JSON.stringify(band.text.slice(0, 120))}`,
		);

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
		await shoot(send, "send-after-flip");
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
				"the send never painted a row in the transcript, so there is no flip to photograph",
			);
		await shoot(send, "send-first-painted");
		await sleep(1500);
		const afterSend = await readProbe(send);
		await shoot(send, "send-settled-frame1");
		await sleep(400);
		await shoot(send, "send-settled-frame2");

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
				`${overEcho.length} traced frame(s) showed the greeting/skeleton/chips over the painted echo: ${JSON.stringify(overEcho.slice(0, 3))}`,
			);
		const flipFrames = (afterSend.frames ?? []).filter(
			(frame) => frame.transcriptPainted,
		).length;
		if (flipFrames === 0)
			throw new Error(
				"the trace holds no frame with the echo painted, so the property above was never exercised",
			);

		const readback = {
			label: LABEL,
			capturedAt: new Date().toISOString(),
			instrument:
				"scripts/draft-splash-capture.mjs - private headless Chrome over raw CDP driving scripts/draft-splash-evidence.html (the shipped ChatPage) against an isolated local-operator serve through the dev desktop proxy",
			url,
			viewport: `${WIDTH}x${HEIGHT}`,
			theme: THEME,
			expected: EXPECTED,
			chipList: "DEFAULT_MESSAGE_SUGGESTIONS (chat-content.tsx)",
			draft: settled,
			afterSend,
			flip: {
				framesWithEchoPainted: flipFrames,
				tracedFrames: (afterSend.frames ?? []).length,
				firstPaintedBand: firstPainted?.bandNow ?? null,
				bandAtSendClick: atClick?.bandNow ?? null,
				bandAtFlipShot: atFlipShot?.bandNow ?? null,
				/*
				 * The trace itself, whittled to the four booleans the claim is about,
				 * with the harness's own clock. Both the stills and this list exist
				 * because neither answers the other's question: the stills show what the
				 * band looked like, the list shows that nothing was on screen for only a
				 * frame or two without being seen.
				 */
				bandStates: (afterSend.frames ?? []).map((frame) => ({
					at: frame.at,
					echo: frame.transcriptPainted,
					greeting: frame.greeting > 0,
					skeleton: frame.skeleton > 0,
					chips: frame.chips > 0,
				})),
			},
			frames: frames.map((path) => path.slice(ROOT.length + 1)),
		};
		const readbackPath = join(OUT, `readback-${LABEL}.json`);
		writeFileSync(readbackPath, `${JSON.stringify(readback, null, 2)}\n`);
		console.log(
			`${LABEL}: ${frames.length} frames, ${flipFrames} traced frames with the echo painted (0 with a claim over it)`,
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
