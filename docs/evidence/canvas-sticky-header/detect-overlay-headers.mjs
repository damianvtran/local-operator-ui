/*
 * FIND the headers that overlay a scroll container from OUTSIDE it.
 *
 * The Files tab's section headers are `position: sticky` INSIDE the scroller,
 * so the scroller's own overflow cannot clip the rows passing under them. The
 * other canvas panes put their bar ABOVE the scroller as a sibling, which is
 * the pattern whose clip is the scroller's own overflow edge.
 *
 * This finds the case the request names: a header that OVERLAYS a scroller but
 * is NOT inside it, so the scroller's clip does not protect the seam. For
 * every scroll container in the pane, it lists the elements that intersect the
 * container's VISIBLE box while not being its descendants - and whether they
 * paint above it.
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
const handle = await launchApp({ armed: true, logName: "app-overlay.log", tag: "overlay" });

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

	await verb(cdp, "navigate", `/chat/${SESSION}`);
	await until(
		`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
	);
	await sleep(800);
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
	await sleep(1500);

	/*
	 * DISMISS THE SIGN-IN MODAL. It is a fixed overlay over the whole window,
	 * so every element of it intersects every scroller and it drowns the
	 * probe's answer. "Skip for now" is the button that closes it.
	 */
	await cdp.evaluate(`(() => {
		const skip = [...document.querySelectorAll("button")].find(
			(b) => (b.textContent || "").trim() === "Skip for now",
		);
		if (skip) { skip.click(); return true; }
		return false;
	})()`);
	await sleep(800);

	/*
	 * THE PANE-BY-PANE SWEEP. Each pane is opened, its modal dismissed, and
	 * the overlay probe run. The answer the request needs is per pane: a
	 * header that overlays a scroller from OUTSIDE it is the case the
	 * scroller's own clip cannot protect.
	 */
	const PANES = [
		{
			name: "canvas-files",
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
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="ask-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "console",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="console-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "browser",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="browser-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "code-review",
			open: async () => {
				await cdp.evaluate(
					`document.querySelector('[data-tour-tag="code-pane-trigger"]')?.click(); true`,
				);
				await sleep(1200);
			},
		},
		{
			name: "library",
			open: async () => {
				await verb(cdp, "navigate", "/library");
				await sleep(2500);
			},
		},
	];

	const PROBE = `(() => {
		const scrollers = [...document.querySelectorAll("*")].filter((el) => {
			const cs = getComputedStyle(el);
			return (
				/(auto|scroll|overlay)/.test(cs.overflowY) &&
				el.scrollHeight > el.clientHeight + 4 &&
				el.clientHeight > 40
			);
		});
		const out = [];
		for (const sc of scrollers) {
			const sr = sc.getBoundingClientRect();
			if (sr.height < 40 || sr.width < 40) continue;
			if (sr.bottom < 0 || sr.top > window.innerHeight) continue;
			// The pane's own region, so the app chrome is not reported.
			const region = sc.closest('[data-glass-region]');
			const overlays = [];
			for (const el of document.querySelectorAll("body *")) {
				if (sc.contains(el)) continue;
				if (el.contains(sc)) continue;
				const cs = getComputedStyle(el);
				if (cs.display === "none" || cs.visibility === "hidden") continue;
				if (Number(cs.opacity) === 0) continue;
				const r = el.getBoundingClientRect();
				if (r.height < 8 || r.width < 40) continue;
				// Intersects the scroller's VISIBLE box?
				if (r.bottom <= sr.top || r.top >= sr.bottom) continue;
				if (r.right <= sr.left || r.left >= sr.right) continue;
				// Only chrome-like things: a leaf with no text of its own is a
				// decoration, and the interesting case is a labelled band.
				// The text filter is applied to the element's OWN text (not
				// its descendants'), so an ICON-ONLY bar is still reported:
				// a bar that has no label is exactly the case a text filter
				// would hide.
				const ownText = [...el.childNodes]
					.filter((n) => n.nodeType === 3)
					.map((n) => (n.textContent || "").trim())
					.join(" ")
					.trim();
				const text = (el.textContent || "").trim().slice(0, 30);
				if (!ownText && !text) continue;
				overlays.push({
					tag: el.tagName.toLowerCase(),
					tour: el.getAttribute("data-tour-tag"),
					position: cs.position,
					zIndex: cs.zIndex,
					background: cs.backgroundColor,
					backdropFilter: cs.backdropFilter,
					text,
					overlapTop: Math.round(Math.max(r.top, sr.top) - sr.top),
					overlapHeight: Math.round(Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top)),
				});
			}
			if (overlays.length === 0) continue;
			out.push({
				scroller: {
					tour: sc.getAttribute("data-tour-tag"),
					cls: (sc.getAttribute("class") || "").slice(0, 80),
					region: region ? region.getAttribute("data-glass-region") : null,
					top: Math.round(sr.top),
					height: Math.round(sr.height),
				},
				overlays,
			});
		}
		return out;
	})()`;

	report.panes = [];
	for (const pane of PANES) {
		await pane.open();
		await cdp.evaluate(`(() => {
			const skip = [...document.querySelectorAll("button")].find(
				(b) => (b.textContent || "").trim() === "Skip for now",
			);
			if (skip) { skip.click(); return true; }
			return false;
		})()`);
		await sleep(700);
		const found = await cdp.evaluate(PROBE);
		report.panes.push({ pane: pane.name, overlays: found });
		console.log(`[overlay/${pane.name}] ${found.length} scroller(s) with an outside overlay`);
		for (const entry of found) {
			console.log(
				`   scroller=${entry.scroller.tour || entry.scroller.cls} region=${entry.scroller.region} top=${entry.scroller.top} h=${entry.scroller.height}`,
			);
			for (const o of entry.overlays) {
				console.log(
					`      OVERLAY ${o.tag}${o.tour ? `[${o.tour}]` : ""} pos=${o.position} z=${o.zIndex} bg=${o.background} backdrop=${o.backdropFilter} overlapTop=${o.overlapTop} overlapH=${o.overlapHeight} text="${o.text}"`,
				);
			}
		}
	}

	report.overlay = report.panes[0]?.overlays ?? [];
	for (const entry of report.overlay) {
		console.log(
			`[overlay] scroller=${entry.scroller.tour || entry.scroller.cls} region=${entry.scroller.region} top=${entry.scroller.top} h=${entry.scroller.height}`,
		);
		for (const o of entry.overlays) {
			console.log(
				`   OVERLAY ${o.tag}${o.tour ? `[${o.tour}]` : ""} pos=${o.position} z=${o.zIndex} bg=${o.background} backdrop=${o.backdropFilter} overlapTop=${o.overlapTop} overlapH=${o.overlapHeight} text="${o.text}"`,
			);
		}
	}

	writeFileSync(join(OUT, "overlay.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[overlay] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
