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
// THE FIELD HOLDS ONE LINE OF INK. Everything else is blank lines, so the red glyphs inside
// the chip box's own columns can only be the marker the chip covers - at any displacement.
// With ordinary filler prose the other lines look like the marker and a shift is only defined
// modulo the line pitch (the first version of this rig folded it into [0, 17), which could
// not report a lag of 17px or more nor tell a trailing chip from a leading one: QA round 1,
// Q1). The marker is kept exactly as the composer writes it so its payload still backs it.
const MARKER_TEXT = `${"\n".repeat(12)}deploy with [Credential #1, 19 chars] to the staging box${"\n".repeat(16)}`;
const FALLBACK = process.env.FALLBACK === "1"; // negative control: switch the scroll-driven animation off
const results = { label, speeds: {} };
try {
	await openStory(cdp, STORY, { width: 1024, height: 300 });
	await sleep(600);
	await evaluate(
		cdp,
		`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(TEST_CSS + (FALLBACK ? "[data-credential-chips]{animation:none !important}" : ""))}; document.head.appendChild(s); })()`,
	);
	// Blank lines above and below the marker so the chip has a long run of visible travel.
	await evaluate(
		cdp,
		`(() => { const f = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, ${JSON.stringify(MARKER_TEXT)}); f.dispatchEvent(new Event('input', { bubbles: true })); })()`,
	);
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
	const analyse = (png, band) => {
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
		// The marker's own ink: the first red row, inside the field, in the columns the chip
		// box spans. The field holds no other ink there (see MARKER_TEXT), so this is the
		// marker at any displacement, and `textTop - g0` is where the text sits in the box.
		let textTop = -1;
		for (
			let y = Math.max(0, Math.ceil(band[0]));
			y < Math.min(h, Math.floor(band[1]));
			y++
		) {
			let n = 0;
			for (let x = bx0 + 3; x < bx1 - 3; x++) if (red(x, y)) n++;
			if (n >= 3) {
				textTop = y;
				break;
			}
		}
		return textTop < 0 ? null : { g0, g1, bx0, bx1, textTop };
	};
	const { readFileSync } = await import("node:fs");
	for (const speed of Object.keys(results.speeds)) {
		const R = results.speeds[speed];
		const band = [R.start.rect[1], R.start.rect[1] + R.start.rect[3]];
		const tmpl = analyse(
			readFileSync(`${outdir}/${label}-rest-${speed}.png`),
			band,
		);
		R.templateBox = tmpl && { g0: tmpl.g0, g1: tmpl.g1 };
		const per = [];
		for (const f of R.frameData) {
			const a = analyse(Buffer.from(f.data, "base64"), band);
			if (!a || !tmpl) {
				per.push({ t: f.t, chip: false });
				continue;
			}
			// Where the text sits in the box, against the same measure at rest: positive means the
			// text is LOWER in the box than it was. Signed and unbounded, no fold.
			const bs = a.textTop - a.g0 - (tmpl.textTop - tmpl.g0);
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
		// SIGNED, UNFOLDED LAG. `textShiftVsBox` (s) is where the text sits relative to the
		// chip box, against the same frame at rest: s > 0 means the text is LOWER in the box
		// than at rest. Which way that is "behind" depends on the direction of travel: scrolling
		// down moves the text up and a trailing chip is left BELOW it (s < 0); scrolling up is
		// the mirror. So the lag is s times the sign of the box's own travel, positive when the
		// chip TRAILS the text and negative when it LEADS it.
		const travel = per
			.filter((p) => p.chip)
			.map((p) => p.boxTop - tmpl.g0)
			.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0);
		R.travelPx = travel;
		const dir = Math.sign(travel) || 1;
		for (const p of per) {
			if (p.chip) p.lagPx = p.textShiftVsBox * dir;
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
		R.maxLagPx = Math.max(0, ...lags.map(Math.abs));
		R.maxTrailPx = Math.max(0, ...lags);
		R.maxLeadPx = Math.max(0, ...lags.map((v) => -v));
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
