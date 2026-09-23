#!/usr/bin/env node
/**
 * Photograph what the composer does with a refusal the session owner raised
 * before admission, one arm per state.
 *
 *     node docs/evidence/owner-refusal-send/harness/capture.mjs <out-dir> [--tree=after]
 *
 * One command, self-contained and reaped: this script starts the scripted owner
 * (`stub-owner.mjs`), the app's own browser dev server (`app.vite.mjs`) and its
 * own private headless Chrome, drives the shipped composer through a send, and
 * kills all three on the way out - including on a failure - so a run leaves
 * nothing behind for the next session to find. The alternative (three terminals
 * and a hand-taken screenshot) is what the frames beside this file exist to
 * replace.
 *
 * WHAT IS REAL HERE, and what the README repeats beside the frames: the
 * transport, the error decoding, the canonical store's classification, the
 * composer and its copy are the SHIPPING code, reached through
 * `desktopProxyPlugin`'s `/__desktop` route - the same `requestDesktop` in
 * `src/main/desktop-transport.ts` that Electron's IPC handler calls. The OWNER's
 * verdict is substituted at the HTTP boundary, because reaching a real build
 * drain or a wedged owner on demand is not reproducible; the sentences it
 * answers with are quoted from the backend's own (`session/errors.py` and the
 * two owner codes in `shared/desktop-contract.ts`). Packaged Electron IPC, a
 * native window and the real ladder's timing are NOT proven here.
 *
 * WHAT IS ASSERTED, and why a frame alone cannot carry it. Every arm is driven
 * through the same pipeline with the same box, and the finding is a DIFFERENCE
 * between the halves: the state the refusal leaves (which of the box, the echo,
 * the claim and the retry hint move) - so the run records those readings per
 * arm as JSON and fails if the screen does not show what the arm claims to have
 * reached. A frame with no alert and no explanation is evidence for nothing,
 * which is how the blank-frame class this rig guards against reaches a PR.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
/* The one thing this rig shares with `scripts/`: the switch that keeps its own
   Chrome out of the operator's keychain. A scratch `HOME` has no login keychain,
   and Chrome then asks the operator to authorize creating one. */
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ROOT = resolve(import.meta.dirname, "../../../..");
const HARNESS = import.meta.dirname;
const OUT = process.argv[2];
const TREE = (process.argv.find((a) => a.startsWith("--tree=")) ?? "--tree=after").split("=")[1];
/** `--only=<arm>` runs one arm, for the inner loop while this rig is being built. */
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "--only=").split("=")[1];
if (!OUT) {
	process.stderr.write("usage: capture.mjs <out-dir> [--tree=after|before]\n");
	process.exit(2);
}

const APP_PORT = Number(process.env.OWNER_REFUSAL_APP_PORT ?? 5197);
const OWNER_PORT = Number(process.env.OWNER_REFUSAL_OWNER_PORT ?? 8791);
const CDP_PORT = Number(process.env.OWNER_REFUSAL_CDP_PORT ?? 9333);
/* `localhost` rather than `127.0.0.1`: the dev server binds the name, which on
   this host is the IPv6 loopback, and a run that asked for the v4 literal waited
   out its own readiness window against a server that was already up. */
const ORIGIN = `http://localhost:${APP_PORT}`;
/* A realistic sentence, because the frames' geometry is part of what they
   record: the owner's two-line refusal is the longest prose this composer
   renders in these states, and a short stand-in would hide a cap. */
const MESSAGE =
	"Please re-run the failing case with the trace enabled and paste the last twenty lines here.";

/**
 * The arms, and what each one is for. `refusals` is the number of message
 * requests the owner refuses BEFORE it starts admitting, which is what makes an
 * arm show a refusal at all: `busy-exhausted` refuses four because the app
 * spends three of its own repeats (`BUSY_RESENDS`) before the composer is told.
 */
