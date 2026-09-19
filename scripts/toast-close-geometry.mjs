#!/usr/bin/env node
/**
 * Measures — and asserts — where a toast's close button sits on its toast, from
 * the live DOM at a real viewport.
 *
 *     node scripts/toast-close-geometry.mjs [--out=<dir>] [--json]
 *                                           [--themes=a,b,c] [--only=<case>]
 *
 * Why this file exists. The operator reported the close (X) button on a toast
 * "hanging over the toast's top-LEFT corner, offset inward into the body",
 * against the `Marked 7 chats as read.` success toast. That is a claim about two
 * edges of one 20px box relative to a 356px one, and no still can settle it: a
 * small circle 8px inside the left edge and one straddling the right corner look
 * equally plausible in a screenshot, and the reader has no way to check the
 * paragraph describing them. A number is the instrument, and it has to come from
 * a real render, because the defect is a CSS cascade one — `unset` written on a
 * custom property, a `var()` inherited from sonner's own LTR rule, and two
 * insets both resolving to a length, which is the over-constrained case where
 * LTR drops `right` — and a unit test cannot resolve a `var()` at all.
 *
 * So this drives `scripts/toast-close-geometry.html` — the SHIPPED
 * `ThemedToastContainer`, holding the SHIPPED receipt copy for the operator's own
 * toast — over raw CDP against a private headless Chrome, the same approach as
 * `capture-evidence.mjs`, `chat-alignment-geometry.mjs` and
 * `composer-alert-geometry.mjs`: a fresh user-data-dir under /tmp, killed on
 * exit, and no browser-automation dependency added to the repo.
 *
 * What the rule is, and how it is measured. Sonner's own LTR placement pins the
 * circle's left edge to the toast's left edge (`left: 0`) and then translates it
 * 35% of its own width outward, so the circle STRADDLES the corner: 7px of its
 * 20px hangs outside the toast's edge and 7px of its height sits above its top.
 * The placement this app wants is that same straddle on the RIGHT — the mirror
 * image, which sonner already ships as its RTL transform against `right: 0`.
 * The numbers below are therefore read off the boxes rather than off the
 * declaration, and the expected outward offset is 6px rather than 7: the
 * button's absolutely positioned containing block is the toast's PADDING box and
 * the toast draws a 1px border, so a `right: 0` inset lands 1px inside the
 * border box and the 7px translate then puts the button's right edge 6px outside
 * it. The rig asserts that number on the toast's top-right corner, in both
 * shapes and three themes, and reports every measurement whether it passes or
 * not, because the numbers are what a reviewer reads.
 *
 * The bound of what this proves: it is geometry at one viewport, from a page
 * that mounts the toaster and a toast and nothing else. The surface UNDER the
 * toast is not painted here and is not part of the claim (the toast is fixed to
 * the viewport's bottom-right corner, and the frame carries its offset).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes("--json");
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = flag("out") ?? join(tmpdir(), "toast-close-geometry");
const PORT = Number(flag("port") ?? 5431);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ONLY = flag("only");

/**
 * The app's own default window, in CSS pixels: a toast is pinned to the
 * viewport's bottom-right corner, so the viewport is part of the claim (a button
 * that overflowed the viewport would be clipped by it, and the corner offset
 * that keeps it inside is one of the numbers below).
 */
const VIEWPORT = { width: 1380, height: 900 };

/**
 * The two bodies, and the three themes.
 *
 * `one-line` is the operator's own toast and `multi-line` is the same receipt
 * carrying its two remainder sentences, which is the case where the toast is
 * taller than its close button — the corner the button sits on does not move
 * when the box grows, and that is worth a number rather than an assumption.
 *
 * Dark first, then the other brand palette, then one ported theme: the defect
 * was a cascade one and the cascade is theme-independent, but a placement proved
 * in one palette is a placement proved about one palette's frame.
 */
