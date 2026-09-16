#!/usr/bin/env node
/**
 * The Backend settings surface, as numbers.
 *
 *     node scripts/backend-settings-geometry.mjs                 # every state
 *     node scripts/backend-settings-geometry.mjs --only=arrival
 *     node scripts/backend-settings-geometry.mjs --json          # records only
 *
 * Why a geometry rig rather than only frames. The redesign's acceptance targets
 * are numbers — the region's height at arrival, rows per screen, how many
 * controls are still full width, how many focusables the closed default state
 * contributes — and a still cannot falsify any of them. It also cannot say WHERE
 * a height came from: this rig reports px per row by KIND beside the totals,
 * because "the page is 10,896px tall" is a symptom and "68 of 99 rows carry a
 * control wider than the column" is the cause.
 *
 * It drives `backend-settings-geometry.html` — the SHIPPED `SettingsPage`
 * against a stubbed desktop bridge carrying the real `/v1/settings` projection —
 * over raw CDP against a private headless Chrome, the same approach as
 * `scripts/capture-evidence.mjs` and `scripts/composer-alert-geometry.mjs`:
 * a scratch user-data-dir under $TMPDIR, a mock keychain so the rig cannot reach
 * the operator's desktop, killed on exit, and no browser-automation dependency
 * added to the repo.
 *
 * Vite is started in-process unless `--port` already answers. Whatever this
 * script starts, it kills.
 *
 * WHAT IT CANNOT SEE. The bridge answers; whether the real backend serves that
 * payload is QA's job against a running app. Focus-dependent rendering (carets,
 * `:focus-visible` rings) is not measured — a headless window is never focused.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
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
const ONLY = flag("only");
const PORT = Number(flag("port") ?? 5251);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome announces its debug port on stderr; this is that line. */
const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The two windows the acceptance targets are stated at — the app's default, and
 * the step below 1040px where the settings rail collapses to its icon column —
 * plus the audit's 1280x800, where the rows-per-screen target is NOT met at the
 * same pitch, and a narrow one where the column, not the window, is what makes
 * the rows stack.
 */
const VIEWPORTS = [
	{ label: "1380x900", width: 1380, height: 900 },
	{ label: "1000x900", width: 1000, height: 900 },
	/*
	 * The audit's OTHER window, added because the `>= 14 rows per screen` target
	 * was quoted as though it held at every size: at 1380x900 the 60.4px row pitch
	 * fits 14.9, and at 1280x800 the same pitch fits 13.2 (design round 1, D10).
	 * A target that is true at one height and not the other has to be measured at
	 * both, or the claim is a claim about a window rather than about the surface,
	 */
	{ label: "1280x800", width: 1280, height: 800 },
	{ label: "620x900", width: 620, height: 900 },
];

/** The palettes. Two, because a spacing or contrast defect hides in one theme. */
const THEMES = ["localOperatorDark", "localOperatorLight"];

/**
 * What each state does after the page is ready.
 *
 * The section headers are addressed through `[data-section-header]` rather than
 * by role: a row's own help reveal repeats `aria-expanded`, so a role query for
 * "a button that is not expanded" would drive 99 help lines instead of 18
 * sections.
 */
