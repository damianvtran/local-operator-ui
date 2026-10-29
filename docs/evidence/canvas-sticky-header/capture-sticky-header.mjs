/*
 * MEASURE the canvas Files tab's sticky section header, in the real app.
 *
 * Drives the BUILT app headless over CDP (no window, no focus), against an
 * isolated backend this run owns, and reports the numbers the defect is
 * described in:
 *
 *   - the sticky header's computed background alpha, backdrop-filter and height
 *   - the scroll container's clip offset against that height
 *   - a frame-time sample while the list scrolls
 *   - a frame per (theme, translucency) with a thumbnail boundary crossing the
 *     header band
 *
 * The header is identified by its OWN role marker, never by a class list, so a
 * styling change cannot silently move the measurement off the element.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const LABEL = arg("--label", "run");
const THEME = arg("--theme", "both");
const INTENSITIES = (arg("--intensities", "80,0") ?? "80,0")
	.split(",")
	.map((v) => (v.trim() === "off" ? "off" : Number(v.trim())));
/*
 * A CANDIDATE TREATMENT, injected into the running app.
 *
 * The question this rig exists to answer is what the header PAINTS, not what
 * its class list says: a candidate stylesheet is applied to the live page and
 * the same measurement is taken, so a proposal is judged on the pixels it
 * produces rather than on its CSS.
 */
const INJECT = arg("--inject", null);
const INJECT_CSS = INJECT ? readFileSync(INJECT, "utf8") : null;
/*
 * THE SAME-BUILD CONTROL.
 *
 * The question "does the backdrop-filter cost frames?" cannot be answered by
 * comparing a run from one minute to a run from an hour ago: this machine
 * carries other sessions, and a slower run may be a busier machine rather
 * than a slower filter. The control therefore runs against the SAME bundle
 * with the filter's own property switched off, back to back, so the only
 * difference between the two numbers is the property under test.
 */
const NO_BACKDROP = arg("--no-backdrop", null) !== null;
const CONTROL_CSS = `
[data-glass-plane="band-backdrop"] {
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
`;

