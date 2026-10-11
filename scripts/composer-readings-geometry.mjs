#!/usr/bin/env node
/**
 * Measures and photographs the composer row's readings strip against its
 * controls, at chosen chat-column widths, in the idle and running states.
 *
 *     node scripts/composer-readings-geometry.mjs [--json] [--out=<dir>]
 *         [--label=<tree>] [--only=<case>] [--themes=dark|both]
 *
 * WHY THIS EXISTS. Issue #788 is a geometry defect with a number in it: the
 * duration reading's shed band
 * (`@min-[750px]/chatcol:@max-[860px]/chatcol:hidden`) was derived against the
 * IDLE controls group (mic + Send, 68px), but while a turn runs the composer
 * draws a third 32px danger Square (Stop), and Send is not removed - so the group
 * is mic + Stop + Send. The claim to verify is therefore "at THIS width, in THIS
 * state, the readings' right edge is past the controls' left edge" (or the row
 * overflows its box), and that is a pair of rectangles rather than a look. A still
 * shows the symptom; this rig reads the cause off `getBoundingClientRect` in the
 * same rendered state the frames are taken from, so the numbers and the pictures
 * describe ONE layout.
 *
 * BOTH TREES, ONE RIG. The before/after pair is only a controlled comparison if
 * both halves are taken by the same rig, at the same viewport, from the same
 * harness, in the same run - which is why the harness and this file are copied
 * verbatim into the base worktree rather than each tree owning a story. The
 * driver takes `--out` and `--label` so the two runs write into two directories
 * that a reviewer can read side by side.
 *
 * Raw CDP against a private headless Chrome, the same approach and the same
 * launch discipline as `chat-measure-evidence.mjs` and `composer-alert-geometry.mjs`:
 * a scratch `--user-data-dir`, the mock keychain `scripts/chrome-keychain.mjs`
 * installs so this rig cannot reach the operator's keychain, killed by exact pid
 * on exit, and no browser-automation dependency added to the repo.
 *
 * WHAT IT CANNOT SEE. Focus-dependent rendering (carets, `:focus-visible` rings)
 * - a headless window is never focused - and the post-stop GRACE window's
 * reserved slot, which opens on a TRANSITION rather than a mount (the running row
 * draws the same third box the reservation draws invisibly; the harness page's
 * header states that, and `scripts/interrupt-esc-proof.mjs` is where the window's
 * own transition is exercised against the live app).
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";

const RIG = dirname(fileURLToPath(import.meta.url));
const ROOT = join(RIG, "..");
const ARGS = process.argv.slice(2);
const AS_JSON = ARGS.includes("--json");
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
/* A comma-separated list, so one run can carry the case set the frames need
   rather than every (state, fixture, width) the sweep can produce. */
const ONLY = flag("only") ? flag("only").split(",") : null;
const LABEL = flag("label") ?? "tree";
const OUT_DIR = flag("out");
const THEME_MODE = flag("themes") ?? "dark";
const PORT = Number(flag("port") ?? 5431);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome announces its debug port on stderr; this is that line. */
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * THE WIDTHS. Three bands and the discriminating width:
 *
 *   700   below the shed band's lower edge (`@max-[750px]`), where the duration
 *         reading is shown in BOTH states - the control for "the narrow end is
 *         unchanged".
 *   800   inside the existing band, where the reading is shed in both states -
 *         the control for "the band still does its job".
 *   840   just under the existing 860 edge.
 *   880   the DISCRIMINATING width: above the existing 860 edge, where the idle
 *         row fits the duration reading but the running row (three controls) does
 *         not. This is the width the defect is visible at.
 *   900   the strip's own comment measures the fullest cluster at 900 - kept so
 *         the rig's numbers are comparable with the comment's arithmetic.
 *   1024  the composer's own measure (the stories' column), where both states
 *         should fit after the fix.
 */
