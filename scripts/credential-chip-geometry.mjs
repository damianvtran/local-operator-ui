#!/usr/bin/env node
/**
 * Measures the composer's credential chip against the marker run it covers.
 *
 *     node scripts/credential-chip-geometry.mjs [storybook-origin] [--json]
 *
 * THE CLAIM THIS EXISTS FOR is a claim about PIXELS, and the operator asked for
 * it in so many words: a chip that "must cover EXACTLY the marker run's box or it
 * will drift off the characters it sits under". A frame can show a chip in the
 * right place or the wrong one, but it cannot say by how much, and it cannot say
 * whether the chip's own CONTENT fits the box it was given — a box too narrow
 * clips its label silently, and a still of a clipped label looks exactly like a
 * still of a short one. So the numbers come from `getClientRects` in the same
 * rendered state the evidence frames are taken from, and this file is the command
 * that produces them: a reviewer re-runs it rather than trusting a table.
 *
 * WHAT IT REPORTS, per story and viewport, all in CSS pixels:
 *
 *  - `runs`   each painted run's box: the mirror's own spans (`[data-credential-run]`),
 *             which is the geometry the chip layer measures. `rects` is how many
 *             fragments the run reports — 1 means a chip is drawn, more means it
 *             WRAPS and keeps the wash (the documented fallback).
 *  - `chips`  each chip's box, from the chip layer's own children.
 *  - `fit`    `content` vs `box`: the chip's `scrollWidth` against its
 *             `clientWidth`, which is the difference between "the chip's words
 *             fit the run" and "the chip is clipping them". The chip is painted
 *             at the run's box by construction, so this is the only place the
 *             pair can be compared.
 *  - `deltas` run box against chip box: `left`, `top`, `width`, `height`. All
 *             four are zero when the chip covers the run exactly.
 *
 * Raw CDP against a private headless Chrome, the same approach as
 * `chat-alignment-geometry.mjs` and `capture-evidence.mjs` (fresh user-data-dir
 * under /tmp, the mock-keychain switch `./chrome-keychain.mjs` owns so no prompt can reach the
 * operator's screen, killed on exit, no browser-automation dependency added to
 * the repo). Duplicating that driver rather than importing it is the smaller
 * evil for the reason the alignment rig states: the sweep's loop writes one webp
 * per theme per story, and threading a "measure instead of shoot" mode through it
 * would complicate the one script in this repo that must stay boring.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6018";
const AS_JSON = ARGS.includes("--json");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The two rungs the chip is painted at, with the viewports the evidence frames
 * use, so a number here and a frame there describe one layout rather than two.
 *
 * The views are ALSO as different as the rung gets: `pill-mid-prose` is a
 * reference in the middle of a sentence (a chip with text on both sides, which is
 * where an over-wide chip would cover its neighbour), `pill-at-line-start` puts
 * the marker at offset 0, and `pill-small-view` is the same mint at the compact
 * type step and padding, where the run box is narrower.
 */
const STORIES = [
	["chat-message-input--credential-pill-mid-prose", 1024, 300],
	["chat-message-input--credential-pill-at-line-start", 1024, 300],
	["chat-message-input--credential-pill-unbacked", 1024, 300],
	["chat-message-input--credential-pill-small-view", 440, 300],
	/*
	 * THE SCROLLED RUNG (UX round 1, U1 - the round's BLOCKER). Every row above
	 * measures a field at `scrollTop 0`, which is exactly why the shipped rig read
	 * `0,0,0,0` on all four while the chip was `fieldScrollTop` px off its run in
	 * any composer long enough to scroll: the measurement added the mirror's own
	 * scroll to a rect that is already viewport-relative. This story mints the
	 * reference at the END of a fifteen-line buffer and scrolls its own field in
	 * its play function, so the row measures a scrolled composer - and the sweep
	 * below adds a middle and an end position on top of whatever the story left.
	 */
	["chat-message-input--credential-pill-scrolled", 1024, 300],
];

/*
 * The floor a drawn chip has to clear to count as IDENTIFIABLE, mirroring
 * `CHIP_MIN_VISIBLE_STRIP_PX` in `credential-chip-layer.tsx` (the boundary sweep carries the
 * measurements behind it). Repeated rather than imported on purpose: the rig has to be able
 * to name, in the failure it prints, the number it measured against.
 */
const CHIP_MIN_VISIBLE_STRIP_PX = 6;

