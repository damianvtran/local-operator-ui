// Measures how far the composer's chip trails the textarea's own text during a
// COMPOSITOR-DRIVEN scroll (real wheel gesture over CDP), from real presented frames.
// usage: node lag.mjs <label> <outdir>
import { mkdirSync, writeFileSync } from "node:fs";
import {
	Cdp,
	decodePng,
	evaluate,
	launch,
	openStory,
	shot,
	sleep,
	teardown,
} from "./lib.mjs";
const [label = "run", outdir = "."] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const cdp = await launch();
const STORY = "chat-message-input--credential-pill-scrolled";
const TEST_CSS = `
textarea { color: #ff0000 !important; caret-color: transparent !important; }
div[aria-hidden='true'].-z-10 { visibility: hidden !important; }
[data-credential-chips] span[title] { background: transparent !important; outline: 1px solid #00ff00 !important; border-radius: 0 !important; }
[data-credential-chips] span[title] * { visibility: hidden !important; }
`;
const FALLBACK = process.env.FALLBACK === "1"; // negative control: switch the scroll-driven animation off
const results = { label, speeds: {} };
try {
	await openStory(cdp, STORY, { width: 1024, height: 300 });
	await sleep(600);
	await evaluate(
		cdp,
		`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(TEST_CSS + (FALLBACK ? "[data-credential-chips]{animation:none !important}" : ""))}; document.head.appendChild(s); })()`,
	);
	// Put the marker in the MIDDLE of the buffer so the chip has a long run of visible travel.
	await evaluate(
		cdp,
		`(() => { const f = document.querySelector('textarea'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); })()`,
	);
	await cdp.send("Input.insertText", {
		text: `\n${Array.from(
			{ length: 16 },
			(_, i) => `tail line ${i + 1} of trailing prose here`,
		).join("\n")}`,
	});
	await sleep(300);
	const setup = `(async () => {
		const f = document.querySelector('textarea');
		f.setSelectionRange(0, 0);
		const run = document.querySelector('[data-credential-run]');
		f.scrollTop = Math.max(0, run.offsetTop - 8);
		f.dispatchEvent(new Event('scroll'));
		await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		await new Promise(r => setTimeout(r, 200));
		const r = f.getBoundingClientRect();
		return { scrollTop: f.scrollTop, max: f.scrollHeight - f.clientHeight, x: r.left + r.width / 2, y: r.top + r.height / 2, rect: [r.left, r.top, r.width, r.height], chips: document.querySelectorAll('[data-credential-chips] span[title]').length };
	})()`;
	for (const speed of [240, 480]) {
		const st = await evaluate(cdp, setup);
		await sleep(300);
		// rest frame (template)
		const restShot = `${outdir}/${label}-rest-${speed}.png`;
		await shot(cdp, restShot);
		const frames = [];
		cdp.on("Page.screencastFrame", (p) => {
			frames.push({ t: p.metadata.timestamp, data: p.data });
			cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId });
		});
		await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
		await sleep(100);
		await cdp.send("Input.synthesizeScrollGesture", {
			x: st.x,
			y: st.y,
			yDistance: 85,
			speed,
			gestureSourceType: "mouse",
			preventFling: true,
		});
		await sleep(250);
		await cdp.send("Page.stopScreencast");
		const after = await evaluate(
			cdp,
			`document.querySelector('textarea').scrollTop`,
		);
		results.speeds[speed] = {
			start: st,
			endScrollTop: after,
			frames: frames.length,
			fps: null,
			frameData: frames,
		};
	}
	// Analysis
	const analyse = (png) => {
		const { w, h, bpp, px } = decodePng(png);
		const at = (x, y) => {
			const i = (y * w + x) * bpp;
			return [px[i], px[i + 1], px[i + 2]];
		};
		const green = (x, y) => {
			const [r, g, b] = at(x, y);
			return g > 200 && r < 80 && b < 80;
		};
		const red = (x, y) => {
			const [r, g, b] = at(x, y);
			return r > 190 && g < 90 && b < 90;
		};
		// chip box: rows whose green run is long (top and bottom outline edges)
		const rows = [];
		for (let y = 0; y < h; y++) {
			let n = 0;
			let x0 = -1;
			let x1 = -1;
			for (let x = 0; x < w; x++)
				if (green(x, y)) {
					n++;
					if (x0 < 0) x0 = x;
					x1 = x;
				}
			if (n >= 40) rows.push({ y, x0, x1 });
		}
		if (rows.length < 2) return null;
		const g0 = rows[0].y;
		const g1 = rows[rows.length - 1].y;
		const bx0 = rows[0].x0;
		const bx1 = rows[0].x1;
		const prof = new Array(120).fill(0); // y' = y - g0 + 40
		for (let y = Math.max(0, g0 - 40); y < Math.min(h, g0 + 80); y++) {
			let n = 0;
			for (let x = bx0 + 3; x < bx1 - 3; x++) if (red(x, y)) n++;
			prof[y - g0 + 40] = n;
		}
		return { g0, g1, bx0, bx1, prof };
	};
	const corr = (a, b, s) => {
		let c = 0;
		for (let i = 0; i < a.length; i++) {
			const j = i - s;
			if (j >= 0 && j < b.length) c += a[i] * b[j];
		}
		return c;
	};
	const { readFileSync } = await import("node:fs");
	for (const speed of Object.keys(results.speeds)) {
		const R = results.speeds[speed];
		const tmpl = analyse(readFileSync(`${outdir}/${label}-rest-${speed}.png`));
		R.templateBox = tmpl && { g0: tmpl.g0, g1: tmpl.g1 };
		const per = [];
		for (const f of R.frameData) {
			const a = analyse(Buffer.from(f.data, "base64"));
			if (!a || !tmpl) {
				per.push({ t: f.t, chip: false });
				continue;
			}
			let best = 0;
			let bs = 0;
			for (let s = -16; s <= 16; s++) {
				const c = corr(a.prof, tmpl.prof, s);
				if (c > best) {
					best = c;
					bs = s;
				}
			}
			per.push({
				t: +f.t.toFixed(4),
				chip: true,
				boxTop: a.g0,
				boxH: a.g1 - a.g0,
				textShiftVsBox: bs,
			});
		}
		R.perFrame = per;
		R.frameData = undefined;
		// The filler lines repeat every 17px (one line pitch), so a shift is only defined modulo 17; the chip can only TRAIL
		// the text here (it is repositioned after the textarea already moved), so the lag is the shift folded into [0,17).
		for (const p of per) {
			if (p.chip) p.lagPx = ((p.textShiftVsBox % 17) + 17) % 17;
		}
		const moving = per.filter(
			(p, i) =>
				p.chip && i > 0 && per[i - 1].chip && p.boxTop !== per[i - 1].boxTop,
		);
		R.chipStepPx = moving.map((p) => p.boxTop - per[per.indexOf(p) - 1].boxTop);
		const lags = per
			.filter((p) => p.chip && p.lagPx !== undefined)
			.map((p) => p.lagPx);
		const ts = per.map((p) => p.t);
		R.fps =
			ts.length > 1
				? +((ts.length - 1) / (ts[ts.length - 1] - ts[0])).toFixed(1)
				: null;
		R.framesWithChip = lags.length;
		R.maxLagPx = Math.max(0, ...lags);
		R.medianLagPx = lags.slice().sort((a, b) => a - b)[
			Math.floor(lags.length / 2)
		];
		R.meanLagPx = lags.length
			? +(lags.reduce((a, b) => a + b, 0) / lags.length).toFixed(2)
			: null;
	}
	writeFileSync(
		`${outdir}/${label}-lag.json`,
		JSON.stringify(results, null, 1),
	);
	for (const [s, R] of Object.entries(results.speeds))
		console.log(
			label,
			"speed",
			s,
			"px/s: frames",
			R.frames,
			"fps",
			R.fps,
			"framesWithChip",
			R.framesWithChip,
			"maxLagPx",
			R.maxLagPx,
			"meanLagPx",
			R.meanLagPx,
			"medianLagPx",
			R.medianLagPx,
			"chipStepPx(median)",
			R.chipStepPx.slice().sort((a, b) => a - b)[
				Math.floor(R.chipStepPx.length / 2)
			],
			"scrollTop",
			R.start.scrollTop,
			"->",
			R.endScrollTop,
			"box",
			JSON.stringify(R.templateBox),
		);
} finally {
	teardown();
}