const STATES = {
	/** The first paint, no interaction. */
	arrival: "() => true",
	/** Every section open, advanced still held back. */
	"all-expanded": `() => {
		const closed = [...document.querySelectorAll('[data-section-header] button[aria-expanded="false"]')];
		for (const el of closed) el.click();
		return closed.length;
	}`,
	/** Nothing open: the readable index of 19 headers. */
	collapsed: `() => {
		const open = [...document.querySelectorAll('[data-section-header] button[aria-expanded="true"]')];
		for (const el of open) el.click();
		return open.length;
	}`,
	/** The advanced tier revealed, in place. */
	advanced: `() => {
		const chip = [...document.querySelectorAll('button')].find((b) => /^Show advanced/.test(b.textContent.trim()));
		if (chip && chip.getAttribute('aria-pressed') === 'false') chip.click();
		return Boolean(chip);
	}`,
	/** A search that matches a handful of rows across several sections. */
	filtered: `() => {
		const input = document.querySelector('input[aria-label="Search settings"]');
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
		setter.call(input, 'cache');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	}`,
	/**
	 * The densest arrangement the surface can be in: advanced shown AND every
	 * section open, so a section's rows run contiguously down the screen and
	 * "rows per screen" is a measurement of the row pitch rather than of how
	 * many headers happen to fall between them.
	 */
	dense: `() => {
		const chip = [...document.querySelectorAll('button')].find((b) => /^Show advanced/.test(b.textContent.trim()));
		if (chip && chip.getAttribute('aria-pressed') === 'false') chip.click();
		const closed = [...document.querySelectorAll('[data-section-header] button[aria-expanded="false"]')];
		for (const el of closed) el.click();
		return closed.length;
	}`,
	/**
	 * The gated children, which is the state `session.cleanup.*` is in whenever
	 * cleanup is off: reveal the tier, open the section, and the four rows under
	 * its switch must be there, disabled, and explained.
	 */
	gated: `() => {
		const chip = [...document.querySelectorAll('button')].find((b) => /^Show advanced/.test(b.textContent.trim()));
		if (chip && chip.getAttribute('aria-pressed') === 'false') chip.click();
		const header = [...document.querySelectorAll('[data-section-header]')].find((el) => /^Session storage/.test(el.textContent.trim()));
		const trigger = header ? header.querySelector('button[aria-expanded]') : null;
		if (trigger && trigger.getAttribute('aria-expanded') === 'false') trigger.click();
		return Boolean(trigger);
	}`,
	/** A search that matches nothing. */
	empty: `() => {
		const input = document.querySelector('input[aria-label="Search settings"]');
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
		setter.call(input, 'zzzzzz');
		input.dispatchEvent(new Event('input', { bubbles: true }));
		return true;
	}`,
};

/** Which fixture each state is measured on. */
const FIXTURE_FOR = {
	"changed-rows": "changed",
	gated: "changed",
	redacted: "redacted",
};

const READY = `(() => {
	const rows = document.querySelectorAll('[data-setting-key]');
	const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Backend settings');
	return Boolean(heading) && (rows.length > 0 || !document.querySelector('[data-setting-key]')) && document.fonts.status === 'loaded';
})()`;

