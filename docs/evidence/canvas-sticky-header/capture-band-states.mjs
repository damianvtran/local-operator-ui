/*
 * THE STATES A HEADER HAS TO SURVIVE, and the Library's own header.
 *
 * The before/after pairs in `capture-sticky-header.mjs` show the band at
 * REST - a header with a thumbnail boundary crossing it and nothing else
 * going on. A band is only as good as the worst thing that can happen under
 * it, and three things can: a row can be HOVERED under it, a row can be
 * SELECTED under it, and the whole mechanism has to hold for the LIBRARY's
 * spreadsheet column strip, which is a different role in a different pane.
 *
 * So this rig captures, from the running app:
 *
 *   - `hover`      a real pointer move onto a row that is crossing the band,
 *                  so the band is over a row in its hover state;
 *   - `selected`   the same row after a real click, so the band is over a row
 *                  in its selected state;
 *   - `library`    the Library's own sticky spreadsheet header, mid-scroll,
 *                  with its rows passing under it.
 *
 * The pointer work goes through Chromium's own input pipeline
 * (`Input.dispatchMouseEvent`), because `:hover` is only set by a real
 * pointer, and the rig ASSERTS `:hover` before the shutter - a frame filed
 * under a hover is one the element genuinely matched.
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
	capture,
	reapLiveBoots,
} = rendererDriverApi;

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};

const BACKEND = arg("--backend");
const SESSION = arg("--session");
const OUT = arg("--out");
const LABEL = arg("--label", "states");
const LIBRARY_ASSET = arg("--asset");

if (!BACKEND || !SESSION || !OUT) {
	console.error("needs --backend --session --out");
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({ armed: true, logName: "app-states.log", tag: "states" });

const report = { runs: [] };

/*
 * THE THEME IS SWITCHED BY PALETTE NAME, AND THE SWITCH IS ASSERTED.
 *
 * `setTheme` takes the app's own palette id (`localOperatorDark`), not the
 * scheme word. Passing "dark"/"light" leaves the palette where it was, and the
 * first version of this rig did exactly that: the Library's two frames came
 * back BYTE-IDENTICAL and the "light" one was the dark palette, so the rig was
 * publishing a mislabeled frame. (Caught by the design round, which compared
 * the PNGs rather than trusting the filenames.)
 *
 * So the name is mapped, and after every switch the rig reads the computed
 * `--lo-surface` back and REFUSES to capture if the ground did not change.
 */
const paletteFor = (scheme) =>
	scheme === "light" ? "localOperatorLight" : "localOperatorDark";

const switchTheme = async (cdp, scheme) => {
	await verb(cdp, "setTheme", paletteFor(scheme));
	await sleep(700);
	const ground = await cdp.evaluate(
		`getComputedStyle(document.documentElement).getPropertyValue("--lo-surface").trim()`,
	);
	report.themeGrounds = report.themeGrounds || {};
	report.themeGrounds[scheme] = ground;
	console.log(`[states/${scheme}] palette ${paletteFor(scheme)} -> --lo-surface ${ground}`);
	return ground;
};
let code = 0;

/** A real pointer move to the centre of an element, and a real click. */
const pointerAt = async (cdp, x, y) => {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x,
		y,
		button: "none",
		buttons: 0,
		clickCount: 0,
	});
};