const ARMS = [
	{
		name: "retiring",
		refusals: 1,
		expectRefusal: true,
		// The change under evidence: a 409 `runtime_retiring` is raised before
		// admission, so the text belongs back in the box.
		why: "one refusal, then admission - the 409 the incident turned into a held draft",
	},
	{
		name: "busy-exhausted",
		refusals: 4,
		expectRefusal: true,
		why: "the 503 `runtime_busy` that survives the app's own three repeats",
	},
	{
		name: "busy-internal",
		refusals: 2,
		expectRefusal: false,
		why: "the same 503 answered by the app's own repeats, so the composer never sees it",
	},
	{
		name: "unreachable",
		refusals: Number.POSITIVE_INFINITY,
		expectRefusal: true,
		why: "the CONTROL: a hop failure whose ack may be the only thing lost stays held",
	},
];

/** Same minimal CDP client as `scripts/capture-evidence.mjs`. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}
}

/**
 * The DOM readings a frame can only illustrate.
 *
 * `alertProse` is the alert region's PARAGRAPHS rather than its whole text: the
 * pinned control row's labels sit in the same region, and "the app says a fact"
 * is a claim about a sentence. `visibleProse` is what is actually painted - the
 * region caps itself, so text taken from the DOM can name words the window never
 * shows - and `boxValue` is the finding that matters most here: the text the
 * composer is holding for the operator, which is empty on a held claim and
 * carries their message when the refusal handed it back.
 */
const PROBE = `(() => {
	const region = document.querySelector('[role="alert"]');
	const textarea = document.querySelector("textarea");
	const press = (el) => {
		if (!el) return;
		el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
		el.click();
	};
	window.__ownerRefusalPress = press;
	const paragraphs = region ? [...region.querySelectorAll("p")] : [];
	const clipBox = (node) => {
		let el = node.parentElement;
		while (el && el !== region) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return el;
			el = el.parentElement;
		}
		return region;
	};
	const visibleProse = () => {
		if (!region) return null;
		const regionBox = region.getBoundingClientRect();
		const parts = [];
		for (const paragraph of paragraphs) {
			const clip = clipBox(paragraph).getBoundingClientRect();
			const top = Math.max(regionBox.top, clip.top);
			const bottom = Math.min(regionBox.bottom, clip.bottom);
			const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
			let run = "";
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				const text = node.nodeValue || "";
				for (let i = 0; i < text.length; i++) {
					const range = document.createRange();
					range.setStart(node, i);
					range.setEnd(node, i + 1);
					const painted = [...range.getClientRects()].some(
						(r) => r.height > 0 && r.top >= top - 0.5 && r.bottom <= bottom + 0.5,
					);
					if (painted) run += text[i];
					else if (run.trim()) { parts.push(run.trim()); run = ""; }
				}
				if (run.trim()) { parts.push(run.trim()); run = ""; }
			}
		}
		return parts.join(" ").replace(/\\s+/g, " ").trim();
	};
	const controlLabels = region
		? [...region.querySelectorAll("button")].map((b) => (b.textContent || "").trim())
		: [];
	const scroller = document.querySelector("[data-lo-canonical-transcript]");
	const transcriptRows = scroller ? [...scroller.querySelectorAll("[data-record-id]")] : [];
	const hasKind = Boolean(scroller?.querySelector("[data-record-kind]"));
	return {
		regionPresent: !!region,
		alertProse: region
			? paragraphs.map((p) => p.textContent || "").join(" ").replace(/\\s+/g, " ").trim()
			: null,
		visibleProse: visibleProse(),
		controlLabels,
		boxValue: textarea ? textarea.value : null,
		textareas: [...document.querySelectorAll("textarea")].map((t) => t.getAttribute("aria-label")),
		/* The transcript's painted rows, and - where the page can name a row's
		   SPEAKER - how many of them are the operator's own. Two fields rather than
		   one because the marker the count needs is itself part of this branch: the
		   probe that preceded these matched '[data-role="user"],
		   [data-testid="user-row"]', none of which exists anywhere in 'src/', so it
		   read 0 over frames that plainly painted the echo - a dead instrument
		   standing under the one claim the transcript half of these frames makes
		   (agent review R-5, design D1).

		   'transcriptRows' spans BOTH halves ('data-record-id' is on every row of
		   the shipping transcript, including origin/main's), so it is the reading the
		   two halves can be compared on. 'transcriptUserRows' is the speaker-scoped
		   one, and it is 'null' ONLY where rows are painted on a page that carries no
		   'data-record-kind' (the origin/main half): "this page cannot name a
		   speaker" and "no user row is painted" are different facts, and the second
		   is the one the frames are about - a page with no rows at all answers 0,
		   which is exactly what a retracted echo leaves behind. */
		transcriptRows: transcriptRows.length,
		transcriptUserRows:
			transcriptRows.length === 0
				? 0
				: hasKind
					? transcriptRows.filter((row) => row.dataset.recordKind === "user").length
					: null,
		theme: document.documentElement.dataset.theme,
		/* What the page SAYS, for the failure a frame cannot explain on its own: a run
		   that reports "nothing mounted" is a question about a screen nobody saw. */
		bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
	};
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
const reap = () => {
	for (const child of children.splice(0)) killGroup(child);
};
const launch = (command, args, options = {}) => {
	const child = spawn(command, args, { detached: true, stdio: "ignore", ...options });
	children.push(child);
	return child;
};

/** Each abandoned profile is ~180MB that nothing else collects; a run killed by
 * a wrapper never reaches `reap`. */
const sweepStaleProfiles = () => {
	const mine = `lo-owner-refusal-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		if (!name.startsWith("lo-owner-refusal-") || name === mine) continue;
		try {
			process.kill(Number(name.slice("lo-owner-refusal-".length)), 0);
			continue;
		} catch {
			rmSync(join(tmpdir(), name), { recursive: true, force: true });
		}
	}
};

