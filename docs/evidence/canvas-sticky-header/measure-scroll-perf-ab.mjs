/*
 * THE FRAME-COST A/B, measured so that machine load cannot lie.
 *
 * THE PROBLEM WITH THE OBVIOUS MEASUREMENT. A backdrop-filter on a sticky
 * header over a 342-item grid is exactly the kind of change that can cost
 * frames, so the cost has to be measured. But this machine carries other
 * sessions: a frame-time sample taken now and one taken ten minutes later
 * differ by more than the effect being tested, and a run that came back
 * SLOWER is not evidence that the filter is slow - it is evidence that the
 * machine was busy. The first control run in this session showed precisely
 * that inversion: the variant WITHOUT the filter measured 105ms median and
 * the one WITH it measured 27ms, on a load average of 64.
 *
 * WHAT THIS DOES INSTEAD. One app session, and the two variants are measured
 * ALTERNATELY, several rounds, in the same process, minutes apart from
 * nothing. Every sample of both variants therefore carries the same
 * contention, and the comparison is between the variants rather than between
 * two moments.
 *
 * THE ORDER ALTERNATES. Round 1 measures ON then OFF, round 2 measures OFF
 * then ON, and so on, so that a machine that gets busier (or quieter) over
 * the run cannot bias one variant systematically.
 *
 * THE HEADLINE NUMBER IS THE MINIMUM, not the median. The minimum is the
 * sample that met the least contention - the closest the machine came to
 * being idle during the run - so the two minima are the two variants'
 * intrinsic costs. The median is reported too, because a filter that is fine
 * on the best sample and ruinous on the median is a real defect: a
 * scroll this heavy does not always get an idle machine.
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
const ROUNDS = Number(arg("--rounds", "5"));
const SAMPLES = Number(arg("--samples", "60"));
/*
 * FINE MODE, and why the round mode is not enough on a shared machine.
 *
 * A round measures one variant, then the other, seconds apart. When the host
 * is drifting - this one went from a 229ms median to a 21ms median across
 * seven rounds, a tenfold change - a round's two halves are already two
 * different machines, and the median of the per-round deltas moves with the
 * drift rather than with the filter (the same rig returned -20ms in one run
 * and +19ms in the next, with the sign of every late round flipped).
 *
 * Fine mode alternates the variant EVERY SEGMENT, so a paired delta is
 * between two measurements a fraction of a second apart: whatever the host
 * is doing, it is doing it to both halves of the pair. The cost of that is
 * fewer samples per segment, and the product is a distribution of adjacent
 * paired deltas whose median is the filter's cost and whose spread is the
 * host's noise.
 */
const FINE = process.argv.includes("--fine");
const SEGMENTS = Number(arg("--segments", "24"));
const SEG_SAMPLES = Number(arg("--seg-samples", "24"));