/**
 * Everything the acceptance targets are stated in.
 *
 * Rects are read as DIFFERENCES against the region's own box, so a measurement
 * is scroll-invariant: the page's scroller is its own content div rather than
 * the document, and a document-absolute read would be wrong the moment the
 * section is scrolled into view.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const rect = (el) => { const r = el.getBoundingClientRect(); return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), width: round(r.width), height: round(r.height) }; };
	const rig = window.__rig || { settings: [] };
	const byKey = new Map(rig.settings.map((s) => [s.key, s]));

	const scroller = document.querySelector('[data-settings-content]');
	const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Backend settings');
	const region = heading ? heading.parentElement : null;
	const column = heading ? heading.closest('.max-w-4xl') : null;
	if (!region || !column) return null;

	/*
	 * The region is scrolled to its own top first, because "rows per screen" is
	 * a question about the first screen of this surface rather than about
	 * wherever the page happened to be after the state was driven.
	 */
	if (scroller) {
		scroller.scrollTop += region.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
	}

	const viewportH = window.innerHeight;
	const sectionEls = [...document.querySelectorAll('[data-settings-section]')];
	const headerEls = [...document.querySelectorAll('[data-section-header]')];
	const headers = headerEls.map((el) => {
		const trigger = el.querySelector('button[aria-expanded]');
		return {
			title: el.dataset.sectionHeader,
			open: trigger ? trigger.getAttribute('aria-expanded') === 'true' : null,
			height: round(rect(el).height),
			triggerHeight: trigger ? round(rect(trigger).height) : null,
			text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120),
		};
	});

	const rows = [...document.querySelectorAll('[data-setting-key]')].map((el) => {
		const meta = byKey.get(el.dataset.settingKey) || {};
		const r = rect(el);
		const candidates = [...el.querySelectorAll('input:not([type=hidden]), textarea, button[role="switch"], button[role="combobox"]')];
		const control = candidates.sort((a, b) => {
			const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
			return rb.width * rb.height - ra.width * ra.height;
		})[0] || null;
		const cr = control ? rect(control) : null;
		const style = control ? getComputedStyle(control) : null;
		return {
			key: el.dataset.settingKey,
			section: meta.section || null,
			tier: el.dataset.tier || null,
			kind: meta.kind || null,
			is_default: meta.is_default,
			gated_by: meta.gated_by || null,
			height: r.height,
			top: r.top,
			bottom: r.bottom,
			// The row is a wrapper whose INNER element carries the layout: a
			// container cannot query itself, so the query classes live one level
			// in, and this is the element that answers "did the column fit".
			rowDirection: getComputedStyle(el.firstElementChild || el).flexDirection,
			// The label column's width, which is the number the narrow fix is
			// about: a control that squeezes its label below ~176px wraps
			// instead, and a wrapped row shows this at the column's own width.
			labelWidth: el.firstElementChild ? round(rect(el.firstElementChild).width) : null,
			// A row inside a COLLAPSED section is still mounted (which is what
			// makes its draft survive the collapse) and measures 0x0. It is not on
			// screen, and counting a zero rect as visible is how a "rows per
			// screen" number comes out larger than the screen.
			fullyOnScreen: r.height > 0 && r.top >= 0 && r.bottom <= viewportH,
			onScreen: r.height > 0 && r.bottom > 0 && r.top < viewportH,
			control: control ? { tag: control.tagName, role: control.getAttribute('role'), width: cr.width, height: cr.height, disabled: control.disabled === true || control.getAttribute('aria-disabled') === 'true', cursor: style.cursor, value: control.value ?? null, ink: style.color } : null,
			// The slot the row's layout gives the control, which is the thing the
			// redesign sizes by KIND rather than by column.
			slotWidth: control && control.parentElement ? rect(control.parentElement).width : null,
			// The container-query wiring, reported because a row that stacks at a
			// wide column is a defect with three possible causes (the class, the
			// container, or the compiled CSS) and this names which.
			containerType: getComputedStyle(el).containerType,
			containerName: getComputedStyle(el).containerName,
			className: el.className,
			helpVisible: Boolean(el.querySelector('p.text-meta')),
			warning: [...el.querySelectorAll('p, span')].map((n) => n.textContent || '').find((t) => /prompt cache|danger/i.test(t)) || null,
			buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean),
		};
	});

	const visibleRows = rows.filter((row) => row.onScreen);
	const fullyVisible = rows.filter((row) => row.fullyOnScreen);
	const controls = rows.map((r) => r.control).filter(Boolean);
	const FULL_WIDTH_PX = 800;
	const NARROW_PX = 40;

	/*
	 * The tab order the CLOSED default state contributes: every focusable inside
	 * the region that a reader could reach, with hidden rows excluded (a row in a
	 * closed section is inside a [hidden] subtree, so it is not focusable and
	 * must not be counted).
	 */
	const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	const focusables = [...region.querySelectorAll(focusableSelector)].filter((el) => {
		if (el.closest('[hidden]')) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
	});
	const byRole = {};
	for (const el of focusables) {
		const marker = el.closest('[data-section-header]') ? 'section header'
			: el.closest('[data-setting-key]') ? 'row control'
			: 'filter bar';
		byRole[marker] = (byRole[marker] || 0) + 1;
	}

	/*
	 * ROWS PER SCREEN, which is a question about the LIST rather than about the
	 * index above it: the region is scrolled so its first row is at the top of
	 * the viewport and the rows that then fit are counted. Answering it from the
	 * region's own top would count the 19 headers, which is the arrangement the
	 * reader has already scrolled past.
	 */
	const firstRow = rows.find((row) => row.height > 0);
	let rowsPerScreen = null;
	if (firstRow && scroller) {
		scroller.scrollTop += firstRow.top;
		rowsPerScreen = [...document.querySelectorAll('[data-setting-key]')].filter((el) => {
			const r = el.getBoundingClientRect();
			return r.height > 0 && r.top >= 0 && r.bottom <= viewportH;
		}).length;
	}

	const openSections = headers.filter((h) => h.open).length;
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		column: rect(column),
		region: rect(region),
		regionHeight: round(rect(region).height),
		scroller: scroller ? { scrollHeight: round(scroller.scrollHeight), clientHeight: round(scroller.clientHeight) } : null,
		counts: {
			sectionsRegistry: rig.sections ? rig.sections.length : null,
			sectionsRendered: sectionEls.length,
			sectionsOpen: openSections,
			settingsRegistry: byKey.size,
			rowsRendered: rows.length,
			rowsOnScreen: visibleRows.length,
			rowsFullyOnScreen: fullyVisible.length,
			rowsHidden: rows.filter((row) => row.height === 0).length,
		},
		rowsPerScreen,
		/*
		 * The row PITCH, which is the number the target is really about: "at
		 * least 14 rows per screen" is a claim about how tall a row is, and a
		 * section whose rows are interleaved with 40px headers cannot put 14 of
		 * them on one screen however short they are.
		 */
		rowPitch: (() => {
			const heights = visibleRows.map((row) => row.height).sort((a, b) => a - b);
			if (heights.length === 0) return null;
			return {
				n: heights.length,
				min: round(heights[0]),
				median: round(heights[Math.floor(heights.length / 2)]),
				max: round(heights[heights.length - 1]),
				perScreen: round(viewportH / heights[Math.floor(heights.length / 2)]),
			};
		})(),
		/*
		 * Where the region's height comes from. The total is the acceptance
		 * number, but a total nobody can decompose is a number that invites
		 * guessing: this lists the region's own rows of content in order, with
		 * each open section's body separated from its header.
		 */
		regionParts: {
			regionChildren: [...region.children].map((child) => ({
				height: round(rect(child).height),
				text: (child.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
			})),
			headersTotal: round(headers.reduce((a, h) => a + h.height, 0)),
			headerTriggerTotal: round(headers.reduce((a, h) => a + (h.triggerHeight || 0), 0)),
			sectionBodies: sectionEls.map((el) => ({
				name: el.dataset.settingsSection,
				open: el.dataset.open === 'true',
				height: round(rect(el).height),
				bodyHeight: (() => {
					const body = el.querySelector(':scope > div:last-child');
					return body ? round(rect(body).height) : null;
				})(),
			})),
		},
		headers,
		headerHeight: headers.length ? round(headers.reduce((a, h) => a + h.height, 0) / headers.length) : null,
		filterBarHeight: (() => {
			const input = region.querySelector('input[aria-label="Search settings"]');
			if (!input) return null;
			const bar = input.closest('div').parentElement;
			return bar ? round(rect(bar).height) : null;
		})(),
		focusables: focusables.length,
		focusablesByArea: byRole,
		controls: {
			total: controls.length,
			fullWidth: controls.filter((c) => c.width >= FULL_WIDTH_PX).length,
			narrowerThan40: controls.filter((c) => c.width < NARROW_PX).length,
			widest: controls.length ? round(Math.max(...controls.map((c) => c.width))) : null,
			disabled: controls.filter((c) => c.disabled).length,
		},
		// Averages over the rows a reader can actually see: a hidden row's zero
		// rect would otherwise drag every per-kind figure toward zero and make the
		// numbers look better than the layout is.
		rowHeightsByKind: (() => {
			const by = {};
			for (const row of visibleRows) {
				const k = row.kind || 'unknown';
				by[k] ??= { n: 0, sum: 0, controlSum: 0, help: 0 };
				by[k].n += 1;
				by[k].sum += row.height;
				by[k].controlSum += row.control ? row.control.width : 0;
				if (row.helpVisible) by[k].help += 1;
			}
			return Object.fromEntries(
				Object.entries(by).map(([k, v]) => [
					k,
					{ n: v.n, rowH: round(v.sum / v.n), controlW: round(v.controlSum / v.n), helpRows: v.help },
				]),
			);
		})(),
		rows,
	};
})()`;

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		this.log = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			} else if (msg.method === "Runtime.exceptionThrown") {
				this.log.push(
					msg.params.exceptionDetails.exception?.description ??
						msg.params.exceptionDetails.text,
				);
			} else if (msg.method === "Runtime.consoleAPICalled") {
				this.log.push(
					`${msg.params.type}: ${msg.params.args
						.map((a) => a.description ?? a.value ?? a.type)
						.join(" ")}`,
				);
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

let vite = null;
let viteOwned = false;
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (viteOwned && vite) {
		vite.kill("SIGKILL");
		vite = null;
	}
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};

const serverUp = async () => {
	try {
		return (await fetch(`${ORIGIN}/backend-settings-geometry.html`)).ok;
	} catch {
		return false;
	}
};

const startVite = async () => {
	if (await serverUp()) return;
	vite = spawn(
		process.execPath,
		[
			join(ROOT, "node_modules/vite/bin/vite.js"),
			"--config",
			join(RIG, "backend-settings-geometry.vite.mjs"),
			"--port",
			String(PORT),
			"--strictPort",
			// Bound explicitly: vite's default host is `localhost`, which on this
			// platform resolves to ::1 while this driver waits on 127.0.0.1.
			"--host",
			"127.0.0.1",
		],
		{ cwd: ROOT, env: { ...process.env, RIG_PORT: String(PORT) } },
	);
	viteOwned = true;
	vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	vite.stdout.on("data", (d) => process.stderr.write(`[vite] ${d}`));
	for (let i = 0; i < 240; i++) {
		if (await serverUp()) return;
		await sleep(500);
	}
	throw new Error("the rig page never came up");
};

const startChrome = async () => {
	dataDir = join(tmpdir(), `lo-backend-settings-geometry-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_LINE);
			if (m) {
				clearTimeout(timer);
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

const evaluate = async (cdp, expression, awaitPromise = false) => {
	const { result } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		awaitPromise,
		expression,
	});
	return result.value;
};