/**
 * Whether something is listening on a loopback port.
 *
 * A raw `net.connect` rather than `fetch`: a fetch to a CLOSED port on this Node
 * (26.5.0) throws `setTypeOfService EINVAL` out of undici rather than rejecting
 * with a connection error, which kills the run instead of answering the question.
 */
const portOpen = (host, port) =>
	new Promise((resolve) => {
		const socket = connect({ host, port });
		socket.setTimeout(400);
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
		socket.once("error", () => {
			socket.destroy();
			resolve(false);
		});
	});

/** Wait for a listener, and then for one HTTP answer, so a run cannot photograph a half-started server. */
const waitForHttp = async (url, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	// The host the URL itself names, not a loopback literal: the dev server binds
	// the NAME, which is the IPv6 loopback here, so a v4 probe never sees it.
	const { hostname, port } = new URL(url);
	for (;;) {
		if (await portOpen(hostname, Number(port))) {
			try {
				const response = await fetch(url);
				if (response.ok) return true;
			} catch {
				/* listening but not answering yet */
			}
		}
		if (Date.now() > deadline) return false;
		await sleep(300);
	}
};

/**
 * Kill one launched process and its group.
 *
 * Every launch here is `detached` precisely so this can kill the GROUP: the
 * children these processes spawn (Chrome's helpers, esbuild under vite) are not
 * ours to name by pid, and an abandoned one holds a port the next arm needs.
 */
const killGroup = (child) => {
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}
};

/** Wait for a port to be free again, so the next arm's owner is the one answering. */
const waitForPortFree = async (host, port, timeoutMs) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (!(await portOpen(host, port))) return true;
		if (Date.now() > deadline) return false;
		await sleep(200);
	}
};

