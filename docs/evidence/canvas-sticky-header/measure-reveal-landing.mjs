/*
 * MEASURE whether a reveal lands content UNDER the sticky header.
 *
 * The repo's own `shared/lib/scroll.ts` names this case in advance: "If a
 * sticky header ever appears above a section a reveal targets, the offset here
 * gains that padding term rather than the call site going back to
 * scrollIntoView." The Files view has a sticky section header and a reveal
 * that assigns `scrollTop` directly, so this is the case the note describes.
 *
 * The measurement: drive the list's OWN keyboard navigation (ArrowDown from
 * the first row) and ask, for each newly focused row, where its box landed
 * relative to the pinned header's bottom edge. A row whose top is ABOVE the
 * header's bottom edge is a row the user cannot see, because the header
 * paints over it.
 *
 * The scroll-by-wheel case is measured too, and it is the control: a wheel
 * scroll has no target and therefore has no landing to be wrong.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rendererDriverApi } from "../../../scripts/renderer-driver.mjs";

const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	waitForPage,
	waitForBridge,
	verb,
	reapLiveBoots,
} = rendererDriverApi;

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const BACKEND = arg("--backend");
const SESSION = arg("--session");
const OUT = arg("--out");

if (!BACKEND || !SESSION || !OUT) {
	console.error("needs --backend --session --out");
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({ armed: true, logName: "app-reveal.log", tag: "reveal" });

const report = { landings: [] };
let code = 0;

try {
	for (let i = 0; i < 240; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).ok) break;
		} catch {
			/* not listening yet */
		}
		await sleep(250);
	}
	const cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	const until = async (expr, ms = 60_000) => {
		const t0 = Date.now();
		for (;;) {
			const v = await cdp.evaluate(expr).catch(() => null);
			if (v) return v;
			if (Date.now() - t0 > ms) return null;
			await sleep(250);
		}
	};

	await waitForPage(cdp);
	await waitForBridge(cdp);
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

	await verb(cdp, "navigate", `/chat/${SESSION}`);
	await until(
		`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
	);
	await sleep(900);
	if (
		!(await cdp.evaluate(
			`document.querySelector('[data-tour-tag="canvas-dock"]') ? true : false`,
		))
	) {
		await cdp.evaluate(
			`document.querySelector('[data-tour-tag="open-canvas-button"]').click(); true`,
		);
	}
	await until(
		`document.querySelector('button[aria-label^="Files"][aria-pressed]') ? true : null`,
	);
	await cdp.evaluate(
		`document.querySelector('button[aria-label^="Files"][aria-pressed]').click(); true`,
	);
	await sleep(1800);

	// Dismiss the sign-in modal: it swallows the clicks that open a pane.
	await cdp.evaluate(`(() => {
		const skip = [...document.querySelectorAll("button")].find(
			(b) => (b.textContent || "").trim() === "Skip for now",
		);
		if (skip) { skip.click(); return true; }
		return false;
	})()`);
	await sleep(800);

	/*
	 * FOCUS THE FIRST ROW, then drive the list's own ArrowDown. The keydown
	 * goes to the focused element, which is what a user's keypress does.
	 */
	await cdp.evaluate(`(() => {
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		if (!scroller) return false;
		const row = scroller.querySelector('ul[data-tour-tag="files-grid"] button');
		if (!row) return false;
		row.focus();
		return true;
	})()`);
	await sleep(400);

	const readState = () =>
		cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			if (!scroller) return { error: "no scroller" };
			const header = scroller.querySelector("h3");
			const hr = header ? header.getBoundingClientRect() : null;
			const active = document.activeElement;
			const ar = active ? active.getBoundingClientRect() : null;
			return {
				scrollTop: Math.round(scroller.scrollTop),
				header: hr
					? { top: Math.round(hr.top), bottom: Math.round(hr.bottom), height: Math.round(hr.height) }
					: null,
				focused: active
					? {
							tag: active.tagName.toLowerCase(),
							text: (active.textContent || "").trim().slice(0, 30),
							top: ar ? Math.round(ar.top) : null,
							bottom: ar ? Math.round(ar.bottom) : null,
						}
					: null,
			};
		})()`);

	const before = await readState();
	console.log(`[reveal] initial ${JSON.stringify(before)}`);

	// Walk down the list with the list's own keyboard handling.
	for (let step = 0; step < 14; step += 1) {
		await cdp.evaluate(`(() => {
			const active = document.activeElement;
			if (!active) return false;
			active.dispatchEvent(new KeyboardEvent("keydown", {
				key: "ArrowDown",
				code: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}));
			return true;
		})()`);
		await sleep(320);
		const state = await readState();
		if (!state.focused) {
			console.log(`[reveal] step ${step} no focus`);
			continue;
		}
		const hiddenBy = state.header ? state.focused.top - state.header.bottom : null;
		const landing = {
			step,
			text: state.focused.text,
			focusedTop: state.focused.top,
			headerBottom: state.header?.bottom ?? null,
			// NEGATIVE means the focused row's top is ABOVE the header's bottom
			// edge: the header paints over it and the user cannot see it.
			hiddenByHeaderPx: hiddenBy,
			scrollTop: state.scrollTop,
		};
		report.landings.push(landing);
		console.log(
			`[reveal] step ${step} "${landing.text}" focusedTop=${landing.focusedTop} headerBottom=${landing.headerBottom} hiddenBy=${hiddenBy === null ? "n/a" : hiddenBy.toFixed(0)}px scrollTop=${landing.scrollTop}`,
		);
	}

	const hidden = report.landings.filter((l) => l.hiddenByHeaderPx !== null && l.hiddenByHeaderPx < 0);
	report.summary = {
		landings: report.landings.length,
		hiddenByHeader: hidden.length,
		worstHiddenByPx: hidden.length
			? Math.min(...hidden.map((l) => l.hiddenByHeaderPx))
			: 0,
	};
	console.log(
		`[reveal/summary] ${report.summary.hiddenByHeader} of ${report.summary.landings} DOWNWARD keyboard landings ended up UNDER the header (worst ${report.summary.worstHiddenByPx}px).`,
	);

	/*
	 * THE UPWARD CASE, which is the one the repo's own scroll helper names:
	 * "If a sticky header ever appears above a section a reveal targets, the
	 * offset here gains that padding term." Scrolling UP assigns
	 * `scrollTop = band.top`, which lands the band at the scrollport's TOP
	 * edge - the same 32 pixels the sticky header occupies.
	 */
	report.upward = [];
	// Walk well down the list first, so an upward move has somewhere to go.
	for (let step = 0; step < 10; step += 1) {
		await cdp.evaluate(`(() => {
			const active = document.activeElement;
			if (!active) return false;
			active.dispatchEvent(new KeyboardEvent("keydown", {
				key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true,
			}));
			return true;
		})()`);
		await sleep(200);
	}
	await cdp.evaluate(`(() => {
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
		return true;
	})()`);
	await sleep(400);

	for (let step = 0; step < 12; step += 1) {
		await cdp.evaluate(`(() => {
			const active = document.activeElement;
			if (!active) return false;
			active.dispatchEvent(new KeyboardEvent("keydown", {
				key: "ArrowUp", code: "ArrowUp", bubbles: true, cancelable: true,
			}));
			return true;
		})()`);
		await sleep(300);
		const state = await readState();
		if (!state.focused || !state.header) continue;
		if (state.focused.top === null) {
			console.log(`[reveal/up ${step}] focus has no box (${state.focused.tag})`);
			continue;
		}
		const hiddenBy = state.focused.top - state.header.bottom;
		const landing = {
			step,
			text: state.focused.text,
			focusedTop: state.focused.top,
			headerBottom: state.header.bottom,
			hiddenByHeaderPx: hiddenBy,
			scrollTop: state.scrollTop,
		};
		report.upward.push(landing);
		console.log(
			`[reveal/up ${step}] "${landing.text}" focusedTop=${landing.focusedTop} headerBottom=${landing.headerBottom} hiddenBy=${hiddenBy.toFixed(0)}px scrollTop=${landing.scrollTop}`,
		);
	}
	const upHidden = report.upward.filter((l) => l.hiddenByHeaderPx < 0);
	report.summary.upward = {
		landings: report.upward.length,
		hiddenByHeader: upHidden.length,
		worstHiddenByPx: upHidden.length
			? Math.min(...upHidden.map((l) => l.hiddenByHeaderPx))
			: 0,
	};
	console.log(
		`[reveal/summary] ${report.summary.upward.hiddenByHeader} of ${report.summary.upward.landings} UPWARD keyboard landings ended up UNDER the header (worst ${report.summary.upward.worstHiddenByPx}px).`,
	);

	writeFileSync(join(OUT, "reveal.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[reveal] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