const main = async () => {
	await startVite();
	const cdp = await startChrome();
	const records = [];
	try {
		for (const viewport of VIEWPORTS) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: viewport.width,
				height: viewport.height,
				deviceScaleFactor: 2,
				mobile: false,
			});
			for (const theme of THEMES) {
				for (const [state, script] of Object.entries(STATES)) {
					if (ONLY && !state.includes(ONLY)) continue;
					const fixture = FIXTURE_FOR[state] ?? "fresh";
					await cdp.send("Page.navigate", { url: "about:blank" });
					await sleep(120);
					await cdp.send("Page.navigate", {
						url: `${ORIGIN}/backend-settings-geometry.html?fixture=${fixture}&state=${state}&theme=${theme}`,
					});
					let ready = false;
					for (let i = 0; i < 160 && !ready; i++) {
						ready = (await evaluate(cdp, READY)) === true;
						if (!ready) await sleep(200);
					}
					if (!ready) {
						const body = await evaluate(
							cdp,
							"document.body.innerText.slice(0, 300)",
						);
						throw new Error(
							`${viewport.label}/${theme}/${state}: never became ready — ${body}${cdp.log.length ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
						);
					}
					await evaluate(cdp, `(${script})()`);
					await evaluate(
						cdp,
						"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
						true,
					);
					await sleep(150);
					const measurement = await evaluate(cdp, PROBE);
					if (!measurement) {
						throw new Error(
							`${viewport.label}/${theme}/${state}: no measurement returned`,
						);
					}
					records.push({
						...measurement,
						viewportLabel: viewport.label,
						theme,
						state,
						fixture,
					});
				}
			}
		}
	} finally {
		teardown();
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ records }, null, 2));
		return;
	}

	for (const m of records) {
		console.log(
			`\n${m.viewportLabel}  ${m.theme}  ${m.state} (${m.fixture})  column=${m.column.width}px  regionH=${m.regionHeight}px  sections=${m.counts.sectionsRendered} open=${m.counts.sectionsOpen}  rows=${m.counts.rowsRendered}  hidden=${m.counts.rowsHidden}  rowsPerScreen=${m.rowsPerScreen}  pitch=${m.rowPitch ? `${m.rowPitch.min}-${m.rowPitch.max} (median ${m.rowPitch.median}, ${m.rowPitch.perScreen}/screen)` : "-"}  headerH=${m.headerHeight}px  focusables=${m.focusables}${JSON.stringify(m.focusablesByArea)}  controls: full-width(>=800px)=${m.controls.fullWidth} <40px=${m.controls.narrowerThan40} widest=${m.controls.widest} disabled=${m.controls.disabled}`,
		);
		const kinds = Object.entries(m.rowHeightsByKind)
			.map(
				([kind, v]) =>
					`${kind}:n=${v.n},rowH=${v.rowH},ctrlW=${v.controlW},help=${v.helpRows}`,
			)
			.join("  ");
		console.log(`      by kind:  ${kinds}`);
		const offScreen = m.rows.filter((r) => !r.onScreen).length;
		console.log(
			`      rows off screen: ${offScreen}   first rows: ${m.rows
				.slice(0, 4)
				.map(
					(r) =>
						`${r.key}:h=${r.height},dir=${r.rowDirection},ctrl=${r.control ? r.control.width : "-"}`,
				)
				.join("  ")}`,
		);
		if (m.focusables > 30) {
			console.log(
				`      NOTE: ${m.focusables} focusables is over the closed-default budget of 30`,
			);
		}
	}
	console.log(`\n${records.length} records.`);
};

await main();