/**
 * Wait until a send has settled into the shape THIS arm can end in.
 *
 * A refusal paints its sentence in the alert region; an arm that refuses nothing
 * empties the box and paints the message in the transcript. Anything else is
 * still in flight - a cold engage, or the app's own paced busy repeats - and
 * photographing that records a state neither half of the evidence is about. The
 * two shapes are polled SEPARATELY rather than as one "something happened": on
 * the created-session arm the box empties when the echo paints, milliseconds
 * BEFORE the refusal arrives, so a predicate that accepted either would stop at
 * the empty box and photograph a send still in flight (measured: it did, on the
 * arm whose owner is busy).
 *
 * The transcript is probed by its TEXT, with the sidebar excluded: what the frame
 * has to show is the operator's own words in the conversation, and a staged
 * draft's row title carries those same words on a surface that is not a send.
 * The transcript's markup is a component's business rather than this rig's.
 *
 * The owner's log is quoted in the timeout message, because the interesting
 * failure is a send that never settled for a reason only that log can name.
 */
const waitForSendSettled = async (evaluate, wirePath, arm, which, expects) => {
	const needle = MESSAGE.slice(0, 40);
	let state = null;
	for (let attempt = 0; attempt < 90; attempt++) {
		state = await evaluate(`(() => {
			const region = document.querySelector('[role="alert"]');
			const textarea = document.querySelector("textarea");
			const prose = region
				? [...region.querySelectorAll("p")].map((p) => p.textContent || "").join(" ")
				: "";
			let spoken = "";
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node.parentElement && node.parentElement.closest("nav")) continue;
				spoken += node.nodeValue || "";
			}
			return {
				alert: Boolean(prose.trim()),
				box: textarea ? textarea.value : null,
				onScreen: spoken.includes(${JSON.stringify(needle)}),
			};
		})()`);
		// THE SHAPE THIS SEND CAN END IN, never "either": see the note above. The two
		// call sites differ on purpose - the second send is always an admission, even
		// on an arm whose FIRST one is refused (that is the operator's remedy, and the
		// frame exists to show it lands).
		const settled =
			expects === "refusal"
				? state.alert
				: state.box === "" && state.onScreen;
		if (settled) {
			// One more commit: a refusal's retraction and the composer's restore of the
			// text are state updates that land after the alert's first paint.
			await sleep(700);
			return state;
		}
		await sleep(1000);
	}
	throw new Error(
		`${arm.name}: the ${which} send never settled - neither the owner's sentence nor the message in the transcript (last probe: ${JSON.stringify(state)}; owner log:\n${readFileSync(wirePath, "utf8")})`,
	);
};