const WIDTHS = flag("widths")
	? flag("widths").split(",").map(Number)
	: [700, 800, 840, 860, 880, 900, 1024];

/** The two states the row can be photographed in. */
const STATES = ["idle", "running"];

/** The two readings fixtures: the cheaper state and the one that sets the threshold. */
const READING_FIXTURES = ["plain", "issue", "fullest"];

const THEMES =
	THEME_MODE === "both"
		? ["localOperatorDark", "localOperatorLight"]
		: ["localOperatorDark"];

/**
 * The probe.
 *
 * Selectors, and why none of them is the row's own class string:
 *  - the readings cluster is `[data-lo-session-strip]`, the strip's own QA hook;
 *  - the ROW is that element's PARENT, which is exact because the strip's
 *    `ErrorBoundary` renders its children without a wrapper (a `fallback={null}`
 *    boundary that succeeded contributes no DOM of its own);
 *  - the CONTROLS group is the row's LAST element child, which is what the row's
 *    own comment describes (`order-3`, mic and Send last);
 *  - the DURATION reading is found by its accessible name, `Active time: ...`,
 *    which is the one label only it carries.
 *
 * A reading is VISIBLE when its box has a non-zero width AND its nearest
 * `[data-lo-session-strip]` ancestor is not `visibility: hidden` - the shed is a
 * `display: none` (`hidden`), so a shed reading measures 0x0 and is not laid out
 * at all. `durationShown` below is that test, and it is what makes "the shed is
 * doing the right thing" a reading rather than a caption.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return {
			left: round(r.left),
			right: round(r.right),
			width: round(r.width),
			top: round(r.top),
			height: round(r.height),
		};
	};
	const isBox = (el) => {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0.5 && r.height > 0.5;
	};
	/*
	 * THE ROW'S FLEX ITEMS, with the \`display: contents\` wrappers dissolved.
	 *
	 * The composer's attach+chip group and its controls group are BOTH inside one
	 * \`display: contents\` wrapper, so the row's direct element children are
	 * [readings, wrapper] while the row's flex children are [attachGroup, readings,
	 * controls] in paint order. A probe that read the DOM children directly would
	 * measure the wrapper (0x0) as "the controls" - which read as "the row never
	 * became measurable" the first time this rig ran.
	 */
	const dissolve = (parent) => {
		const out = [];
		for (const el of parent.children) {
			if (getComputedStyle(el).display === "contents") out.push(...dissolve(el));
			else out.push(el);
		}
		return out;
	};
	const strip = document.querySelector("[data-lo-session-strip]");
	const row = strip ? strip.parentElement : null;
	const items = row ? dissolve(row) : [];
	/*
	 * The CONTROLS are identified by what they carry rather than by position, so a
	 * change to the row's ordering cannot silently move what this measures.
	 */
	const controls =
		items.find((el) =>
			el.querySelector(
				'button[aria-label="Send message"], button[aria-label="Stop"], button[aria-label="Stop agent"]',
			),
		) ?? null;
	const attach = items.find((el) => el !== strip && el !== controls) ?? null;
	const chip = document.querySelector("[data-lo-cwd-chip]");
	/*
	 * The DURATION reading, by its accessible name - the one label only it carries.
	 * A reading is VISIBLE when it has a box at all: the shed is \`display: none\`
	 * (\`hidden\`), so a shed reading is not laid out and measures 0x0.
	 */
	const duration = document.querySelector('[aria-label^="Active time:"]');
	const readings = strip
		? [...strip.children]
				.filter((el) => el.nodeType === 1)
				.map((el) => {
					const label = el.getAttribute("aria-label") ?? "";
					const kind = label.startsWith("Active time:")
						? "duration"
						: label.startsWith("Model:")
							? "model"
							: label.startsWith("Reasoning")
								? "effort"
								: label.startsWith("Context")
									? "context"
									: "cost";
					return {
						kind,
						text: (el.textContent ?? "").trim().slice(0, 40),
						shown: isBox(el),
						box: rect(el),
					};
				})
		: [];
	/*
	 * THE CONTAINER THE SHED QUERY ACTUALLY RESOLVES AGAINST.
	 *
	 * The strip's shed classes - the band's, and the narrow ladder's since issue
	 * #918 (\`docs/evidence/composer-readings-shed/\`) - all resolve against the
	 * nearest ancestor container NAMED \`chatcol\` - and
	 * that is NOT the pane the harness sizes. The composer's own band element
	 * (\`data-lo-composer-band\`) is itself \`@container/chatcol\` and carries
	 * \`px-6\`, and container queries measure the CONTAINER'S CONTENT BOX, so the
	 * effective number is the column MINUS the band's 48px inset. Recording it is
	 * what keeps the threshold arithmetic honest: a threshold stated against the
	 * column and a threshold stated against the box the query sees differ by 48.
	 */
	let queryContainer = null;
	for (let el = strip; el; el = el.parentElement) {
		const cs = getComputedStyle(el);
		if ((cs.containerName || "").includes("chatcol")) {
			const r = el.getBoundingClientRect();
			queryContainer = {
				box: rect(el),
				contentWidth: round(
					el.clientWidth -
						Number.parseFloat(cs.paddingLeft || "0") -
						Number.parseFloat(cs.paddingRight || "0"),
				),
			};
			break;
		}
	}
	const stripBox = rect(strip);
	const controlsBox = rect(controls);
	const rowBox = rect(row);
	const form = row ? row.closest("form") : null;
	/*
	 * THE TWO NUMBERS THE DEFECT IS. \`gap\` is the free space between the cluster and
	 * the controls: NEGATIVE means the readings are past the group's left edge and
	 * the two boxes overlap. \`overflow\` is the row's own scroll width past its
	 * client box.
	 */
	const gap =
		stripBox && controlsBox ? round(controlsBox.left - stripBox.right) : null;
	return {
		containerBox: rect(document.querySelector("[data-lo-geometry-column]")),
		queryContainer,
		row: rowBox
			? {
					box: rowBox,
					scrollWidth: row.scrollWidth,
					clientWidth: row.clientWidth,
					overflow: row.scrollWidth - row.clientWidth,
					itemCount: items.length,
					/*
					 * A WRAP shows as two distinct vertical centres among the row's flex
					 * items. It is centres rather than tops because the items differ in
					 * height (a 24px reading against a 32px control), so their TOPS differ
					 * in every unwrapped row too - \u00a7G1 says the row is one line at every
					 * width, so this is 1 in every state the composer may be in.
					 */
					lines: [
						...new Set(
							items.map((el) => {
								const r = el.getBoundingClientRect();
								return Math.round(r.top + r.height / 2);
							}),
						),
					].length,
				}
			: null,
		form: form
			? {
					scrollWidth: form.scrollWidth,
					clientWidth: form.clientWidth,
					overflow: form.scrollWidth - form.clientWidth,
				}
			: null,
		strip: stripBox,
		controls: controlsBox
			? { ...controlsBox, children: controls.children.length }
			: null,
		attach: rect(attach),
		chip: rect(chip),
		gap,
		/*
		 * THE GLYPH EDGE, which is what the reader sees overrun.
		 *
		 * \`gap\` is measured between the cluster's BOX and the controls' box, and the
		 * cluster carries \`-mx-1.5\` (a -6px inner-padding cancellation), so its box
		 * reaches 6px past its own flex edge and \`gap\` bottoms out at 2px rather than
		 * 0. The honest test for "a reading prints over a control" is therefore the
		 * rightmost READING box against the controls' left edge: \`glyphOverlap > 0\`
		 * means the last reading's own box is inside the controls group.
		 */
		readingsRight: readings.length
			? Math.max(...readings.filter((r) => r.shown).map((r) => r.box.right))
			: null,
		glyphOverlap:
			readings.filter((r) => r.shown).length && controlsBox
				? round(
						Math.max(...readings.filter((r) => r.shown).map((r) => r.box.right)) -
							controlsBox.left,
					)
				: null,
		readings,
		durationShown: isBox(duration),
		controlNames: controls
			? [...controls.querySelectorAll("button")].map(
					(b) => b.getAttribute("aria-label") ?? "(unnamed)",
				)
			: [],
	};
})()`;

let vite = null;
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (vite) {
		vite.kill("SIGKILL");
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		// SIGKILL returns before the profile stops being written to, so a plain
		// recursive remove can throw ENOTEMPTY and turn a successful measurement
		// into a failure.
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const startVite = async () => {
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(RIG, "composer-readings-geometry.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1, while the driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{
			cwd: ROOT,
			env: { ...process.env, COMPOSER_READINGS_PORT: String(PORT) },
		},
	);
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		try {
			const res = await fetch(`${ORIGIN}/composer-readings-geometry.html`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	throw new Error("the harness page never came up");
};

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		/*
		 * Console output and uncaught exceptions, kept so a page that never became
		 * measurable says WHY: a harness whose module failed to evaluate renders an
		 * empty `#root`, and "the row never appeared" is the symptom rather than the
		 * cause.
		 */
		this.logs = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.method === "Runtime.consoleAPICalled") {
				this.logs.push(
					`[console.${msg.params.type}] ${msg.params.args
						.map((a) => a.value ?? a.description ?? a.type)
						.join(" ")}`,
				);
			}
			if (msg.method === "Runtime.exceptionThrown") {
				this.logs.push(
					`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`,
				);
			}
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-composer-readings-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return cdp;
};