if (!BACKEND || !SESSION || !OUT) {
	console.error("needs --backend --session --out");
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({
	armed: true,
	logName: `app-${LABEL}.log`,
	tag: LABEL,
});

const report = { label: LABEL, session: SESSION, window: null, runs: [] };
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
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(3000);
	await waitForPage(cdp);
	await waitForBridge(cdp);

	/*
	 * THE FRAME-TIME INSTRUMENT NEEDS THE PAGE BELIEVING IT IS FOCUSED.
	 *
	 * The window is never shown (the harness bans a visible window), and a
	 * hidden page throttles `requestAnimationFrame` to roughly one frame per
	 * second. Measured before this was enabled: a median frame time of 84-140ms
	 * while the list scrolled, which is the THROTTLE, not the scroll. With
	 * focus emulation on, the page's rAF runs at the display cadence and the
	 * numbers become the cost of scrolling the list.
	 *
	 * This changes nothing about the app: it is the sanctioned CDP stand-in for
	 * focus, the same switch the repo's own perf scenes use (see
	 * `scripts/renderer-driver.mjs`), and the window still never appears.
	 */
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

	if (NO_BACKDROP) {
		await cdp.evaluate(`(() => {
			const style = document.createElement("style");
			style.id = "lo-rig-control";
			style.textContent = ${JSON.stringify(CONTROL_CSS)};
			document.head.appendChild(style);
			return true;
		})()`);
		await sleep(300);
	}

	if (INJECT_CSS !== null) {
		await cdp.evaluate(`(() => {
			const style = document.createElement("style");
			style.id = "lo-rig-injected";
			style.textContent = ${JSON.stringify(INJECT_CSS)};
			document.head.appendChild(style);
			return true;
		})()`);
		await sleep(300);
	}

	report.window = (
		await cdp
			.evaluate("window.__loDevDriver.facts ? window.__loDevDriver.facts() : null")
			.catch(() => null)
	)?.windowSize;

	const themes =
		THEME === "both"
			? [
					["dark", "localOperatorDark"],
					["light", "localOperatorLight"],
				]
			: [[THEME, THEME === "dark" ? "localOperatorDark" : "localOperatorLight"]];

	for (const [theme, themeName] of themes) {
		await verb(cdp, "setTheme", themeName);
		await verb(cdp, "navigate", "/chat/new");
		await sleep(300);
		await verb(cdp, "navigate", `/chat/${SESSION}`);
		console.log(`[${LABEL}/${theme}] navigated`);
		await until(
			`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
		);
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
		console.log(`[${LABEL}/${theme}] files view requested`);
		// The list settles when the row count holds steady.
		let last = -1;
		let stable = 0;
		for (let i = 0; i < 80 && stable < 8; i += 1) {
			const n = await cdp.evaluate(
				`document.querySelectorAll('[data-tour-tag="file-row"]').length`,
			);
			stable = n === last ? stable + 1 : 0;
			last = n;
			await sleep(300);
		}
		await sleep(2500);

		/*
		 * THE INTENSITY SWEEP, and the OFF case.
		 *
		 * The operator named three conditions the fix must hold at: the
		 * default 80%, 100% (opaque), and with translucency off. The app's
		 * slider is an INTENSITY whose 0 is the most opaque end, so "off" is
		 * not an intensity but a coverage: `enabled: false` is what the
		 * Settings row writes when the master switch is flipped.
		 *
		 * The case is expressed as the string "off" in the --intensities list
		 * so one rig covers all of them.
		 */
		for (const intensity of INTENSITIES) {
			/*
			 * The translucency the operator chose, through the app's own
			 * setting. "off" is the master switch: `enabled: false`, which
			 * removes the `data-glass` attribute and therefore the whole
			 * glass cascade. It is the case the operator named as "with
			 * translucency off", and it is NOT an intensity.
			 */
			const glassPatch =
				intensity === "off"
					? `{ enabled: false }`
					: `{ enabled: true, intensity: ${intensity} }`;
			await cdp
				.evaluate(
					`window.api.windowGlass.set(${glassPatch}).then(() => true)`,
				)
				.catch(() => null);
			await sleep(1500);

			const reading = await cdp.evaluate(`(() => {
				const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
				if (!scroller) return { error: "no files scroller" };
				const header = scroller.querySelector('h3[data-sticky-header], h3');
				const cs = header ? getComputedStyle(header) : null;
				const hr = header ? header.getBoundingClientRect() : null;
				const sr = scroller.getBoundingClientRect();
				const alphaOf = (c) => {
					if (!c || c === "transparent") return 0;
					let m = c.match(/^rgba?\\(([^)]+)\\)$/);
					if (m) { const p = m[1].split(/[,\\/]\\s*|\\s+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; }
					m = c.match(/^color\\(srgb ([^)]+)\\)$/);
					if (m) { const p = m[1].split("/"); return p.length > 1 ? Number(p[1]) : 1; }
					return 1;
				};
				return {
					glass: document.documentElement.dataset.glass ?? null,
					intensity: getComputedStyle(document.documentElement).getPropertyValue("--lo-glass-a-surface").trim(),
					header: header ? {
						tag: header.tagName,
						text: (header.innerText || "").replace(/\\s+/g, " ").trim(),
						height: hr ? Math.round(hr.height * 100) / 100 : null,
						top: hr ? Math.round(hr.top * 100) / 100 : null,
						backgroundColor: cs.backgroundColor,
						alpha: alphaOf(cs.backgroundColor),
						backdropFilter: cs.backdropFilter,
						backdropFilterWebkit: cs.webkitBackdropFilter,
						position: cs.position,
						zIndex: cs.zIndex,
						isolation: cs.isolation,
						classes: String(header.className),
					} : null,
					scroller: {
						top: Math.round(sr.top * 100) / 100,
						bottom: Math.round(sr.bottom * 100) / 100,
						height: Math.round(sr.height * 100) / 100,
						scrollTop: scroller.scrollTop,
						scrollHeight: scroller.scrollHeight,
						clientHeight: scroller.clientHeight,
						overflowY: getComputedStyle(scroller).overflowY,
						paddingTop: getComputedStyle(scroller).paddingTop,
						clipOffsetBelowHeader: hr ? Math.round((hr.bottom - sr.top) * 100) / 100 : null,
					},
					rows: document.querySelectorAll('[data-tour-tag="file-row"]').length,
				};
			})()`);

			// THE CLIP GEOMETRY, and WHAT IS PAINTED IN THE HEADER'S BAND.
			//
			// The question is not "does the header have a fill" but "can a row
			// occupy the same pixels as the header's own label". So this reads the
			// header's box, the scroller's box, and the topmost element at the
			// label's own position - the pixels where text over text would land.
			const clip = await cdp.evaluate(`(() => {
				const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
				if (!scroller) return null;
				const header = scroller.querySelector("h3");
				if (!header) return null;
				const hr = header.getBoundingClientRect();
				const sr = scroller.getBoundingClientRect();
				const label = header.querySelector("button") || header;
				const lr = label.getBoundingClientRect();
				// The label's own centre, and a point just left of it: the band the
				// row would have to reach to collide with the text.
				const probe = (x, y) => {
					const els = document.elementsFromPoint(x, y).slice(0, 4).map((e) => ({
						tag: e.tagName.toLowerCase(),
						cls: String(e.className).slice(0, 60),
						tour: e.getAttribute("data-tour-tag"),
						text: (e.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40),
						bg: getComputedStyle(e).backgroundColor,
					}));
					return { x: Math.round(x), y: Math.round(y), els };
				};
				const mid = { x: Math.round(lr.left + lr.width / 2), y: Math.round(lr.top + lr.height / 2) };
				const left = { x: Math.round(lr.left - 6), y: Math.round(lr.top + lr.height / 2) };
				return {
					header: {
						top: Math.round(hr.top * 100) / 100,
						bottom: Math.round(hr.bottom * 100) / 100,
						height: Math.round(hr.height * 100) / 100,
					},
					scroller: {
						top: Math.round(sr.top * 100) / 100,
						bottom: Math.round(sr.bottom * 100) / 100,
						height: Math.round(sr.height * 100) / 100,
						clientTop: scroller.clientTop,
						paddingTop: getComputedStyle(scroller).paddingTop,
						overflowY: getComputedStyle(scroller).overflowY,
					},
					// THE CLIP OFFSET: how far the scroller's own clip edge sits
					// below the header's bottom edge. Zero means the scroller
					// paints content right up to the header's bottom, so a row can
					// reach the header's own pixels.
					clipOffsetBelowHeader:
						Math.round((sr.top - hr.bottom) * 100) / 100,
					// The header's band, relative to the scroller's clip edge: a
					// NEGATIVE number means the header sits above the scroller's
					// top, i.e. it overlays a region the scroller does not own.
					headerBandInsideScroller:
						Math.round((hr.bottom - sr.top) * 100) / 100,
					atLabel: probe(mid.x, mid.y),
					leftOfLabel: probe(left.x, left.y),
					headerIsInsideScroller: scroller.contains(header),
				};
			})()`);

			// FRAME TIMES while the list scrolls.
			//
			// The measurement is ARMED IN THE PAGE and polled, never awaited
			// through one CDP call: a hidden window can throttle
			// `requestAnimationFrame`, and an awaited promise would then hang
			// until the CDP timeout rather than report a number. The arming
			// returns immediately; the reading is collected afterwards.
			await cdp.evaluate(`(() => {
				const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
				if (!scroller) { window.__frameProbe = { error: "no scroller" }; return true; }
				/*
				 * CLEAR THE PREVIOUS PROBE. The reading loop below polls for the
				 * probe to be set, and the probe only sets it when the scroll
				 * drive FINISHES - so without this reset, the second intensity's
				 * poll finds the FIRST intensity's result still in place and
				 * reports it verbatim. Two identical frame numbers in consecutive
				 * rows is the symptom, and it means the second row measured
				 * nothing.
				 */
				window.__frameProbe = null;
				const samples = [];
				/*
				 * THE PLATFORM'S OWN FRAME METRIC, the same observer the repo's
				 * mesh bench rides (scripts/mesh-canvas-bench.mjs). It reports the
				 * frames the engine judged LONG, which is the question this
				 * measurement asks: did the scroll drop frames?
				 *
				 * The rAF deltas beside it are the DENOMINATOR - they count every
				 * frame, including the ones the observer does not report - so a
				 * "zero long frames" result cannot be a run that painted once.
				 */
				const platform = [];
				let observerError = null;
				try {
					const observer = new PerformanceObserver((list) => {
						for (const entry of list.getEntries()) {
							platform.push({
								duration: Math.round(entry.duration * 100) / 100,
								blocking: Math.round((entry.blockingDuration ?? entry.duration) * 100) / 100,
							});
						}
					});
					observer.observe({ type: "long-animation-frame", buffered: true });
				} catch (error) {
					observerError = String(error);
				}
				let last = performance.now();
				let stop = false;
				const tick = () => {
					const now = performance.now();
					samples.push(now - last);
					last = now;
					if (!stop) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
				const start = scroller.scrollTop;
				let step = 0;
				const drive = () => {
					if (step >= 90 || stop) {
						stop = true;
						window.__frameProbe = { samples, platform, observerError };
						return;
					}
					scroller.scrollTop = start + step * 6;
					step += 1;
					requestAnimationFrame(drive);
				};
				requestAnimationFrame(drive);
				return true;
			})()`);
			// Poll for the probe to land. A hidden window that never paints
			// leaves it unset, and the run says so rather than reporting a
			// number it did not measure.
			let frames = null;
			for (let i = 0; i < 400; i += 1) {
				const probe = await cdp
					.evaluate("window.__frameProbe ? window.__frameProbe : null")
					.catch(() => null);
				if (probe) {
					const sorted = (probe.samples ?? []).slice(2).sort((a, b) => a - b);
					const at = (q) =>
						sorted.length
							? Math.round(sorted[Math.floor(sorted.length * q)] * 100) / 100
							: null;
					frames = {
						count: sorted.length,
						medianMs: at(0.5),
						p95Ms: at(0.95),
						maxMs: sorted.length
							? Math.round(sorted[sorted.length - 1] * 100) / 100
							: null,
						longFrames: sorted.filter((v) => v > 32).length,
						// The span the samples cover. A throttled page yields FEW
						// frames over a LONG span; a page painting at cadence
						// yields many over a short one. The COUNT beside it is
						// what tells the two apart, so a reader never has to
						// infer one from the other.
						elapsedMs: sorted.length
							? Math.round(sorted.reduce((a, b) => a + b, 0))
							: null,
					};
					// The platform's own verdict on the same scroll: how many
					// frames it judged long, and how long the worst one took.
					const platform = probe.platform ?? [];
					frames.platformLongFrames = platform.length;
					frames.platformWorstMs = platform.length
						? Math.max(...platform.map((f) => f.duration))
						: null;
					frames.platformMedianMs = platform.length
						? Math.round(
								[...platform]
									.sort((a, b) => a.duration - b.duration)[
									Math.floor(platform.length / 2)
								].duration * 100,
							) / 100
						: null;
					if (probe.observerError) frames.observerError = probe.observerError;
					break;
				}
				await sleep(250);
			}

			// MID-SCROLL, with a thumbnail boundary crossing the header band.
			//
			// The tiles are the `li` elements of the grid; the `file-row` marker
			// sits on a cell INSIDE a tile, so the tile's own box is the thing
			// whose edge must cross the band. The scroll offset is chosen so a
			// tile's TOP edge lands in the MIDDLE of the band: that is the
			// position where the defect is worst, because the tile's sharp
			// corner and the header's label are at the same height.
			const scrolled = await cdp.evaluate(`(() => {
				const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
				if (!scroller) return null;
				const header = scroller.querySelector('h3');
				if (!header) return null;
				const hr = header.getBoundingClientRect();
				const tiles = [...scroller.querySelectorAll('ul[data-tour-tag="files-grid"] > li')];
				if (tiles.length === 0) return { error: "no grid tiles" };
				// The tile nearest the band, and the offset that brings its top
				// edge to the band's middle.
				const target = hr.top + hr.height / 2;
				let best = null;
				for (const tile of tiles) {
					const tr = tile.getBoundingClientRect();
					const delta = target - tr.top;
					if (delta <= 0) continue;
					if (best === null || delta < best.delta) {
						best = { delta, id: tile.getAttribute("data-file-id") ?? tile.textContent.trim().slice(0, 24) };
					}
				}
				if (!best) return { error: "no tile edge reachable" };
				scroller.scrollTop += best.delta;
				scroller.dispatchEvent(new Event("scroll"));
				return { delta: Math.round(best.delta * 100) / 100, id: best.id };
			})()`);
			await sleep(900);

			const frame = await capture(cdp, `files-${LABEL}-${theme}-i${intensity}`, {
				assertPalette: false,
			});

			report.runs.push({
				theme,
				intensity,
				reading,
				clip,
				frames,
				scrolled,
				frame: frame.path ?? frame,
			});
			console.log(
				`[${LABEL}/${theme}/i${intensity}] headerAlpha=${reading.header?.alpha} backdrop=${reading.header?.backdropFilter} h=${reading.header?.height} bandInsideScroller=${clip?.headerBandInsideScroller} clipBelowHeader=${clip?.clipOffsetBelowHeader} atLabel=${clip?.atLabel?.els?.[0]?.tour ?? clip?.atLabel?.els?.[0]?.tag} frameMedian=${frames?.medianMs}ms p95=${frames?.p95Ms}ms`,
			);
		}
	}
} catch (error) {
	report.error = String(error);
	console.error("[rig] failed:", error);
	code = 1;
} finally {
	reapLiveBoots();
	writeFileSync(join(OUT, `report-${LABEL}.json`), JSON.stringify(report, null, 2));
}
process.exit(code);
