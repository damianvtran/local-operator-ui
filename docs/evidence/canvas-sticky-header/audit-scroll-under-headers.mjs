/*
 * AUDIT every scroll-under header in the canvas pane family, in the real app.
 *
 * The defect report is about the Files tab, but the fix has to be a SYSTEM.
 * This script finds the headers the way the defect happens - by asking the
 * RUNTIME which elements paint over scrolling content - rather than by
 * grepping for a class list, because a grep finds the classes someone wrote
 * and misses the ones a stylesheet or a parent produced.
 *
 * THE QUESTION, per candidate header:
 *
 *   1. Is it a scroll-under header at all? (an element that is sticky, fixed
 *      or absolutely positioned, and that has scrolling content passing
 *      beneath it)
 *   2. What does it PAINT? (the computed background alpha and backdrop-filter)
 *   3. Does the SCROLL CONTAINER clip below it? (the scroller's clip edge
 *      against the header's bottom edge - a negative offset means content is
 *      visible in the header's band)
 *   4. What is the LIVE overlap? (a pixel sample of the header's band, taken
 *      while the content is scrolled under it, compared against the same band
 *      with the content scrolled away - this is the number that says whether
 *      the header actually isolates)
 *
 * The output is one JSON file. It is the inventory the fix is written against.
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
const handle = await launchApp({
	armed: true,
	logName: "app-audit.log",
	tag: "audit",
});

const report = { session: SESSION, panes: [] };
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
	await sleep(800);

	/*
	 * THE PROBE, as ONE expression, so the whole inventory is read in a single
	 * consistent frame of the app.
	 *
	 * The header candidate set is every element that is `position: sticky`,
	 * `fixed` or `absolute` AND has a scrollable ancestor - which is the
	 * definition of "paints over scrolling content". Each candidate is then
	 * measured against its nearest scrollable ancestor.
	 */
	const probeFor = (scope) => `(() => {
		const SCOPE = ${JSON.stringify(scope)};
		const px = (el) => {
			const r = el.getBoundingClientRect();
			return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) };
		};
		const scrollableAncestor = (el) => {
			let node = el.parentElement;
			while (node) {
				const cs = getComputedStyle(node);
				if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
				node = node.parentElement;
			}
			return null;
		};
		const describe = (el) => {
			const cs = getComputedStyle(el);
			const scroller = scrollableAncestor(el);
			const rect = el.getBoundingClientRect();
			const sr = scroller ? scroller.getBoundingClientRect() : null;
			return {
				tag: el.tagName.toLowerCase(),
				cls: (el.getAttribute("class") || "").slice(0, 120),
				tour: el.getAttribute("data-tour-tag"),
				role: el.getAttribute("role"),
				text: (el.textContent || "").trim().slice(0, 40),
				position: cs.position,
				zIndex: cs.zIndex,
				background: cs.backgroundColor,
				backdropFilter: cs.backdropFilter,
				rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
				scroller: scroller
					? {
							tour: scroller.getAttribute("data-tour-tag"),
							cls: (scroller.getAttribute("class") || "").slice(0, 120),
							overflowY: getComputedStyle(scroller).overflowY,
							clientHeight: scroller.clientHeight,
							scrollHeight: scroller.scrollHeight,
							// THE CLIP OFFSET: how far the scroller's top edge is
							// ABOVE the header's bottom edge. Negative means
							// content is visible in the header's band.
							clipOffsetBelowHeader: Math.round(sr.top - rect.bottom),
							headerBandInsideScroller: Math.round(rect.bottom - sr.top),
						}
					: null,
			};
		};
		const seen = new Set();
		const headers = [];
		/*
		 * THE SCOPE. Only the pane under test is read: the canvas and the
		 * rail panes are all mounted at once, so a document-wide sweep reports
		 * the FILES headers for every pane and proves nothing about the pane
		 * named. The scope is the pane's own root element.
		 */
		const scope = SCOPE;
		const root = scope ? document.querySelector(scope) : document.body;
		if (!root) return { headers: [], url: location.pathname, scopeMissing: scope };
		for (const el of root.querySelectorAll("*")) {
			const cs = getComputedStyle(el);
			if (!/(sticky|fixed)/.test(cs.position)) continue;
			if (cs.display === "none" || cs.visibility === "hidden") continue;
			const rect = el.getBoundingClientRect();
			if (rect.height < 4 || rect.width < 4) continue;
			if (!scrollableAncestor(el)) continue;
			const key = el.tagName + "|" + (el.getAttribute("data-tour-tag") || "") + "|" + Math.round(rect.top);
			if (seen.has(key)) continue;
			seen.add(key);
			headers.push(describe(el));
		}
		return { headers, url: location.pathname, scope };
	})()`;

	/*
	 * THE PANES, and how each one is OPENED.
	 *
	 * The canvas's Files view is not the pane's default view: the canvas opens
	 * on Documents, and the Files list is behind its own tab button. Reading
	 * the pane without opening the view reports zero headers, which reads as
	 * "this pane has no scroll-under header" and is exactly the wrong answer.
	 */
	const panes = [
		{
			name: "files",
			scope: '[data-tour-tag="canvas-container"]',
			open: async () => {
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
				await sleep(1200);
			},
		},
		{
			name: "asks",
			scope: '[data-glass-region="pane"][aria-label^="All asks"], [data-glass-region="pane"][aria-label^="This conversation"]',
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="ask-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "console",
			scope: '[data-tour-tag="console-pane"]',
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="console-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "browser",
			scope: '[data-tour-tag="browser-pane"]',
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="browser-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "code-review",
			scope: "[data-code-review-pane]",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="code-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
	];

	for (const pane of panes) {
		await pane.open();
		const found = await cdp.evaluate(probeFor(pane.scope));
		report.panes.push({ pane: pane.name, ...found });
		console.log(`[audit/${pane.name}] ${found.headers.length} scroll-under headers`);
		for (const h of found.headers) {
			console.log(
				`   ${h.tag}${h.tour ? `[${h.tour}]` : ""} pos=${h.position} bg=${h.background} backdrop=${h.backdropFilter} h=${h.rect.height} clip=${h.scroller ? h.scroller.clipOffsetBelowHeader : "n/a"} text="${h.text}"`,
			);
		}
	}

	writeFileSync(join(OUT, "audit.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[audit] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