if (!BACKEND || !SESSION || !OUT) {
	console.error("needs --backend --session --out");
	process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({ armed: true, logName: "app-perf-ab.log", tag: "perf-ab" });

const report = { rounds: ROUNDS, samples: SAMPLES, on: [], off: [] };
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
	await sleep(1500);

	// The sign-in modal is a fixed overlay that swallows the app's clicks.
	await cdp.evaluate(`(() => {
		const skip = [...document.querySelectorAll("button")].find(
			(b) => (b.textContent || "").trim() === "Skip for now",
		);
		if (skip) { skip.click(); return true; }
		return false;
	})()`);
	await sleep(800);

	/*
	 * THE TOGGLE. One style element whose presence turns the filter OFF.
	 * The shipped rule stays in the stylesheet untouched in both variants -
	 * the control only overrides the one property under test.
	 */
	const TOGGLE = `
[data-glass-plane="band-backdrop"] {
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
`;

	const setFilter = async (on) => {
		await cdp.evaluate(`(() => {
			const existing = document.getElementById("perf-ab-toggle");
			if (${on}) {
				if (existing) existing.remove();
				return true;
			}
			if (!existing) {
				const style = document.createElement("style");
				style.id = "perf-ab-toggle";
				style.textContent = ${JSON.stringify(TOGGLE)};
				document.head.appendChild(style);
			}
			return true;
		})()`);
		await sleep(400);
	};

	const measure = async (n = SAMPLES) => {
		await cdp.evaluate(`(() => {
			const scroller = document.querySelector('[data-tour-tag="files-scroller"]');
			if (!scroller) { window.__abProbe = { error: "no scroller" }; return true; }
			window.__abProbe = null;
			const samples = [];
			let last = performance.now();
			let stop = false;
			const tick = () => {
				const now = performance.now();
				samples.push(now - last);
				last = now;
				if (!stop) requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
			let step = 0;
			const drive = () => {
				scroller.scrollTop += 7;
				step += 1;
				if (step < ${n}) {
					setTimeout(drive, 16);
				} else {
					stop = true;
					window.__abProbe = { samples };
				}
			};
			drive();
			return true;
		})()`);
		for (let i = 0; i < 600; i += 1) {
			const v = await cdp.evaluate("window.__abProbe ? window.__abProbe : null");
			if (v && v.samples) return v.samples;
			await sleep(100);
		}
		return [];
	};

	const stats = (samples) => {
		if (!samples.length) return null;
		const sorted = [...samples].sort((a, b) => a - b);
		const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
		return {
			count: sorted.length,
			min: Math.round(sorted[0] * 10) / 10,
			p25: Math.round(at(0.25) * 10) / 10,
			median: Math.round(at(0.5) * 10) / 10,
			p75: Math.round(at(0.75) * 10) / 10,
			p95: Math.round(at(0.95) * 10) / 10,
			max: Math.round(sorted[sorted.length - 1] * 10) / 10,
		};
	};

	if (FINE) {
		const segments = [];
		for (let s = 0; s < SEGMENTS; s += 1) {
			const variant = s % 2 === 0 ? "on" : "off";
			await setFilter(variant === "on");
			const st = stats(await measure(SEG_SAMPLES));
			if (!st) continue;
			segments.push({ segment: s, variant, ...st });
			console.log(`[perf/seg${s}/${variant}] median=${st.median}ms p25=${st.p25}ms p95=${st.p95}ms n=${st.count}`);
		}
		/*
		 * PAIR ADJACENT SEGMENTS. Each pair is one `on` and one `off` measured
		 * back to back, in whichever order the alternation gave; the delta is
		 * always on-minus-off so its sign means the same thing every time.
		 */
		const pairs = [];
		for (let i = 1; i < segments.length; i += 1) {
			const a = segments[i - 1];
			const b = segments[i];
			if (a.variant === b.variant) continue;
			const on = a.variant === "on" ? a : b;
			const off = a.variant === "on" ? b : a;
			pairs.push({
				onMedian: on.median,
				offMedian: off.median,
				delta: Math.round((on.median - off.median) * 10) / 10,
				p25Delta: Math.round((on.p25 - off.p25) * 10) / 10,
			});
		}
		const med = (list) => {
			const x = [...list].sort((m, n) => m - n);
			return x.length ? Math.round(x[Math.floor(x.length / 2)] * 10) / 10 : null;
		};
		report.segments = segments;
		report.pairs = pairs;
		report.fineSummary = {
			pairs: pairs.length,
			medianDelta: med(pairs.map((p) => p.delta)),
			p25Delta: med(pairs.map((p) => p.p25Delta)),
			deltas: pairs.map((p) => p.delta),
		};
		console.log(`[perf/fine] ${pairs.length} adjacent pairs; median delta ${report.fineSummary.medianDelta}ms, median p25 delta ${report.fineSummary.p25Delta}ms`);
		console.log(`[perf/fine] deltas: ${report.fineSummary.deltas.join(", ")}`);
		writeFileSync(join(OUT, "perf-ab.json"), JSON.stringify(report, null, "\t"));
		process.exit(0);
	}
	for (let round = 1; round <= ROUNDS; round += 1) {
		// The order alternates so a drifting machine cannot bias a variant.
		const order = round % 2 === 1 ? ["on", "off"] : ["off", "on"];
		for (const variant of order) {
			await setFilter(variant === "on");
			const samples = await measure();
			const s = stats(samples);
			report[variant].push({ round, ...s });
			console.log(
				`[perf/r${round}/${variant}] ${s ? `min=${s.min}ms p25=${s.p25}ms median=${s.median}ms p95=${s.p95}ms max=${s.max}ms n=${s.count}` : "no samples"}`,
			);
		}
	}

	/*
	 * THE PAIRED DELTA IS THE STATISTIC.
	 *
	 * Comparing the two variants' best samples is not a comparison: the
	 * minimum of a rAF-delta series is near zero on any machine, because a
	 * frame that was already queued reports almost no time between ticks. The
	 * useful number is the DIFFERENCE WITHIN a round, where the two variants
	 * were measured seconds apart under the same contention. The median of
	 * those paired deltas is the cost of the filter, and its spread is the
	 * noise floor the cost has to beat to mean anything.
	 */
	const median = (list) => {
		if (!list.length) return null;
		const s = [...list].sort((a, b) => a - b);
		const mid = Math.floor(s.length / 2);
		return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
	};
	const paired = [];
	for (const round of report.on) {
		const off = report.off.find((r) => r.round === round.round);
		if (!off) continue;
		paired.push({
			round: round.round,
			medianDelta: Math.round((round.median - off.median) * 10) / 10,
			p25Delta: Math.round((round.p25 - off.p25) * 10) / 10,
			p95Delta: Math.round((round.p95 - off.p95) * 10) / 10,
			onMedian: round.median,
			offMedian: off.median,
		});
	}
	const deltas = paired.map((p) => p.medianDelta);
	report.paired = paired;
	report.summary = {
		pairedMedianDelta: median(deltas),
		pairedP25Delta: median(paired.map((p) => p.p25Delta)),
		pairedP95Delta: median(paired.map((p) => p.p95Delta)),
		pairedDeltas: deltas,
		onMedians: report.on.map((r) => r.median),
		offMedians: report.off.map((r) => r.median),
	};
	console.log("");
	for (const p of paired) {
		console.log(
			`[perf/pair r${p.round}] on median=${p.onMedian}ms off median=${p.offMedian}ms delta=${p.medianDelta >= 0 ? "+" : ""}${p.medianDelta}ms`,
		);
	}
	console.log(
		`[perf/summary] COST of the filter, as the median of the per-round paired deltas: ${report.summary.pairedMedianDelta >= 0 ? "+" : ""}${report.summary.pairedMedianDelta}ms (p25 ${report.summary.pairedP25Delta}ms, p95 ${report.summary.pairedP95Delta}ms)`,
	);
	console.log(
		`[perf/summary] a 16.7ms frame at 60Hz; the filter's cost is ${
			Math.abs(report.summary.pairedMedianDelta) < 16.7
				? "under one frame"
				: "MORE THAN ONE FRAME"
		}.`,
	);

	writeFileSync(join(OUT, "perf-ab.json"), JSON.stringify(report, null, "\t"));
} catch (error) {
	console.error(`[perf] failed: ${error?.stack ?? error}`);
	code = 1;
} finally {
	try {
		await reapLiveBoots();
	} catch {
		/* nothing to reap */
	}
}
process.exit(code);