const waitForRow = async (cdp) => {
	for (let i = 0; i < 160; i++) {
		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression: `(() => {
				if (document.fonts.status !== "loaded") return false;
				const strip = document.querySelector("[data-lo-session-strip]");
				if (!strip) return false;
				const row = strip.parentElement;
				const send = row.querySelector(
					'button[aria-label="Send message"], button[aria-label="Stop"], button[aria-label="Stop agent"]',
				);
				return !!send && send.getBoundingClientRect().width > 0;
			})()`,
		});
		if (result.value === true) return;
		await sleep(250);
	}
	const body = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		expression:
			'document.querySelector("form") ? document.querySelector("form").innerHTML.slice(0, 1200) : "no form"',
	});
	throw new Error(
		`the composer row never became measurable\n#root: ${body.result.value}\n${cdp.logs.slice(-12).join("\n")}`,
	);
};

const main = async () => {
	await startVite();
	const cdp = await startChrome();
	if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

	const cases = [];
	for (const state of STATES) {
		for (const readings of READING_FIXTURES) {
			for (const width of WIDTHS) {
				const id = `${state}-${readings}-w${width}`;
				if (ONLY && !ONLY.some((needle) => id.includes(needle))) continue;
				cases.push({ id, state, readings, width });
			}
		}
	}

	const rows = [];
	for (const entry of cases) {
		for (const theme of THEMES) {
			const viewportWidth = Math.max(entry.width + 200, 900);
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: viewportWidth,
				height: 260,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(120);
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/composer-readings-geometry.html?w=${entry.width}&state=${entry.state}&readings=${entry.readings}&theme=${theme}`,
			});
			await waitForRow(cdp);
			await sleep(180);
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: PROBE,
			});
			const probe = result.value;
			const record = { ...entry, theme, ...probe };
			rows.push(record);

			if (OUT_DIR) {
				/*
				 * THE CROP IS THE ROW, at the full column width. The claim is about items
				 * ON ONE LINE sharing it, so a frame that cut the chip or the controls
				 * off would not carry it; and a crop of the whole pane would bury a 8px
				 * overrun in a 1400x900 picture. The row's own box plus a small margin
				 * top and bottom is what a reader has to look at, at 2x so the glyph
				 * edges that overrun are legible.
				 *
				 * The scan is taken from the PROBE's own reading of the same DOM the
				 * numbers come from, so the picture and `numbers.json` describe one
				 * layout rather than two.
				 */
				const column = probe.containerBox;
				const rowBox = probe.row ? probe.row.box : null;
				const shot = await cdp.send("Page.captureScreenshot", {
					format: "png",
					clip: {
						x: Math.max(0, (column ? column.left : 0) - 4),
						y: Math.max(0, (rowBox ? rowBox.top : 0) - 12),
						width: (column ? column.width : entry.width) + 8,
						height: (rowBox ? rowBox.height : 32) + 24,
						scale: 2,
					},
				});
				writeFileSync(
					join(OUT_DIR, `${LABEL}-${entry.id}-${theme}.png`),
					Buffer.from(shot.data, "base64"),
				);
			}
		}
	}

	/*
	 * THE NUMBERS BESIDE THE FRAMES, and from the SAME run that wrote them - the
	 * set's own convention (`docs/evidence/composer-readings/numbers.json`). A
	 * table retyped into a README drifts from the pictures the moment either is
	 * re-taken; this file and the `.webp` beside it are one pass over one DOM.
	 */
	if (OUT_DIR) {
		/*
		 * MERGED, not replaced: one tree's capture is several runs (the case set is
		 * filtered by `--only`), and a file the last run overwrote would describe
		 * only that run's cases while the directory beside it held all of them.
		 * Keyed by `<case id>|<theme>`, so a re-run of one group replaces exactly
		 * that group's rows.
		 */
		const numbersPath = join(OUT_DIR, "numbers.json");
		const merged = existsSync(numbersPath)
			? JSON.parse(readFileSync(numbersPath, "utf8"))
			: {};
		for (const row of rows) merged[`${row.id}|${row.theme}`] = row;
		writeFileSync(numbersPath, `${JSON.stringify(merged, null, 2)}\n`);
	}

	if (AS_JSON) {
		process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
	} else {
		console.log(`\ncomposer readings geometry — ${LABEL}\n`);
		console.log(
			[
				"case",
				"theme",
				"col",
				"qcw",
				"rowOv",
				"gap",
				"lines",
				"dur",
				"cluster",
				"chip",
				"controls",
				"ctlN",
			]
				.map((h, i) => (i === 0 ? h.padEnd(30) : h.padStart(8)))
				.join(""),
		);
		for (const r of rows) {
			console.log(
				[
					r.id.padEnd(30),
					r.theme.replace("localOperator", "").padStart(8),
					String(r.width).padStart(8),
					String(
						r.queryContainer ? r.queryContainer.contentWidth : "?",
					).padStart(8),
					String(r.row ? r.row.overflow : "?").padStart(8),
					String(r.gap).padStart(8),
					String(r.row ? r.row.lines : "?").padStart(8),
					(r.durationShown ? "yes" : "no").padStart(8),
					String(r.strip ? r.strip.width : "?").padStart(8),
					String(r.chip ? r.chip.width : "?").padStart(8),
					String(r.controls ? r.controls.width : "?").padStart(8),
					String(r.controls ? r.controls.children : "?").padStart(8),
				].join(""),
			);
		}
		console.log("");
		/* The row's control composition, so the two states' boxes are visible. */
		for (const r of rows)
			console.log(
				`  ${r.id.padEnd(30)} ${r.theme.replace("localOperator", "").padEnd(6)} ${(r.controlNames ?? []).join(" | ")}`,
			);
		console.log("");
	}
};

process.on("exit", teardown);
process.on("SIGINT", () => {
	teardown();
	process.exit(130);
});

main()
	.then(() => {
		teardown();
		process.exit(0);
	})
	.catch((err) => {
		teardown();
		console.error(err);
		process.exit(1);
	});