const SHAPES = ["one-line", "multi-line"];
const THEMES = (
	flag("themes") ?? "localOperatorDark,localOperatorLight,dracula"
).split(",");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		/*
		 * Page-side console output and uncaught exceptions, kept for the failure
		 * message: a harness module that evaluates and then throws inside a React
		 * render leaves an empty document and no JS error in this process, so the
		 * only place that failure exists is the page's own console.
		 */
		this.log = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method === "Runtime.exceptionThrown") {
				this.log.push(
					msg.params.exceptionDetails.exception?.description ??
						msg.params.exceptionDetails.text,
				);
			} else if (msg.method === "Runtime.consoleAPICalled") {
				this.log.push(
					`${msg.params.type}: ${msg.params.args
						.map((a) => a.description ?? a.value ?? a.type)
						.join(" ")}`,
				);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

/**
 * The measurement, evaluated in the page.
 *
 * Read off the DOM rather than off any of the app's own abstractions, and read
 * from the RESOLVED side as well as the boxes: `left`/`right` and the two custom
 * properties they consume are what separate "the button is in the wrong place"
 * from "the button was declared to be in the wrong place", and the failing run
 * has to be diagnosable from its own output.
 *
 * No backticks below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
	};
	const toastEl = document.querySelector("[data-sonner-toast]");
	const button = document.querySelector("[data-close-button]");
	const toaster = document.querySelector("[data-sonner-toaster]");
	const title = document.querySelector("[data-title]");
	if (!toastEl || !button) {
		return { present: false, toast: !!toastEl, button: !!button };
	}
	const toast = rect(toastEl);
	const box = rect(button);
	const cs = getComputedStyle(button);
	const toastCs = getComputedStyle(toastEl);
	const px = (el, name) => round(Number.parseFloat(getComputedStyle(el)[name]) || 0);
	const centre = { x: round(box.left + box.width / 2), y: round(box.top + box.height / 2) };
	const corner = (x, y) => round(Math.hypot(centre.x - x, centre.y - y));
	const lineHeight = round(Number.parseFloat(getComputedStyle(title ?? toastEl).lineHeight) || 0);
	const textHeight = title ? round(title.getBoundingClientRect().height) : toast.height;
	return {
		present: true,
		viewport: { width: window.innerWidth, height: window.innerHeight },
		htmlDir: document.documentElement.getAttribute("dir"),
		toaster: toaster
			? { dir: toaster.getAttribute("dir"), theme: toaster.getAttribute("data-sonner-theme"), ...rect(toaster) }
			: null,
		toast: {
			...toast,
			borderTop: px(toastEl, "borderTopWidth"),
			borderRight: px(toastEl, "borderRightWidth"),
			backgroundColor: toastCs.backgroundColor,
		},
		button: { ...box, backgroundColor: cs.backgroundColor },
		buttonStyle: {
			position: cs.position,
			left: cs.left,
			right: cs.right,
			top: cs.top,
			transform: cs.transform,
		},
		resolved: {
			start: cs.getPropertyValue("--toast-close-button-start").trim(),
			end: cs.getPropertyValue("--toast-close-button-end").trim(),
			transform: cs.getPropertyValue("--toast-close-button-transform").trim(),
			onToastStart: toastCs.getPropertyValue("--toast-close-button-start").trim(),
			onToastEnd: toastCs.getPropertyValue("--toast-close-button-end").trim(),
			onToasterStart: toaster ? getComputedStyle(toaster).getPropertyValue("--toast-close-button-start").trim() : null,
		},
		deltas: {
			left: round(box.left - toast.left),
			right: round(box.right - toast.right),
			top: round(box.top - toast.top),
			bottom: round(box.bottom - toast.bottom),
		},
		centre,
		corner: { topLeft: corner(toast.left, toast.top), topRight: corner(toast.right, toast.top) },
		containment: {
			rightMargin: round(window.innerWidth - box.right),
			bottomMargin: round(window.innerHeight - box.bottom),
			fullyInside:
				box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
		},
		toastContainment: {
			rightMargin: round(window.innerWidth - toast.right),
			bottomMargin: round(window.innerHeight - toast.bottom),
			fullyInside:
				toast.left >= 0 && toast.right <= window.innerWidth && toast.bottom <= window.innerHeight,
		},
		lines: lineHeight > 0 ? Math.max(1, Math.round(textHeight / lineHeight)) : null,
		text: (title ? title.innerText : toastEl.innerText || "").replace(/\\s+/g, " ").trim(),
		mounted: toastEl.getAttribute("data-mounted"),
	};
})()`;

/**
 * The settle probe: the two boxes and the computed transform, sampled until two
 * consecutive reads agree.
 *
 * Sonner mounts a toast through a 400ms transform/opacity transition and animates
 * its height, so a measurement taken on the frame after `data-mounted` is a
 * measurement of a box still moving. Equality of two whole samples 120ms apart is
 * the condition, rather than a fixed wait, because the wait is what a slower
 * machine makes wrong.
 */
const SETTLE_PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const t = document.querySelector("[data-sonner-toast]");
	const b = document.querySelector("[data-close-button]");
	if (!t || !b) return null;
	const r = (el) => { const x = el.getBoundingClientRect(); return [round(x.left), round(x.top), round(x.width), round(x.height)].join(","); };
	return [t.getAttribute("data-mounted"), r(t), r(b), getComputedStyle(b).transform].join("|");
})()`;

const STRADDLE = 0.35 * 20;
const BORDER = 1;
const OUTSET = STRADDLE - BORDER;
const TOLERANCE = 1;

/** The transform matrix's translate components, from `matrix(a, b, c, d, tx, ty)`. */
const translateOf = (transform) => {
	const match = /matrix\(([^)]+)\)/.exec(transform ?? "");
	if (!match) return null;
	const parts = match[1].split(",").map((n) => Number.parseFloat(n));
	return { x: parts[4], y: parts[5] };
};

/**
 * The assertions, stated once so the report can name the rule each number
 * answers. `m` is one probe result, `label` names the case it came from.
 */
const assertions = (m, label) => {
	const failures = [];
	const fail = (message) => failures.push(`${label}: ${message}`);
	if (!m.present) {
		fail(
			`no toast with a close button rendered (toast=${m.toast}, button=${m.button})`,
		);
		return failures;
	}
	/*
	 * The defect itself, named as the cascade rather than as a distance.
	 *
	 * The two DECLARED insets are read from the custom properties the close button
	 * inherits, because the used values cannot answer this: an absolutely
	 * positioned box with `left: auto` reports its USED left offset from
	 * `getComputedStyle` (measured after the fix: `auto` declared, `334px`
	 * reported), so a check over the used values cannot tell "one inset governs"
	 * from "two do". What the browser will lay out is decided by the declared
	 * pair, and two lengths is the over-constrained case where LTR drops
	 * `right` — which is what put the button on the toast's LEFT edge.
	 */
	const declared = { left: m.resolved.start, right: m.resolved.end };
	const lengths = Object.entries(declared).filter(
		([, value]) => value !== "" && value !== "auto",
	);
	if (lengths.length !== 1)
		fail(
			`${lengths.length} horizontal insets are declared as lengths (--toast-close-button-start=${JSON.stringify(declared.left)}, --toast-close-button-end=${JSON.stringify(declared.right)}) with the used values left=${m.buttonStyle.left}, right=${m.buttonStyle.right}; exactly one may govern, and two is the over-constrained case where LTR drops \`right\``,
		);
	else if (lengths[0][0] !== "right")
		fail(
			`the one inset that governs is \`${lengths[0][0]}\` (${lengths[0][1]}); the button belongs on the toast's right`,
		);
	/*
	 * Under the failing arm the two assertions above already fail, and the numbers
	 * below are what say WHICH wrong placement it is: the same two edges measured
	 * against the side they are claimed for.
	 */
	if (Math.abs(m.deltas.right - OUTSET) > TOLERANCE)
		fail(
			`the button's right edge is ${m.deltas.right}px from the toast's right edge; the straddle sonner's own rule produces is ${OUTSET}px outside it (7px of a 20px box at 35%, less the toast's ${BORDER}px border)`,
		);
	if (Math.abs(m.deltas.top + OUTSET) > TOLERANCE)
		fail(
			`the button's top edge is ${m.deltas.top}px from the toast's top edge; the same rule puts it ${-OUTSET}px above it`,
		);
	if (m.corner.topRight >= m.corner.topLeft)
		fail(
			`the button's centre is ${m.corner.topLeft}px from the toast's top-left corner and ${m.corner.topRight}px from its top-right one, so it is not on the right`,
		);
	if (!m.containment.fullyInside)
		fail(
			`the button is not wholly inside the viewport (${JSON.stringify(m.containment)}); a 20px circle is not clipped by the toast, so an off-screen one is off-screen`,
		);
	if (!m.toastContainment.fullyInside)
		fail(
			`the toast itself is not wholly inside the viewport (${JSON.stringify(m.toastContainment)})`,
		);
	if (m.mounted !== "true") fail(`the toast reports data-mounted=${m.mounted}`);
	/*
	 * The transform has to agree with the side that governs: `right: 0` plus the
	 * RTL-flavoured outward translate is one placement, and a left inset with a
	 * rightward translate is the incoherent half of this defect. Pinned as the
	 * matrix the browser computed rather than as the string that was declared.
	 */
	const move = translateOf(m.buttonStyle.transform);
	if (!move)
		fail(
			`the button's computed transform is not a matrix: ${m.buttonStyle.transform}`,
		);
	else if (Math.abs(move.x - STRADDLE) > TOLERANCE)
		fail(
			`the computed transform moves the button ${move.x}px horizontally; the outward translate for a right inset is +${STRADDLE}px (${m.resolved.transform})`,
		);
	return failures;
};

