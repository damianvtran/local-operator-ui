/*
 * MEASURE the exact overlap between the Files section header and the rows.
 *
 * The two defects the report names are one physical situation seen from two
 * sides:
 *
 *   1. the header's PAINT does not isolate (it is a 5% ink wash), and
 *   2. the SCROLL does not clip below the header.
 *
 * To fix (2) honestly, this measures whether any row's paint reaches into
 * the header's band, and whether the header's own box covers the width the
 * rows occupy. That is the difference between "the header is translucent" and
 * "the header does not cover the content".
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
const handle = await launchApp({ armed: true, logName: "app-overlap.log", tag: "overlap" });

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

	report.geometry = await cdp.evaluate(`(() => {
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		const header = scroller.querySelector("h3");
		const hr = header.getBoundingClientRect();
		const sr = scroller.getBoundingClientRect();
		const cs = getComputedStyle(scroller);
		const hcs = getComputedStyle(header);

		const sections = [...scroller.querySelectorAll("section")].map((sec) => {
			const ul = sec.querySelector('ul[data-tour-tag="files-grid"]');
			if (!ul) return null;
			const ur = ul.getBoundingClientRect();
			const h3 = sec.querySelector("h3");
			const sh = h3 ? h3.getBoundingClientRect() : null;
			const lis = [...ul.querySelectorAll("li")].map((li) => {
				const r = li.getBoundingClientRect();
				return {
					top: Math.round(r.top),
					bottom: Math.round(r.bottom),
					left: Math.round(r.left),
					right: Math.round(r.right),
					// The row's INLINE offset, which is what the layout computes.
					inlineTop: li.style.top,
				};
			});
			return {
				header: sh
					? { top: Math.round(sh.top), bottom: Math.round(sh.bottom), left: Math.round(sh.left), right: Math.round(sh.right), width: Math.round(sh.width) }
					: null,
				ul: { top: Math.round(ur.top), bottom: Math.round(ur.bottom), left: Math.round(ur.left), right: Math.round(ur.right), width: Math.round(ur.width) },
				// THE ROW PAINT ESCAPES ITS BOX: a row's box top is ABOVE the
				// ul's box top when the layout offset is negative, and the row
				// then paints over the header.
				rowsEscapingUl: lis.filter((r) => r.top < ur.top - 1).length,
				minRowTop: lis.length ? Math.min(...lis.map((r) => r.top)) : null,
				rowLeft: lis.length ? Math.min(...lis.map((r) => r.left)) : null,
				rowRight: lis.length ? Math.max(...lis.map((r) => r.right)) : null,
				rows: lis.slice(0, 4),
			};
		}).filter(Boolean);

		return {
			scroller: {
				top: Math.round(sr.top),
				bottom: Math.round(sr.bottom),
				left: Math.round(sr.left),
				right: Math.round(sr.right),
				width: Math.round(sr.width),
				clientWidth: scroller.clientWidth,
				clientTop: scroller.clientTop,
				overflowY: cs.overflowY,
				paddingTop: cs.paddingTop,
				paddingLeft: cs.paddingLeft,
				paddingRight: cs.paddingRight,
				// The scroller's CLIP edge, which is the top of its padding box.
				clipTop: Math.round(sr.top + scroller.clientTop),
			},
			header: {
				top: Math.round(hr.top),
				bottom: Math.round(hr.bottom),
				left: Math.round(hr.left),
				right: Math.round(hr.right),
				width: Math.round(hr.width),
				height: Math.round(hr.height),
				position: hcs.position,
				zIndex: hcs.zIndex,
				background: hcs.backgroundColor,
				backdropFilter: hcs.backdropFilter,
			},
			// THE CLIP OFFSET: scroller.clipTop - header.bottom. Zero means
			// the scroller's overflow cuts content exactly at the header's
			// bottom edge, so content can never reach the band.
			clipOffset: Math.round(sr.top + scroller.clientTop - hr.bottom),
			// The band is INSIDE the scroller's clip region when the header's
			// bottom is below the clip edge.
			bandInsideScroller: Math.round(hr.bottom - (sr.top + scroller.clientTop)),
			sections,
		};
	})()`);

	// Scroll so a row's edge is inside the band, then measure the overlap.
	report.scrolled = await cdp.evaluate(`(() => {
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		const header = scroller.querySelector("h3");
		const hr = header.getBoundingClientRect();
		const target = hr.top + hr.height / 2;
		const rows = [...scroller.querySelectorAll('ul[data-tour-tag="files-grid"] > li')];
		let best = null;
		for (const row of rows) {
			const r = row.getBoundingClientRect();
			const delta = target - r.top;
			if (delta <= 0) continue;
			if (best === null || delta < best.delta) best = { delta, id: row.textContent.trim().slice(0, 30) };
		}
		if (!best) return { error: "no row reachable" };
		scroller.scrollTop += best.delta;
		scroller.dispatchEvent(new Event("scroll"));
		return { delta: Math.round(best.delta), id: best.id };
	})()`);
	await sleep(400);

	report.afterScroll = await cdp.evaluate(`(() => {
		const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
		const header = scroller.querySelector("h3");
		const hr = header.getBoundingClientRect();
		// Every row whose box intersects the header's band.
		const inBand = [...scroller.querySelectorAll('ul[data-tour-tag="files-grid"] > li')]
			.map((li) => {
				const r = li.getBoundingClientRect();
				return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: li.textContent.trim().slice(0, 24) };
			})
			.filter((r) => r.bottom > hr.top && r.top < hr.bottom);
		// The header's own width against the rows' width: a row that pokes
		// out beside the header is content the header does not cover.
		const rows = [...scroller.querySelectorAll('ul[data-tour-tag="files-grid"] > li')]
			.map((li) => li.getBoundingClientRect());
		return {
			header: { top: Math.round(hr.top), bottom: Math.round(hr.bottom), left: Math.round(hr.left), right: Math.round(hr.right) },
			rowsInBand: inBand.length,
			sampleInBand: inBand.slice(0, 3).map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), text: r.text })),
			rowsLeft: rows.length ? Math.round(Math.min(...rows.map((r) => r.left))) : null,
			rowsRight: rows.length ? Math.round(Math.max(...rows.map((r) => r.right))) : null,
			headerCoversRowsLeft:
				rows.length ? hr.left <= Math.min(...rows.map((r) => r.left)) : null,
			headerCoversRowsRight:
				rows.length ? hr.right >= Math.max(...rows.map((r) => r.right)) : null,
		};
	})()`);

	console.log(JSON.stringify(report, null, 1));
	writeFileSync(join(OUT, "overlap.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[overlap] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