const clickAt = async (cdp, x, y) => {
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	});
};

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
	 * THE FILES TAB, and a scroll position that puts a row's EDGE across the
	 * band - so the state under the band is a row, not empty space.
	 */
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
	await cdp.evaluate(`(() => {
		const skip = [...document.querySelectorAll("button")].find(
			(b) => (b.textContent || "").trim() === "Skip for now",
		);
		if (skip) { skip.click(); return true; }
		return false;
	})()`);
	await sleep(900);

	for (const theme of ["dark", "light"]) {
		await switchTheme(cdp, theme);

		// Scroll so a row's boundary crosses the header's band.
		const target = await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			if (!scroller) return null;
			const header = scroller.querySelector("h3");
			if (!header) return null;
			const hr = header.getBoundingClientRect();
			// Find a row whose TOP edge is just inside the band, so the band
			// covers part of the row and part of the space above it.
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			for (const row of rows) {
				const r = row.getBoundingClientRect();
				if (r.top > hr.bottom - 40 && r.top < hr.bottom + 200) {
					return { rowTop: r.top, headerBottom: hr.bottom, x: r.left + 40, y: r.top + 20 };
				}
			}
			return { rowTop: null, headerBottom: hr.bottom, x: 0, y: 0 };
		})()`);
		if (!target) {
			console.log(`[states/${theme}] no header`);
			continue;
		}

		// Scroll the row into the band.
		await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			const header = scroller.querySelector("h3");
			const hr = header.getBoundingClientRect();
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			for (const row of rows) {
				const r = row.getBoundingClientRect();
				if (r.top > hr.bottom - 40 && r.top < hr.bottom + 200) {
					scroller.scrollTop += (r.top - hr.bottom) + 18;
					return true;
				}
			}
			return false;
		})()`);
		await sleep(700);

		/*
		 * THE ROW THAT CROSSES THE BAND, and the point to hover.
		 *
		 * The pointer CANNOT go inside the band: the header is `z-10` and
		 * paints over the rows, so a pointer at the band's own coordinates
		 * lands on the HEADER, not the row. That is the correct behaviour - the
		 * band takes the pointer, exactly as it takes the paint - and it means
		 * the hover state to capture is the one a user can actually produce:
		 * a row that is PARTLY under the band, hovered on the part that is
		 * still visible below it. The band's lower edge then has the row's
		 * hover ground starting right at it.
		 */
		const where = await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			const header = scroller.querySelector("h3");
			const hr = header.getBoundingClientRect();
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			for (const row of rows) {
				const r = row.getBoundingClientRect();
				// A row that starts ABOVE the band and ends BELOW it: the band
				// crosses it, and the part below the band is hoverable.
				if (r.top < hr.bottom - 4 && r.bottom > hr.bottom + 12) {
					return {
						x: Math.round(r.left + 40),
						y: Math.round(hr.bottom + 8),
						rowTop: Math.round(r.top),
						rowBottom: Math.round(r.bottom),
						headerTop: Math.round(hr.top),
						headerBottom: Math.round(hr.bottom),
					};
				}
			}
			return { x: 0, y: 0 };
		})()`);
		if (!where.x) {
			console.log(`[states/${theme}] no row crossing the band`);
			continue;
		}
		console.log(
			`[states/${theme}] row crosses the band: row ${where.rowTop}..${where.rowBottom}, header ${where.headerTop}..${where.headerBottom}, hover point y=${where.y}`,
		);

		// HOVER: a real pointer move onto the row's VISIBLE part.
		await pointerAt(cdp, where.x, where.y);
		await sleep(600);
		const hovered = await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			for (const row of rows) {
				if (row.matches(":hover") || row.querySelector(":hover")) return true;
			}
			return false;
		})()`);
		console.log(`[states/${theme}] a row is hovered: ${hovered}`);
		const hoverFrame = await capture(cdp, `states-${LABEL}-${theme}-hover`, {
			assertPalette: false,
		});
		report.runs.push({ theme, state: "hover", hovered, frame: hoverFrame.path ?? hoverFrame });

		/*
		 * THE SELECTED ROW, which is the row of the document the user is IN
		 * (`rowCurrent` on the same element as `hover:bg-row-hover`). It is
		 * reached by the app's own action - clicking a row opens that document
		 * - and the Files list is then shown again with that row current.
		 */
		await clickAt(cdp, where.x, where.y);
		await sleep(900);
		await cdp.evaluate(`(() => {
			const files = [...document.querySelectorAll('button[aria-label^="Files"]')].find((b) => b.getAttribute("aria-pressed") === "false");
			if (files) { files.click(); return true; }
			return false;
		})()`);
		await sleep(1200);
		/*
		 * SCROLL THE CURRENT ROW UNDER THE BAND. Opening a document changes
		 * the pane, so when the Files list comes back the reading position is
		 * not where it was; the state to photograph is a CURRENT row that a
		 * later row's thumbnail passes under, so the list is scrolled to put
		 * the current row's own top edge across the band.
		 */
		await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			if (!scroller) return false;
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			const cur = rows.find((r) => /row-selected|current/i.test(r.className || ""));
			if (!cur) return false;
			const cr = cur.getBoundingClientRect();
			const sr = scroller.getBoundingClientRect();
			// Put the current row's top 16px ABOVE the band's bottom edge.
			scroller.scrollTop += (cr.top - sr.top) - 5;
			return true;
		})()`);
		await sleep(900);
		const current = await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			if (!scroller) return { error: "no scroller" };
			const header = scroller.querySelector("h3");
			const hr = header.getBoundingClientRect();
			const rows = [...scroller.querySelectorAll('[data-tour-tag="file-row"]')];
			const cur = rows.find((r) => /row-selected|current/i.test(r.className || ""));
			if (!cur) return { error: "no current row" };
			const r = cur.getBoundingClientRect();
			return {
				rowTop: Math.round(r.top),
				rowBottom: Math.round(r.bottom),
				headerTop: Math.round(hr.top),
				headerBottom: Math.round(hr.bottom),
				crossesBand: r.top < hr.bottom && r.bottom > hr.bottom,
				cls: (cur.className || "").slice(0, 160),
			};
		})()`);
		console.log(`[states/${theme}] selected row: ${JSON.stringify(current)}`);
		const selectedFrame = await capture(cdp, `states-${LABEL}-${theme}-selected`, {
			assertPalette: false,
		});
		report.runs.push({ theme, state: "selected", current, frame: selectedFrame.path ?? selectedFrame });
	}

	/*
	 * THE LIBRARY'S OWN HEADER. The Library is a different pane with a
	 * different role - a COLUMN STRIP, not a section label - and the claim
	 * under test is that the same mechanism serves both.
	 */
	if (LIBRARY_ASSET) {
		await verb(cdp, "navigate", `/library/assets/${LIBRARY_ASSET}`);
		await sleep(4500);
		for (const theme of ["dark", "light"]) {
			await switchTheme(cdp, theme);
			// Scroll the sheet so a row passes under the column strip.
			await cdp.evaluate(`(() => {
				const cell = document.querySelector("th");
				if (!cell) return false;
				let scroller = cell.parentElement;
				while (scroller && scroller !== document.body) {
					const s = getComputedStyle(scroller);
					if (/(auto|scroll|clip)/.test(s.overflowY)) break;
					scroller = scroller.parentElement;
				}
				if (!scroller) return false;
				scroller.scrollTop = 60;
				return true;
			})()`);
			await sleep(700);
			const measured = await cdp.evaluate(`(() => {
				const cell = document.querySelector("th");
				if (!cell) return { error: "no th" };
				const cs = getComputedStyle(cell);
				const cr = cell.getBoundingClientRect();
				return {
					background: cs.backgroundColor,
					backdropFilter: cs.backdropFilter,
					position: cs.position,
					height: Math.round(cr.height),
					top: Math.round(cr.top),
					bottom: Math.round(cr.bottom),
				};
			})()`);
			console.log(`[states/library/${theme}] ${JSON.stringify(measured)}`);
			const frame = await capture(cdp, `states-${LABEL}-library-${theme}`, {
				assertPalette: false,
			});
			report.runs.push({ theme, state: "library", measured, frame: frame.path ?? frame });
		}
	}

	const grounds = report.themeGrounds || {};
	if (grounds.dark && grounds.light && grounds.dark === grounds.light) {
		console.error(
			`[states] FAILED: dark and light resolved to the same --lo-surface (${grounds.dark}); the frames would be mislabeled`,
		);
		code = 1;
	}
	writeFileSync(join(OUT, "states.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[states] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