/*
 * PARKING, AND THE ONE RULE EVERY PARK IN THIS FILE FOLLOWS.
 *
 * A park sets the field's `scrollTop` so a phase measures the state it names, and it has to
 * move the caret to the start first: a focused textarea whose caret sits at the end re-scrolls
 * itself back to that caret on the next layout, so the park is silently undone and the phase
 * reads the resting state instead. Measured in round 6, in three places at once - the boundary
 * sweep reported `chips drawn at 0` across all nine of its offsets, the `run out of view` phase
 * saw a chip that was correctly in view, and the scrolled story's round-3 step never reached
 * its own state. One statement and one short comment at each site; this is the note they share.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		// Retried: `SIGKILL` returns before the kernel reaps the process and
		// Chrome's profile keeps being written for a few milliseconds after it,
		// which turns a successful measurement into an ENOTEMPTY out of the
		// `finally` — a complete run that reads as a failed one.
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

/**
 * The measurement, evaluated in the page.
 *
 * A string handed to `Runtime.evaluate` rather than a function serialised
 * across, so what runs in the browser is exactly what is read here. No backticks
 * below: the whole thing is a template literal.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 100) / 100;
	const box = (el) => {
		const r = el.getBoundingClientRect();
		return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height) };
	};
	const layer = document.querySelector("[data-credential-chips]");
	const mirror = [...document.querySelectorAll("div[aria-hidden='true']")]
		.find((el) => el.classList.contains("-z-10"));
	if (!mirror) return { error: "no mirror" };
	const runs = [...mirror.querySelectorAll("[data-credential-run]")].map((span) => ({
		planIndex: Number(span.dataset.credentialRun),
		text: span.textContent,
		rects: [...span.getClientRects()].map((r) => ({ width: round(r.width), height: round(r.height) })),
		box: box(span),
	}));
	const chips = layer
		? [...layer.children].map((el) => {
				/*
				 * THE FACE AGAINST THE BOX (design review round 8, D21). The clipped reading
				 * compares scrollWidth with clientWidth, which cannot see a face WIDER than the box:
				 * the ordinal is the only shrinkable item (the count and the control are shrink-0), so
				 * a too-narrow box truncates the reference's name and the reading still comes out
				 * healthy. This measures the face's own natural width - children plus padding, on a
				 * clone with the layer's inline geometry stripped, because the live element reports
				 * the box it was given - and the caller fails when it exceeds the box.
				 */
				const clone = el.cloneNode(true);
				clone.style.width = "auto";
				clone.style.left = "auto";
				clone.style.top = "auto";
				clone.style.position = "static";
				el.parentElement.appendChild(clone);
				const face = round(clone.getBoundingClientRect().width);
				clone.remove();
				const chipBox = box(el);
				return {
					label: el.textContent,
					box: chipBox,
					content: el.scrollWidth,
					client: el.clientWidth,
					clipped: el.scrollWidth > el.clientWidth,
					face,
					headroom: round(chipBox.width - face),
				};
			})
		: [];
	const deltas = chips.map((chip, i) => {
		const run = runs[i];
		if (!run) return null;
		return {
			left: round(chip.box.left - run.box.left),
			top: round(chip.box.top - run.box.top),
			width: round(chip.box.width - run.box.width),
			height: round(chip.box.height - run.box.height),
		};
	});
	const field = document.querySelector("textarea");
	return {
		value: field ? field.value : null,
		runs,
		chips,
		deltas,
		wrapped: runs.filter((run) => run.rects.length !== 1).length,
		/*
		 * BOTH SCROLL OFFSETS, because round 2's blocker is a difference between them
		 * (UX round 2, U6): the chip layer used to be a scroll container of its own, so
		 * focusing its control scrolled THAT instead of the field, and the chip moved
		 * while its marker did not. layerScrollTop must stay 0 - overflow-clip is what
		 * makes that structural rather than a coincidence - and fieldScrollTop is the
		 * position the run and the chip are both measured against.
		 */
		layerScrollTop: layer ? layer.scrollTop : null,
		layerScrollHeight: layer ? layer.scrollHeight : null,
		layerClientHeight: layer ? layer.clientHeight : null,
		fieldScrollTop: field ? field.scrollTop : null,
	};
})()`;

const main = async () => {
	dataDir = join(tmpdir(), `lo-chip-geometry-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
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

	const results = [];
	for (const [story, width, height] of STORIES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:localOperatorDark`,
		});
		/*
		 * Wait for the story to be MEASURABLE, which is three conditions and not
		 * one: Storybook's own loader has to be gone, the fonts have to have
		 * resolved (a chip measured against the fallback face is a number about
		 * this machine), and the story's own play function has to have finished —
		 * the credential stories type their state and hold the shutter until they
		 * do, so a measurement taken while `capturePending` is set is a
		 * measurement of a half-typed composer. Polled rather than slept on, for
		 * the reason the alignment rig gives: a delay long enough for a cold start
		 * is paid by every story, and one short enough to be cheap is the one that
		 * reports "no chip" for a story that renders one.
		 */
		let ready = false;
		for (let i = 0; i < 160 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.documentElement.dataset.capturePending) return false;
					if (document.fonts.status !== "loaded") return false;
					return !!document.querySelector("[data-credential-chips]")
						|| !!document.querySelector("[data-credential-run]");
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) {
			throw new Error(
				`${story} @ ${width}x${height}: neither a run nor a chip ever rendered`,
			);
		}
		/* One settled frame after layout, so the rects are post-reflow. */
		const settle = async () => {
			await cdp.send("Runtime.evaluate", {
				awaitPromise: true,
				expression:
					"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
			});
		};
		await settle();
		const probe = async () => {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			if (result.value?.error) {
				throw new Error(`${story} @ ${width}x${height}: ${result.value.error}`);
			}
			return result.value;
		};
		const phases = [{ phase: "as painted", ...(await probe()) }];

		/*
		 * THE SCROLL SWEEP (U1). The field is scrolled THROUGH ITS OWN PROPERTY, and
		 * the `scroll` event is dispatched as well: the layer subscribes to the field,
		 * and a rig that moved the offset without the event would measure a chip that
		 * had not been told - which is the state the subscription exists for. Two
		 * positions, because one is a point and the shape of the defect was
		 * `deltaTop === fieldScrollTop` at every offset.
		 */
		const scrollTo = async (fraction) => {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				awaitPromise: true,
				expression: `(async () => {
					const f = document.querySelector("textarea");
					if (!f) return { scrollable: false };
					const max = f.scrollHeight - f.clientHeight;
					if (max <= 1) return { scrollable: false };
						// The caret must leave the end first, or the browser scrolls back: see PARKING.
						f.setSelectionRange(0, 0);
					f.scrollTop = Math.round(max * ${fraction});
					f.dispatchEvent(new Event("scroll"));
					await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
					return { scrollable: true, scrollTop: f.scrollTop };
				})()`,
			});
			return result.value;
		};
		for (const [label, fraction] of [
			["scrolled to its middle", 0.5],
			["scrolled to its end", 1],
		]) {
			const moved = await scrollTo(fraction);
			if (!moved?.scrollable) {
				phases.push({
					phase: label,
					skipped: "the field does not scroll in this story",
				});
				continue;
			}
			const scrolled = await probe();
			/*
			 * ASSERTED, NOT PRINTED (code review round 2, R2-3). The story asserts the
			 * same pair, so the blocker's claim was never unguarded - but this rig is the
			 * artifact whose numbers the manifest QUOTES ("0,0,0,0 at `scrollTop` 113 and
			 * 225"), and a phase that printed a 60px drift and exited 0 read as a pass to
			 * every pipeline that looks at the exit code only. Same one-condition check
			 * the resize phase already makes.
			 */
			const drift = scrolled.deltas.filter(
				(delta) =>
					delta && (Math.abs(delta.left) > 0.5 || Math.abs(delta.top) > 0.5),
			);
			if (drift.length > 0) {
				throw new Error(
					`${story} @ ${width}x${height}: the chip does not follow the field's own scroll (${label}, scrollTop ${moved.scrollTop}) - ${JSON.stringify({ drift, deltas: scrolled.deltas })}`,
				);
			}
			phases.push({
				phase: `${label} (scrollTop ${moved.scrollTop})`,
				...scrolled,
			});
		}

		/*
		 * THE FOCUS CASE (UX round 2, U6, a BLOCKER), which no scroll phase can see: a
		 * `Tab` from the field moves focus to the chip's own control, and until this
		 * change the layer was a scroll container, so the browser scrolled IT instead
		 * of the field - the chip painted 219px from its marker, over unrelated prose,
		 * with a live `x` and a focus ring on it (measured by the reviewer; pressing
		 * Enter there destroyed a credential the operator could not see).
		 *
		 * The keystroke is a REAL one through `Input.dispatchKeyEvent`, because the
		 * whole defect is the browser's own focus scrolling: a scripted `focus()` call
		 * does not reproduce it. The assertion is the three numbers the reviewer
		 * measured - the layer's own `scrollTop` stays 0, the field's does not move, and
		 * the chip still sits on its run.
		 */
		const beforeFocus = await probe();
		/*
		 * THE FIELD IS FOCUSED FIRST, because the claim under test is "one real Tab FROM
		 * THE FIELD lands on the control" (the reviewer's own measurement). Without it
		 * the Tab starts wherever the page happens to be and the phase measures the
		 * document's tab order instead of the composer's.
		 */
		await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: "document.querySelector('textarea')?.focus()",
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
			nativeVirtualKeyCode: 9,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
			nativeVirtualKeyCode: 9,
		});
		await settle();
		const focused = await probe();
		/*
		 * AND THAT THE TAB ACTUALLY REACHED THE CONTROL, which is what makes this phase
		 * discriminating rather than decorative: a Tab that moved focus somewhere else
		 * would leave every delta at zero and read as a pass. The reviewer's own
		 * measurement carries the same field (`focus: "Remove credential #1"`).
		 */
		const landed = (
			await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression:
					"document.activeElement?.getAttribute?.('aria-label') ?? document.activeElement?.tagName ?? null",
			})
		).result.value;
		const hasControl = (
			await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression:
					"!!document.querySelector('[data-credential-chips] button[aria-label^=\"Remove credential\"]')",
			})
		).result.value;
		if (typeof landed !== "string" || !landed.startsWith("Remove credential")) {
			/*
			 * A CHIP WITH NO CONTROL IS NOT A FAILURE, it is a different state: an
			 * unbacked reference has no value to throw away, so it draws no `x` (this
			 * component's own rule), and a Tab from the field then lands on the
			 * composer's next control. Skipped with that reason rather than asserted,
			 * and skipped only when the page really holds no control - otherwise a
			 * control that focus cannot reach would read as a pass.
			 */
			if (!hasControl) {
				phases.push({
					phase: "Tab to the control",
					skipped: `the chip draws no control, so a Tab lands on ${JSON.stringify(landed)}`,
				});
			} else {
				throw new Error(
					`${story} @ ${width}x${height}: the Tab did not land on the chip's control - focus is on ${JSON.stringify(landed)}, so this phase would prove nothing`,
				);
			}
		} else {
			const focusDrift = focused.deltas.filter(
				(delta) =>
					delta && (Math.abs(delta.left) > 0.5 || Math.abs(delta.top) > 0.5),
			);
			if (
				focused.layerScrollTop !== 0 ||
				focused.fieldScrollTop !== beforeFocus.fieldScrollTop ||
				focusDrift.length > 0
			) {
				throw new Error(
					`${story} @ ${width}x${height}: a Tab to the chip's control moved the layer rather than the field - ${JSON.stringify(
						{
							layerScrollTop: focused.layerScrollTop,
							layerScrollHeight: focused.layerScrollHeight,
							layerClientHeight: focused.layerClientHeight,
							fieldScrollTop: [
								beforeFocus.fieldScrollTop,
								focused.fieldScrollTop,
							],
							focusDrift,
						},
					)}`,
				);
			}
			phases.push({
				phase: `Tab to the control (focus ${landed})`,
				...focused,
			});
		}

		/*
		 * AND THE SAME KEYSTROKE IN THE STATE THAT DISCRIMINATES (code review round 3,
		 * R3-2). Every phase above parks the field where the chip is IN VIEW, and that is
		 * exactly the state in which the round-2 defect cannot reproduce: with nothing for
		 * the browser to scroll INTO view, `layer.scrollTop` stays 0 even when the layer
		 * is the scroll container it used to be - the reviewer restored the pre-fix class
		 * in a scratch tree and this rig still exited 0. The defect lives in the state the
		 * round-2 reviewer measured: the field parked at its TOP, the marker's run 300px
		 * below a 112px box, so the browser has somewhere to scroll a focused control to.
		 *
		 * WHAT IS ASSERTED HERE, in that state: the layer holds NO chip at all (round 3,
		 * R3-1 - a run the layer clips away draws nothing, so its control is not reachable
		 * by any route), a real Tab from the field does not land on a chip control, and
		 * the layer's own offset stays 0. Both halves of the round-3 fix fail this phase
		 * if they regress: with the clip rule reverted a control is focusable and
		 * unpainted, and with `clip` reverted focus scrolls the layer.
		 */
		const parked = await scrollTo(0);
		if (!parked?.scrollable) {
			phases.push({
				phase: "Tab with the run out of view",
				skipped: "the field does not scroll in this story",
			});
		} else {
			const beforeTab = await probe();
			await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: "document.querySelector('textarea')?.focus()",
			});
			for (const type of ["rawKeyDown", "keyUp"]) {
				await cdp.send("Input.dispatchKeyEvent", {
					type,
					key: "Tab",
					code: "Tab",
					windowsVirtualKeyCode: 9,
					nativeVirtualKeyCode: 9,
				});
			}
			await settle();
			const afterTab = await probe();
			const offScreen = (
				await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: `(() => {
						const layer = document.querySelector("[data-credential-chips]");
						return {
							focused: document.activeElement?.getAttribute?.("aria-label") ?? document.activeElement?.tagName ?? null,
							layerChips: layer ? layer.children.length : 0,
							controls: document.querySelectorAll('[data-credential-chips] button').length,
						};
					})()`,
				})
			).result.value;
			if (
				(afterTab.layerScrollTop ?? 0) !== 0 ||
				(afterTab.layerScrollTop ?? 0) !== (beforeTab.layerScrollTop ?? 0) ||
				offScreen.layerChips !== 0 ||
				offScreen.controls !== 0 ||
				(typeof offScreen.focused === "string" &&
					offScreen.focused.startsWith("Remove credential"))
			) {
				throw new Error(
					`${story} @ ${width}x${height}: a run the layer clips away must offer no control (round 3, R3-1/R3-2) - ${JSON.stringify({ before: beforeTab.layerScrollTop, after: afterTab.layerScrollTop, ...offScreen })}`,
				);
			}
			phases.push({
				phase: `run out of view, Tab (focus ${offScreen.focused}, chips ${offScreen.layerChips})`,
				...afterTab,
			});
		}

		/*
		 * AND THE PARTIALLY VISIBLE RUN, which is where the CLIP itself is load-bearing
		 * (code review round 3, R3-2). The phases above park the field where the chip is
		 * either wholly in view (nothing for the browser to scroll into view) or wholly
		 * out of it (no chip at all, so no control to focus) - and in BOTH states a
		 * restored `overflow-hidden` is invisible to this rig. The state where it is not:
		 * the run straddling the layer's edge, so a chip IS drawn, its control IS
		 * focusable, and the layer's own content overflows its box. Focusing the control
		 * then asks the browser to scroll-into-view the nearest scroll container, which is
		 * either the field (`clip`) or the layer itself (`hidden`, which moves the chip off
		 * its run - the round-2 defect, re-entered through a door the chip's absence does
		 * not close).
		 */
		const straddle = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			awaitPromise: true,
			expression: `(async () => {
				const f = document.querySelector("textarea");
				const span = document.querySelector("[data-credential-run]");
				if (!f || !span) return { ok: false, why: "no field or no run" };
				const max = f.scrollHeight - f.clientHeight;
				if (max <= 1) return { ok: false, why: "the field does not scroll" };
				// Park the run's own top just inside the box's bottom edge: the chip exists,
				// and the layer has content outside its box for a focus to scroll to.
				const target = Math.max(0, Math.min(max, span.offsetTop - f.clientHeight + 8));
						// The caret must leave the end first, or the browser scrolls back: see PARKING.
						f.setSelectionRange(0, 0);
				f.scrollTop = Math.round(target);
				f.dispatchEvent(new Event("scroll"));
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				return { ok: true, scrollTop: f.scrollTop };
			})()`,
		});
		const parkedHalf = straddle.result.value;
		if (!parkedHalf?.ok) {
			phases.push({
				phase: "Tab with the run half in view",
				skipped: parkedHalf?.why ?? "no answer",
			});
		} else {
			const beforeHalf = await probe();
			if (beforeHalf.chips.length === 0) {
				throw new Error(
					`${story} @ ${width}x${height}: the run straddles the layer's edge and no chip was drawn, so this phase would prove nothing about the clip - ${JSON.stringify({ scrollTop: parkedHalf.scrollTop })}`,
				);
			}
			await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: "document.querySelector('textarea')?.focus()",
			});
			for (const type of ["rawKeyDown", "keyUp"]) {
				await cdp.send("Input.dispatchKeyEvent", {
					type,
					key: "Tab",
					code: "Tab",
					windowsVirtualKeyCode: 9,
					nativeVirtualKeyCode: 9,
				});
			}
			await settle();
			const afterHalf = await probe();
			const halfDrift = afterHalf.deltas.filter(
				(delta) =>
					delta && (Math.abs(delta.left) > 0.5 || Math.abs(delta.top) > 0.5),
			);
			if ((afterHalf.layerScrollTop ?? 0) !== 0 || halfDrift.length > 0) {
				throw new Error(
					`${story} @ ${width}x${height}: focusing a control whose chip is half in view moved the layer rather than the field - ${JSON.stringify({ layerScrollTop: afterHalf.layerScrollTop, drift: halfDrift, scrollTop: parkedHalf.scrollTop })}`,
				);
			}
			phases.push({
				phase: `run half in view, Tab (scrollTop ${parkedHalf.scrollTop}, chips ${afterHalf.chips.length})`,
				...afterHalf,
			});
		}

		/*
		 * THE BOUNDARY SWEEP (code review round 4, R4-1). The clip rule stopped the chip from
		 * moving and (round 3) removed it when its run left the box; the reviewer then found
		 * the seam between those two rules: the CONTROL is not co-extensive with the run's box
		 * - it sits half a pixel below the chip's top - so a run whose visible strip was
		 * anywhere in `(0, 0.5]px` kept a chip whose control was wholly outside the clip
		 * (`chips 1`, `0/64` hit-testable points, a real Tab landing on it, five characters
		 * swallowed, `Enter` clearing an unseen credential at `scrollTop 200`).
		 *
		 * This phase walks integer scroll positions across that transition and asserts the
		 * invariant the rule now establishes, per position: a chip is either ABSENT or its
		 * control owns at least one hit-testable point of its own rectangle. Both halves are
		 * live assertions, each proven by a mutant in the round-6 reply (a layer floor of `0`
		 * fails the hit-testing half, `3` fails the strip half), and the sweep is what makes
		 * them a boundary rather than a state. A layer that never drew a chip at all fails the
		 * RUN, not this phase - through the story's own play (`no chip is painted over the
		 * run`) or `PROBE`'s readiness wait - which is the correction round 7's NIT asked for.
		 */
		const boundary = await probe();
		if (boundary.runs.length > 0) {
			const seen = [];
			let skipped = null;
			/*
			 * THE RANGE CROSSES THE FLOOR (code review round 6, R6-2). The visible strip is the
			 * offset itself (the run's top lands on the box's bottom edge plus 'offset'), so the
			 * first version's '-6..+2' walked strips of 0 to 2 pixels against a 6px floor: no
			 * chip could be drawn at any position, and BOTH assertions this phase carries - the
			 * round-4 hit-testing one and the round-5 strip one - were gated on a chip the range
			 * could not produce. '-6..+10' puts the drawn/absent transition inside the walk.
			 */
			for (let offset = -6; offset <= 10; offset += 1) {
				const parkedAt = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					awaitPromise: true,
					expression: `(async () => {
						const f = document.querySelector("textarea");
						if (!f) return { ok: false, why: "no field" };
						const max = f.scrollHeight - f.clientHeight;
						if (max <= 1) return { ok: false, why: "the field does not scroll" };
						const run = document.querySelector("[data-credential-run]");
						if (!run) return { ok: false, why: "no run" };
						/*
						 * THE CARET LEAVES THE END FIRST, OR NOTHING BELOW MEASURES WHAT IT NAMES
						 * (found while landing R5-1's test, and it had made this sweep inert): a
						 * focused textarea whose caret sits at the end re-scrolls itself back to
						 * the caret, so every parked position collapsed onto the field's maximum
						 * and the nine positions under test were one position measured nine
						 * times. Setting the selection keeps the field focused (which the Tab below
						 * needs) and puts the caret where it cannot fight the scroll.
						 */
						f.setSelectionRange(0, 0);
						/*
						 * The run's offset is derived from VIEWPORT rects rather than from
						 * offsetTop, because the mirror's offsetParent is not the field: the
						 * span's own offset is its offset inside the mirror, which is already
						 * scrolled, so parking on it put the field at its top and every position
						 * in this sweep measured the same state (found in round 5, where the
						 * sweep read "chips drawn at 0" at all nine offsets).
						 */
						const runTopInContent =
							run.getBoundingClientRect().top - f.getBoundingClientRect().top + f.scrollTop;
						f.scrollTop = Math.max(0, Math.min(max, Math.round(runTopInContent - f.clientHeight + ${offset})));
						f.dispatchEvent(new Event("scroll"));
						await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
						const layer = document.querySelector("[data-credential-chips]");
						const control = layer?.querySelector("button") ?? null;
						/*
						 * THE STRIP THE OPERATOR CAN SEE (UX round 5, U2): the chip's own box
						 * intersected with the layer's clip box. The round-4 floor guaranteed a
						 * hit-testable control; at two pixels it did not guarantee an
						 * IDENTIFIABLE one - the UX round landed on a 2.38px strip with the
						 * control 1.88px of its 16 inside the clip, no times glyph on screen, and a
						 * real press in that band clearing the credential. The floor is now the strip
						 * at which the glyph appears, and this is the measurement that holds it.
						 */
						/*
						 * The face's own width, per chip, on a clone with the layer's inline geometry
						 * stripped: see the D21 comment in PROBE for why the live element cannot be
						 * read for this.
						 */
						const faceOf = (el) => {
							const clone = el.cloneNode(true);
							clone.style.width = "auto";
							clone.style.left = "auto";
							clone.style.top = "auto";
							clone.style.position = "static";
							el.parentElement.appendChild(clone);
							const width = clone.getBoundingClientRect().width;
							clone.remove();
							return Number(width.toFixed(2));
						};
						const CHIPS = layer
							? [...layer.children].map((el) => {
									const b = el.getBoundingClientRect();
									const face = faceOf(el);
									return {
										label: el.textContent,
										boxWidth: Number(b.width.toFixed(2)),
										face,
										headroom: Number((b.width - face).toFixed(2)),
									};
								})
							: [];
						let strip = 0;
						if (layer && layer.firstElementChild) {
							const chip = layer.firstElementChild.getBoundingClientRect();
							const clip = layer.getBoundingClientRect();
							strip = Math.max(
								0,
								Math.min(chip.bottom, clip.bottom) - Math.max(chip.top, clip.top),
							);
						}
						let hits = 0;
						let samples = 0;
						if (control) {
							const r = control.getBoundingClientRect();
							for (let x = r.left + 0.5; x < r.right; x += Math.max(1, r.width / 8)) {
								for (let y = r.top + 0.5; y < r.bottom; y += Math.max(1, r.height / 8)) {
									samples++;
									const hit = document.elementFromPoint(x, y);
									if (hit && (hit === control || control.contains(hit))) hits++;
								}
							}
						}
						return { ok: true, scrollTop: f.scrollTop, chips: layer ? layer.children.length : 0, hasControl: control !== null, hits, samples, strip: Number(strip.toFixed(2)), chipsDetail: CHIPS };
					})()`,
				});
				const at = parkedAt.result.value;
				if (!at?.ok) {
					skipped = at?.why ?? "no answer";
					break;
				}
				seen.push(at);
				if (at.chips > 0 && at.hits === 0) {
					throw new Error(
						`${story} @ ${width}x${height}: a chip whose control cannot be hit is drawn (round 4, R4-1) - ${JSON.stringify(at)}`,
					);
				}
				/*
				 * AND A CHIP THE OPERATOR CANNOT READ IS NOT A CHIP THEY CAN USE (UX round 5,
				 * U2): a drawn chip whose visible strip is under the floor is reachable, live and
				 * identifiable by nothing on screen - the band the UX round pressed into.
				 */
				/*
				 * THE FACE HAS TO FIT THE BOX IT COVERS (design review round 8, D21). The chip is
				 * painted over the marker's run, so it takes the run's width; the face may be
				 * narrower (the slack is what D19 distributes) but never wider. Measured on this
				 * head: 14.05px of headroom at 1024 (face 143.28 against a 157.33 box) and
				 * **9.14px at 440** (138.53 against 147.67) - twenty pixels less than the chip
				 * this comment first quoted, because D19's `px-1 -> px-3` and `gap-1 -> gap-1.5`
				 * spend exactly that on padding and rhythm. The compact rung is therefore the
				 * one with the least room, which is why the assertion below runs on EVERY phase
				 * that draws a chip rather than inside the boundary sweep alone (code review
				 * round 9, R9-2): the sweep is skipped wherever the field does not scroll, and
				 * only one story scrolls. A mutant that widens the face by 10px
				 * (`gap-1.5 px-3` -> `gap-1.5 px-[17px]`) truncates the 440 ordinal and fails
				 * here, which is the state the `content == client` reading cannot see.
				 */
				for (const chip of at.chipsDetail ?? []) {
					if (chip.face > chip.boxWidth) {
						throw new Error(
							`${story} @ ${width}x${height}: the chip's face (${chip.face}px) is wider than the box it covers (${chip.boxWidth}px), so the reference's ordinal is truncated (design round 8, D21) - ${JSON.stringify(chip)}`,
						);
					}
				}
				if (at.chips > 0 && at.strip < CHIP_MIN_VISIBLE_STRIP_PX) {
					throw new Error(
						`${story} @ ${width}x${height}: a chip is drawn on a strip too thin to identify it (UX round 5, U2) - ${JSON.stringify(at)} (floor ${CHIP_MIN_VISIBLE_STRIP_PX}px)`,
					);
				}
			}
			if (skipped) {
				phases.push({ phase: "boundary sweep", skipped });
			} else {
				phases.push({
					phase: `boundary sweep (${seen.length} positions, chips drawn at ${seen.filter((s) => s.chips > 0).length})`,
					...boundary,
					boundary: seen,
				});
			}
		}

		/*
		 * THE RESIZE CASE (code review round 1, R1-3), which no story can drive and
		 * which the viewport cannot produce for these stories either: each one pins
		 * its own column width (`style={{ width: 1024 }}`), so narrowing the VIEWPORT
		 * leaves the textarea exactly as wide as it was - the first version of this
		 * phase measured that and proved nothing, which is why the wrapper's own width
		 * is what changes here, the way a pane resize changes it in the app.
		 *
		 * The failure it exists for: the textarea is `w-full` and re-wraps with no
		 * React render at all, so the mirror keeps its inline `width =
		 * field.clientWidth` px and the chip keeps the rect it measured before - an
		 * opaque ground over glyphs it does not stand for. A `ResizeObserver` on the
		 * field is the fix in both layers and this is the only place it can be proven.
		 *
		 * ASSERTED rather than printed: a measurement that reports a 60px drift and
		 * exits 0 reads as a pass to every pipeline that looks at the exit code, which
		 * is the defect these numbers exist to catch. The field's own `clientWidth` is
		 * read before and after, so a resize that did not land fails the run instead of
		 * passing as "the chip held".
		 */
		const narrow = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			awaitPromise: true,
			expression: `(async () => {
				const f = document.querySelector("textarea");
				if (!f) return { ok: false, why: "no field" };
				let wrapper = f.parentElement;
				while (wrapper && wrapper !== document.body) {
					if (wrapper.style && wrapper.style.width) break;
					wrapper = wrapper.parentElement;
				}
				if (!wrapper || wrapper === document.body) return { ok: false, why: "no wrapper with an inline width" };
				const before = f.clientWidth;
				wrapper.style.width = Math.max(260, before - 200) + "px";
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				return { ok: true, before, after: f.clientWidth };
			})()`,
		});
		const resized = narrow.result.value;
		if (!resized?.ok) {
			throw new Error(
				`${story} @ ${width}x${height}: the resize case could not run - ${resized?.why ?? "no answer"}`,
			);
		}
		if (resized.after === resized.before) {
			throw new Error(
				`${story} @ ${width}x${height}: the wrapper width changed and the field's did not (${resized.before} -> ${resized.after}), so this phase would prove nothing`,
			);
		}
		await settle();
		const after = await probe();
		const drift = after.deltas.filter(
			(delta) =>
				delta && (Math.abs(delta.left) > 0.5 || Math.abs(delta.top) > 0.5),
		);
		if (drift.length > 0) {
			throw new Error(
				`${story} @ ${width}x${height}: the chip does not follow a resize of its own box - ${JSON.stringify({ clientWidth: resized, drift, before: phases[0].deltas, after: after.deltas })}`,
			);
		}
		phases.push({
			phase: `box narrowed ${resized.before} -> ${resized.after}px`,
			...after,
		});

		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});

		/*
		 * THE FACE FITS ITS BOX, ON EVERY PHASE THAT DRAWS ONE (code review round 9, R9-2).
		 * D21's check first lived inside the boundary sweep's loop, and the sweep is skipped
		 * wherever the field does not scroll - which is every story but one, at 1024. The
		 * tightest rung (440, 9.14px of headroom) was therefore the one nothing checked, and a
		 * face widened by one utility passed the whole rig. The readings are the probe's own
		 * (`face`, `headroom`, both per chip), so this runs wherever a chip is painted.
		 */
		for (const phase of phases) {
			for (const chip of phase.chips ?? []) {
				if (typeof chip.face === "number" && chip.face > chip.box.width) {
					throw new Error(
						`${story} @ ${width}x${height} (${phase.phase}): the chip's face (${chip.face}px) is wider than the box it covers (${chip.box.width}px), so the reference's ordinal is truncated (design round 8, D21) - ${JSON.stringify(chip)}`,
					);
				}
			}
		}
		results.push({
			story,
			viewport: `${width}x${height}`,
			...phases[0],
			phases,
		});
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ origin: ORIGIN, results }, null, 2));
		return;
	}
	for (const entry of results) {
		console.log(`\n${entry.story}  @ ${entry.viewport}  (${ORIGIN})`);
		for (const phase of entry.phases) {
			console.log(`\n  -- ${phase.phase}`);
			if (phase.skipped) {
				console.log(`  skipped          ${phase.skipped}`);
				continue;
			}
			console.log(`  buffer           ${JSON.stringify(phase.value)}`);
			/*
			 * ONE SHAPE, BECAUSE EVERY PHASE THAT SURVIVES HAS IT (code review round 7, R7-2).
			 * Round 6 added a branch for a runless phase - `focus drop`, which recorded its own
			 * facts and drew nothing - and that phase is gone: its instrument is the jsdom row in
			 * `scripts/credential-composer.test.mjs` (`the layer reports the drop at the commit
			 * that removes the control it was standing on`), which fails on the pre-fix layer,
			 * where the rig phase could not. Every phase left here spreads a probe result, so the
			 * printer reads one shape again rather than carrying a branch nothing can reach.
			 */
			phase.runs.forEach((run, i) => {
				const chip = phase.chips[i];
				const delta = phase.deltas[i];
				console.log(
					`  run ${i}            ${JSON.stringify(run.text)} rects=${run.rects.length}` +
						` box=${JSON.stringify(run.box)}`,
				);
				if (!chip) {
					console.log(
						"    no chip at this run (a wrapped run, or one the layer clips away - round 3, R3-1)",
					);
					return;
				}
				console.log(
					`    chip           box=${JSON.stringify(chip.box)} content=${chip.content} client=${chip.client} clipped=${chip.clipped}`,
				);
				console.log(`    delta          ${JSON.stringify(delta)}`);
			});
			if (phase.wrapped > 0) {
				console.log(
					`  wrapped runs     ${phase.wrapped} (no chip: documented fallback)`,
				);
			}
		}
	}
};

main()
	.then(() => {
		teardown();
	})
	.catch((error) => {
		teardown();
		console.error(error.message);
		process.exit(1);
	});
