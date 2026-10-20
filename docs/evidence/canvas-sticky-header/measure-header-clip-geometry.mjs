/*
 * MEASURE the header/scroller relationship in every canvas pane.
 *
 * The request names two defects. The first (an isolating backdrop) is a paint
 * question. The second (the scroll must clip below the header) is a GEOMETRY
 * question, and geometry is the kind of thing that is true of one pane and
 * false of the next - so it is measured, not assumed.
 *
 * For every element that could be a header over scrolling content, this
 * reports whether it is INSIDE the scroll container or a SIBLING of it, and
 * the clip offset between the scroll container's top edge and the header's
 * bottom edge.
 *
 *   offset = scroller.top - header.bottom
 *
 *   offset == 0   the scroller's overflow clips content exactly at the
 *                 header's bottom edge: content CANNOT appear in the band.
 *   offset < 0   the header's band lies INSIDE the scroller's clip region:
 *                 content scrolls under it and only the header's own paint
 *                 hides it.
 *   offset > 0   a GAP: content is clipped above the header's bottom edge,
 *                 so the header's band shows the pane behind it.
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
const handle = await launchApp({ armed: true, logName: "app-geom.log", tag: "geom" });

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
	 * THE PROBE.
	 *
	 * A "header over content" is found the way the defect happens, not by a
	 * class list: an element whose box OVERLAPS a scroll container's box,
	 * above the container's top edge, and which is painted ABOVE the
	 * container's content (a later sibling, a higher z-index, or a positioned
	 * element). Everything else is reported as a scroller, for the inventory.
	 */
	const probe = `(() => {
		const rectOf = (el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right, width: r.width };
		};
		const visible = (el) => {
			const cs = getComputedStyle(el);
			if (cs.display === "none" || cs.visibility === "hidden") return false;
			const r = el.getBoundingClientRect();
			return r.height > 2 && r.width > 2;
		};
		const scrollers = [];
		for (const el of document.querySelectorAll("body *")) {
			const cs = getComputedStyle(el);
			if (!/(auto|scroll|overlay|clip)/.test(cs.overflowY)) continue;
			if (!visible(el)) continue;
			if (el.scrollHeight <= el.clientHeight + 1) continue;
			scrollers.push(el);
		}
		const headers = [];
		const seen = new Set();
		for (const el of document.querySelectorAll("body *")) {
			if (!visible(el)) continue;
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			// A header over content: it overlaps some scroller's box and it is
			// not that scroller's own descendant.
			for (const sc of scrollers) {
				if (sc.contains(el)) continue;
				const sr = sc.getBoundingClientRect();
				const overlaps =
					r.left < sr.right &&
					r.right > sr.left &&
					r.top < sr.bottom &&
					r.bottom > sr.top;
				if (!overlaps) continue;
				const key = el.tagName + "|" + (el.getAttribute("data-tour-tag") || "") + "|" + Math.round(r.top);
				if (seen.has(key)) continue;
				seen.add(key);
				headers.push({
					tag: el.tagName.toLowerCase(),
					tour: el.getAttribute("data-tour-tag"),
					role: el.getAttribute("role"),
					cls: (el.getAttribute("class") || "").slice(0, 110),
					text: (el.textContent || "").trim().slice(0, 36),
					position: cs.position,
					zIndex: cs.zIndex,
					background: cs.backgroundColor,
					backdropFilter: cs.backdropFilter,
					rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
					scroller: {
						tour: sc.getAttribute("data-tour-tag"),
						cls: (sc.getAttribute("class") || "").slice(0, 110),
						overflowY: getComputedStyle(sc).overflowY,
						clipTop: Math.round(sr.top),
						// THE CLIP OFFSET. Zero means the scroller's overflow
						// cuts content exactly at the header's bottom edge.
						offset: Math.round(sr.top - r.bottom),
					},
				});
				break;
			}
		}
		return { headers, scrollerCount: scrollers.length };
	})()`;

	const panes = [
		{
			name: "files",
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
	];

	for (const pane of panes) {
		await pane.open();
		const found = await cdp.evaluate(probe);
		report.panes.push({ pane: pane.name, ...found });
		console.log(
			`[geom/${pane.name}] ${found.headers.length} headers over ${found.scrollerCount} scrollers`,
		);
		for (const h of found.headers) {
			console.log(
				`   ${h.tag}${h.tour ? `[${h.tour}]` : ""} pos=${h.position} z=${h.zIndex} bg=${h.background} backdrop=${h.backdropFilter} h=${h.rect.height} CLIP_OFFSET=${h.scroller.offset} scroller=${h.scroller.tour || h.scroller.cls.slice(0, 30)} text="${h.text}"`,
			);
		}
	}

	writeFileSync(join(OUT, "geometry.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[geom] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
