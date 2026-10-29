/*
 * MEASURE the Library's sticky table header on the running app.
 *
 * The Files tab's header is the one the operator photographed, but the request
 * asks for the same treatment on the Library's section headers "inside the
 * canvas", and a rule that matches one and not the other is a patch, not a
 * system. So this asks three questions of the LIBRARY's own spreadsheet
 * viewer, in the app, and answers them from the app:
 *
 *   1. does the isolating rule MATCH the Library's sticky cell at all (the
 *      selector is a glass-region chain, and the Library's chain is not the
 *      Files tab's chain);
 *   2. what does that cell COMPUTE to - the background's alpha and its
 *      backdrop-filter;
 *   3. does the Library's own top fade and scrollbar still behave (the
 *      `data-lo-pane-edge-cues` mask and the scroller's own overflow).
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
const handle = await launchApp({ armed: true, logName: "app-library.log", tag: "library" });

const report = {};
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

	/*
	 * THE ASSET IS CHOSEN BY ITS ID, not by clicking a card: the Library
	 * route takes `/library/assets/:assetId`, so the probe can open the one
	 * asset whose viewer has a sticky table header (a spreadsheet) without
	 * depending on the grid's own card DOM, which changes with the view.
	 */
	const SPREADSHEET = arg("--asset");
	if (!SPREADSHEET) {
		console.error("needs --asset <library asset id>");
		process.exit(2);
	}
	await verb(cdp, "navigate", `/library/assets/${SPREADSHEET}`);
	await sleep(4500);
	/*
	 * THE SIGN-IN MODAL IS LEFT ALONE HERE, deliberately. It is a fixed
	 * overlay, so it does not stop the Library route from rendering its
	 * preview pane behind it - and dismissing it CLICKS a button that
	 * navigates, which threw the probe off the asset route and left it
	 * reading an empty list. The modal does not paint over the pane's own
	 * computed styles, which is what this probe reads.
	 */

	// The rule's own selector, quoted from styles/index.css.
	const SELECTOR =
		'html[data-glass~="pane"] main[data-glass-region="canvas-backing"] ' +
		'[data-glass-region="pane"] [data-glass-plane="band-backdrop"]';

	report.selector = SELECTOR;

	/*
	 * The Library's asset LIST, read from the DOM: the preview pane's own
	 * table is what carries the sticky header, so the probe opens the asset
	 * route directly and reads the rendered table.
	 */
	const assets = await cdp.evaluate(`(() => {
		const nodes = [...document.querySelectorAll("[data-library-card-id]")];
		return nodes.slice(0, 40).map((n) => ({
			tag: n.tagName.toLowerCase(),
			attr: n.getAttribute("data-library-card-id") || "",
			text: (n.textContent || "").trim().slice(0, 40),
		}));
	})()`);
	report.assetsFound = assets.length;
	console.log(`[library] ${assets.length} asset cards on the Library route`);

	report.measurement = await cdp.evaluate(`(() => {
		const SELECTOR = ${JSON.stringify(SELECTOR)};
		const cells = [...document.querySelectorAll("th")];
		if (!cells.length) {
			return { error: "no th on the opened asset", tableCount: document.querySelectorAll("table").length };
		}
		const cell = cells[0];
		const cs = getComputedStyle(cell);
		const cr = cell.getBoundingClientRect();
		// The scroller the cell is sticky inside.
		let scroller = cell.parentElement;
		while (scroller && scroller !== document.body) {
			const s = getComputedStyle(scroller);
			if (/(auto|scroll|clip)/.test(s.overflowY)) break;
			scroller = scroller.parentElement;
		}
		const sr = scroller ? scroller.getBoundingClientRect() : null;
		// The scroller's own fade mask, which the request says must keep behaving.
		const scrollerMask = scroller ? getComputedStyle(scroller).maskImage : null;
		return {
			matchesRule: cell.matches(SELECTOR),
			plane: cell.getAttribute("data-glass-plane"),
			background: cs.backgroundColor,
			backdropFilter: cs.backdropFilter,
			webkitBackdropFilter: cs.webkitBackdropFilter,
			position: cs.position,
			top: cs.top,
			height: Math.round(cr.height),
			cellRect: { top: Math.round(cr.top), bottom: Math.round(cr.bottom) },
			scroller: sr
				? {
						top: Math.round(sr.top),
						bottom: Math.round(sr.bottom),
						overflowY: getComputedStyle(scroller).overflowY,
						maskImage: scrollerMask,
					}
				: null,
			// Does the cell's own pane carry the glass region the rule needs?
			regionChain: (() => {
				const chain = [];
				let n = cell;
				while (n && n !== document.documentElement) {
					if (n.getAttribute) {
						const r = n.getAttribute("data-glass-region");
						if (r) chain.push(r);
					}
					n = n.parentElement;
				}
				return chain;
			})(),
		};
	})()`);

	console.log(`[library] ${JSON.stringify(report.measurement, null, 1)}`);

	writeFileSync(join(OUT, "library.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[library] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