const main = async () => {
	sweepStaleProfiles();
	mkdirSync(OUT, { recursive: true });

	/* The app's own browser dev server: the shipped renderer over the shipped
	   `/__desktop` transport. It holds no arm of its own - the arm lives in the
	   owner it proxies to - so it starts once and stays up for every arm. */
	launch(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "--config", join(HARNESS, "app.vite.mjs")], {
		cwd: ROOT,
		env: {
			...process.env,
			LOCAL_OPERATOR_DESKTOP_BACKEND_URL: `http://127.0.0.1:${OWNER_PORT}`,
			LOCAL_OPERATOR_DESKTOP_TOKEN: "owner-refusal-stub",
			OWNER_REFUSAL_APP_PORT: String(APP_PORT),
		},
	});
	if (!(await waitForHttp(`${ORIGIN}/`, 90_000))) throw new Error("the app dev server never came up");

	const dataDir = join(tmpdir(), `lo-owner-refusal-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	launch(
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--remote-debugging-port=${CDP_PORT}`,
			`--user-data-dir=${dataDir}`,
			"--no-first-run",
			"--no-default-browser-check",
			"about:blank",
		]),
	);

	const readings = { tree: TREE, message: MESSAGE, arms: [] };
	const wireLog = [];
	/* The owner's own log is the second half of the evidence: it records every
	   message request with its `request_id` and the answer it got, so "the repeat
	   carries the same identity" is a measurement rather than a reading of our own
	   code. Per-arm logs are written out of tree and collected into one file beside
	   the frames, so the evidence directory holds frames and readings and nothing
	   a run scribbles. */
	const wireDir = join(tmpdir(), `lo-owner-refusal-wire-${process.pid}`);
	mkdirSync(wireDir, { recursive: true });
	let owner = null;
	for (const arm of ARMS.filter((a) => !ONLY || a.name === ONLY)) {
		/* EACH ARM'S OWNER REPLACES THE LAST ONE'S, and the port is waited free
		   rather than assumed: a launch that fails to bind (EADDRINUSE, stdio
		   discarded) leaves the PREVIOUS arm's script answering, which is how a run
		   photographs the wrong owner's verdict while every assertion still passes. */
		killGroup(owner);
		if (owner && !(await waitForPortFree("127.0.0.1", OWNER_PORT, 10_000)))
			throw new Error(`the previous arm's owner still holds ${OWNER_PORT}`);
		const logPath = join(wireDir, `${arm.name}.log`);
		owner = launch(process.execPath, [join(HARNESS, "stub-owner.mjs")], {
			env: {
				...process.env,
				OWNER_REFUSAL_ARM: arm.name,
				OWNER_REFUSAL_PORT: String(OWNER_PORT),
				OWNER_REFUSAL_LOG: logPath,
			},
		});
		if (!(await waitForHttp(`http://127.0.0.1:${OWNER_PORT}/v1/capabilities`, 30_000)))
			throw new Error(`the scripted owner did not start for arm ${arm.name}`);

		// A fresh page per arm: the composer is per-conversation state, and one
		// arm's refusal must not seed the next one's box.
		let target = null;
		for (let attempt = 0; attempt < 120 && !target; attempt++) {
			// The PORT is asked first, with a socket rather than a fetch: a fetch to a
			// closed port on this Node throws `setTypeOfService EINVAL` from inside
			// undici's own socket handler, where a try/catch around the await cannot
			// reach it - measured, twice, as a crashed capture whose frames were half
			// written.
			if (await portOpen("127.0.0.1", CDP_PORT)) {
				try {
					const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
					target = list.find((t) => t.type === "page");
				} catch {
					/* chrome listening but not answering yet */
				}
			}
			if (!target) await sleep(250);
		}
		if (!target) throw new Error("no devtools page target");

		const ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => {
			ws.addEventListener("open", res, { once: true });
			ws.addEventListener("error", rej, { once: true });
		});
		const cdp = new Cdp(ws);
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1440,
			height: 900,
			deviceScaleFactor: 2,
			mobile: false,
		});
		const evaluate = async (expression) => {
			const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
			});
			if (exceptionDetails)
				throw new Error(exceptionDetails.exception?.description ?? "eval failed");
			return result.value;
		};
		const shoot = async (name) => {
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 100,
			});
			writeFileSync(join(OUT, `${arm.name}-${name}.webp`), Buffer.from(data, "base64"));
			process.stdout.write(`  captured ${arm.name}-${name}.webp\n`);
		};

		await cdp.send("Page.navigate", { url: `${ORIGIN}/` });
		// POLLED, not slept: the dev server transforms the app's modules on demand, so
		// a cold first load here is measured in tens of seconds (and once in ~2 min) -
		// a fixed settle is either a race or a wasted minute.
		//
		// AND THE COMPOSER IS BEHIND THE APP'S OWN DOOR. With no sessions on this
		// stub, the shell opens on its "Start a chat" empty state, where no textarea
		// exists at all: the composer belongs to a staged draft, so the New chat row
		// has to be pressed - the product's own control, not the store - before a box
		// exists to type into. Every pass through the loop tries it, so the click can
		// arrive before OR after the shell paints its sidebar.
		const composer = `document.querySelector('textarea[aria-label="Message"]')`;
		for (let attempt = 0; attempt < 240; attempt++) {
			if (await evaluate(`Boolean(${composer})`)) break;
			// If a first-run "New chat" control is what reveals the composer, that is
			// the product's own door and it is pressed through. Every loop pass, because
			// the shell paints its sidebar at its own pace and the row is not there yet
			// on the first pass - the earlier shape clicked once at a guessed attempt
			// and photographed the empty state when it guessed early.
			await evaluate(`(() => {
				const button = [...document.querySelectorAll("button, [role='button']")].find(
					(b) => (b.textContent || "").trim().replace(/[\\s\u00a0]+/g, " ") === "New chat");
				if (button) button.click();
				return Boolean(button);
			})()`);
			await sleep(1000);
		}
		if (!(await evaluate(`Boolean(${composer})`))) {
			// A frame of the state that failed, written out rather than discarded: the
			// first question about a rig that reports "nothing mounted" is what WAS on
			// the screen.
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 100,
			});
			writeFileSync(join(OUT, `${arm.name}-no-composer.webp`), Buffer.from(data, "base64"));
			throw new Error(
				`arm ${arm.name}: the composer never mounted, so this frame would photograph nothing (page: ${JSON.stringify(await evaluate(PROBE))})`,
			);
		}

		// React tracks the textarea's value on its own descriptor, so a plain
		// assignment is not seen: setting through the prototype setter and firing
		// a bubbling input event is how a real keystroke reaches the component.
		await evaluate(`(() => {
			const area = document.querySelector('textarea[aria-label="Message"]');
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(area, ${JSON.stringify(MESSAGE)});
			area.dispatchEvent(new Event("input", { bubbles: true }));
			return area.value.length;
		})()`);
		await sleep(1200);
		await shoot("composed");

		// The product's own send control, not its store.
		await evaluate(`(() => {
			const send = document.querySelector('button[aria-label="Send message"]');
			if (!send) throw new Error("no send control");
			send.click();
			return true;
		})()`);
		// POLLED as well, on the two shapes a send can settle into: a refusal's alert,
		// or the composer emptying under a painted echo. A fixed wait photographs
		// whichever of them the host happened to reach first.
		await waitForSendSettled(
			evaluate,
			logPath,
			arm,
			"first",
			arm.expectRefusal ? "refusal" : "sent",
		);
		const first = await evaluate(PROBE);
		await shoot("after-first-send");

		if (arm.expectRefusal) {
			if (!first.regionPresent || !(first.alertProse ?? "").trim())
				throw new Error(
					`arm ${arm.name}: the arm refuses the first send, but no alert region rendered its sentence (probe: ${JSON.stringify(first)})`,
				);
			// The second send, once the owner admits, is the operator's own remedy.
			await evaluate(`(() => {
				const send = document.querySelector('button[aria-label="Send message"]');
				if (send) send.click();
				return true;
			})()`);
			await waitForSendSettled(evaluate, logPath, arm, "second", "sent");
			await shoot("after-second-send");
		}

		const second = await evaluate(PROBE);
		readings.arms.push({ ...arm, first, second });
		wireLog.push(`${arm.name}:\n${readFileSync(logPath, "utf8").trim()}`);
		// The owner that answered these frames is done with before the next one
		// starts, so no arm can be served by another arm's script.
		killGroup(owner);
		owner = null;
		process.stdout.write(`arm ${arm.name}: ${arm.why}\n`);
	}

	writeFileSync(join(OUT, "readings.json"), `${JSON.stringify(readings, null, 1)}\n`);
	writeFileSync(join(OUT, "wire.log"), `${wireLog.join("\n")}\n`);
	process.stdout.write(`${JSON.stringify(readings.arms.map((a) => ({
		arm: a.name,
		firstAlert: (a.first.alertProse ?? "").slice(0, 130),
		firstBox: a.first.boxValue,
		secondBox: a.second.boxValue,
		secondAlert: a.second.regionPresent,
	})), null, 1)}\n`);
};

/** `--only` narrows the run for the inner loop while a rig is being built. */
process.on("exit", reap);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
main().then(
	() => {
		reap();
		rmSync(join(tmpdir(), `lo-owner-refusal-${process.pid}`), {
			recursive: true,
			force: true,
		});
		rmSync(join(tmpdir(), `lo-owner-refusal-wire-${process.pid}`), {
			recursive: true,
			force: true,
		});
	},
	(error) => {
		reap();
		process.stderr.write(`${error.stack ?? error}\n`);
		process.exit(1);
	},
);