let vite = null;
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (vite) {
		vite.kill("SIGKILL");
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		// Same race `chat-alignment-geometry.mjs` documents: SIGKILL returns before
		// the profile stops being written to, so a plain recursive remove can throw
		// ENOTEMPTY and turn a successful measurement into a failure.
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const startVite = async () => {
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(ROOT, "scripts/toast-close-geometry.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1, while the driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, TOAST_CLOSE_PORT: String(PORT) } },
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			const res = await fetch(`${ORIGIN}/toast-close-geometry.html`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("the harness page never came up");
};

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-toast-close-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
};

/** Both frames of one case: the surface, and a zoomed detail of the corner. */
const capture = async (cdp, label, detailOf) => {
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${label}.png`), Buffer.from(shot.data, "base64"));
	if (!detailOf) return;
	/*
	 * The detail frame exists because the claim is about a 20px circle: at the
	 * full viewport it is 1.4% of the frame, and a reviewer asked to see where it
	 * sits should not have to zoom a PNG to answer.
	 */
	const margin = 28;
	const clip = {
		x: Math.max(0, detailOf.left - margin),
		y: Math.max(0, detailOf.top - margin),
		width: detailOf.width + margin * 2,
		height: detailOf.height + margin * 2,
		scale: 3,
	};
	const zoom = await cdp.send("Page.captureScreenshot", {
		format: "png",
		clip,
	});
	writeFileSync(
		join(OUT, `${label}-detail.png`),
		Buffer.from(zoom.data, "base64"),
	);
};

const main = async () => {
	mkdirSync(OUT, { recursive: true });
	await startVite();
	const cdp = await startChrome();
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: VIEWPORT.width,
		height: VIEWPORT.height,
		deviceScaleFactor: 2,
		mobile: false,
	});

	const measurements = [];
	const problems = [];
	for (const theme of THEMES) {
		for (const shape of SHAPES) {
			const label = `${theme}-${shape}`;
			if (ONLY && !label.includes(ONLY)) continue;
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/toast-close-geometry.html?shape=${shape}&theme=${theme}`,
			});
			/*
			 * Ready is four conditions, not one: the font faces are loaded (the
			 * toast's height is a line count times a line-height, and a fallback face
			 * measures a different number), the close button exists (a toast with no
			 * button is not this defect), the toast has mounted, and the toaster has
			 * published the direction it resolved — which is the branch of sonner's
			 * stylesheet that declares the two custom properties under test.
			 */
			let ready = false;
			for (let i = 0; i < 240 && !ready; i++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						if (document.fonts.status !== "loaded") return false;
						const toast = document.querySelector("[data-sonner-toast]");
						if (!toast || toast.getAttribute("data-mounted") !== "true") return false;
						if (!document.querySelector("[data-close-button]")) return false;
						const toaster = document.querySelector("[data-sonner-toaster]");
						if (!toaster) return false;
						const dir = toaster.getAttribute("dir");
						return dir === "ltr" || dir === "rtl";
					})()`,
				});
				ready = result.value === true;
				if (!ready) await sleep(250);
			}
			if (!ready) {
				/*
				 * A page that failed to mount and one that mounted slowly are
				 * different failures and a bare timeout reports neither, so this
				 * carries what the document actually holds.
				 */
				const { result: diagnostic } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					awaitPromise: true,
					expression: `(async () => ({
						url: location.href,
						fonts: document.fonts.status,
						toast: !!document.querySelector("[data-sonner-toast]"),
						button: !!document.querySelector("[data-close-button]"),
						mounted: document.querySelector("[data-sonner-toast]")?.getAttribute("data-mounted") ?? null,
						toasterDir: document.querySelector("[data-sonner-toaster]")?.getAttribute("dir") ?? null,
						importError: await import("/toast-close-geometry.tsx").then(
							() => null,
							(e) => String(e && e.message ? e.message : e),
						),
					}))()`,
				});
				throw new Error(
					`${label}: never became measurable — ${JSON.stringify(diagnostic.value)}${cdp.log.length > 0 ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
				);
			}
			/*
			 * Then the boxes have to STOP MOVING: sonner's mount transition is 400ms
			 * of transform and opacity, and its height animates too, so this samples
			 * until two consecutive reads agree rather than waiting a fixed 500ms a
			 * slower machine would invalidate.
			 */
			let settled = false;
			let previous = null;
			for (let i = 0; i < 60 && !settled; i++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: SETTLE_PROBE,
				});
				settled = result.value !== null && result.value === previous;
				previous = result.value;
				if (!settled) await sleep(120);
			}
			if (!settled) throw new Error(`${label}: the toast never stopped moving`);

			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			if (!result.value) throw new Error(`${label}: no measurement returned`);
			const measurement = { theme, shape, ...result.value };
			measurements.push(measurement);
			await capture(cdp, label, measurement.toast);
			for (const problem of assertions(measurement, label))
				problems.push(problem);
		}
	}

	const report = {
		origin: ORIGIN,
		viewport: VIEWPORT,
		expectedOutset: OUTSET,
		out: OUT,
		measurements,
	};
	if (AS_JSON) console.log(JSON.stringify(report, null, 2));
	else {
		console.log(
			`\ntoast close-button geometry — ${VIEWPORT.width}x${VIEWPORT.height} CSS, detail frames at 3x\n`,
		);
		console.log(
			"case                       lines  toast(l,t,w,h)          button(l,t,w,h)        d(right,top)  corner(tl,tr)  in-viewport  start/end",
		);
		for (const m of measurements) {
			if (!m.present) {
				console.log(`${`${m.theme}-${m.shape}`.padEnd(26)}  no toast rendered`);
				continue;
			}
			console.log(
				[
					`${m.theme}-${m.shape}`.padEnd(26),
					String(m.lines).padStart(5),
					`${m.toast.left},${m.toast.top},${m.toast.width},${m.toast.height}`.padEnd(
						21,
					),
					`${m.button.left},${m.button.top},${m.button.width},${m.button.height}`.padEnd(
						22,
					),
					`${m.deltas.right},${m.deltas.top}`.padEnd(13),
					`${m.corner.topLeft},${m.corner.topRight}`.padEnd(14),
					String(m.containment.fullyInside).padEnd(11),
					`${m.resolved.start}/${m.resolved.end}`,
				].join("  "),
			);
		}
		console.log(`\nframes: ${OUT}`);
	}

	if (problems.length > 0) {
		console.error(`\n${problems.length} assertion(s) failed:`);
		for (const p of problems) console.error(`  - ${p}`);
		teardown();
		process.exit(1);
	}
	teardown();
	console.log("\nall assertions passed");
};

process.on("exit", teardown);
process.on("SIGINT", () => {
	teardown();
	process.exit(130);
});

await main();
