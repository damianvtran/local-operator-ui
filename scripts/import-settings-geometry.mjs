#!/usr/bin/env node
/**
 * The Import conversations surface, as numbers.
 *
 *     node scripts/import-settings-geometry.mjs
 *     node scripts/import-settings-geometry.mjs --out=docs/evidence/import-settings
 *     node scripts/import-settings-geometry.mjs --json
 *
 * WHY A GEOMETRY RIG AND NOT A STORY. The three defects this surface had are
 * not visible in a still: a frame cannot say whether the app's own clipped
 * shell root moved 237px, and it cannot say how many separate interactions a
 * user has to perform before the Import button comes alive. Both are numbers,
 * and both were measured wrong for a long time because nobody read them.
 *
 * It drives `import-settings-geometry.html` — the SHIPPED `SettingsPage`
 * against a stubbed desktop bridge — over raw CDP against a private headless
 * Chrome, the same approach as `scripts/backend-settings-geometry.mjs`: a
 * scratch user-data-dir under $TMPDIR, a mock keychain so the rig cannot reach
 * the operator's desktop, killed on exit, and no browser-automation dependency
 * added to the repo.
 *
 * Vite is started in-process unless `--port` already answers. Whatever this
 * script starts, it kills.
 *
 * WHAT IT REPORTS, AND WHY EACH NUMBER IS HERE.
 *
 *  - `window.scrollY` and `documentElement.scrollTop`: the DOCUMENT did not
 *    move in the shipped bug either, which is why the bug was misdiagnosed as
 *    "the window scrolls". They are reported so that a reader can see that
 *    claim being falsified rather than being taken on trust.
 *  - the app shell root's `scrollTop`, `scrollHeight` and `clientHeight`: this
 *    is the box that DID move. It is `overflow: hidden`, so the user cannot
 *    scroll back - the whole app shifts up and leaves an empty band at the
 *    bottom of the window. Its `scrollHeight` against its `clientHeight` is
 *    also the 3825px of hidden overflow the `sr-only` labels produce, which is
 *    why `scrollIntoView` could reach it at all.
 *  - the settings content container's `scrollTop`: this is the box that is
 *    ALLOWED to move, because it owns the reading position. Its delta is the
 *    only scroll the fix may produce.
 *  - the session checkbox's `data-state`, whether the Radix Indicator mounted,
 *    and its computed fill: the tick is the operator's question, and the
 *    answer is a fact about the DOM rather than about a picture.
 *  - the flow's step count: how many separate interactions a user performs to
 *    reach an enabled Import button. This is the defect that is not a pixel.
 *
 * WHAT IT CANNOT SEE. The bridge answers; whether the real backend serves that
 * payload is QA's job against a running app. Focus-dependent rendering (carets,
 * `:focus-visible` rings) is not measured - a headless window is never focused.
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
/*
 * The extra states need the CURRENT build's fixtures (an inline failure, a
 * result-bearing job). A run against the pre-fix build skips them: its own
 * `after` frame is the defect, and a state it cannot render would abort the
 * run before the numbers were written.
 */
const EXTRA_STATES = !ARGS.includes("--no-states");
const flag = (name) =>
	ARGS.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const PORT = Number(flag("port") ?? 5252);
const OUT_DIR = flag("out");
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chrome announces its debug port on stderr; this is that line. */
const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The window the defect was measured in. */
const VIEWPORT = { width: 1380, height: 900 };

/**
 * The page is ready when the import section has rendered its session rows: the
 * section is at the foot of the settings page, so "ready" is the first session
 * row existing rather than the document being non-empty.
 */
const READY = `(() => {
	const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Import conversations');
	return Boolean(heading) && document.querySelectorAll('[role="checkbox"]').length > 0 && document.fonts.status === 'loaded';
})()`;

/**
 * The numbers, read in the page.
 *
 * The SHELL ROOT is found by its own class chain, not by a test hook: the bug
 * is about a specific element in the app's own shell, and a rig that marked
 * the element would be measuring its own marker. `scrollHeight` against
 * `clientHeight` is reported because that difference IS the bug's mechanism -
 * an `overflow: hidden` box with content taller than it is a scroll container
 * that `scrollIntoView` will happily move.
 */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const shell = document.querySelector('div.relative.flex.h-screen');
	const content = document.querySelector('[data-settings-content]');
	const rows = [...document.querySelectorAll('[role="checkbox"]')];
	const session = rows.find((box) => {
		const label = box.getAttribute('aria-label') || '';
		return !/^I understand/.test(label);
	});
	const confirm = rows.find((box) => /^I understand/.test(box.getAttribute('aria-label') || ''));
	const indicator = session ? session.querySelector('span[data-state]') : null;
	const glyph = session ? session.querySelector('svg') : null;
	const row = session ? session.closest('div.rounded-md') : null;
	const importButton = [...document.querySelectorAll('button')].find((b) => /^Import \\d/.test(b.textContent.trim()));
	const selectedRows = [...document.querySelectorAll('div.rounded-md')].filter((node) => node.querySelector('[role="checkbox"]'));
	const selectedRow = selectedRows.find((node) => {
		const box = node.querySelector('[role="checkbox"]');
		return box && box.getAttribute('data-state') === 'checked';
	});
	const style = (el) => (el ? getComputedStyle(el) : null);
	const sessionStyle = style(session);
	const rowStyle = style(selectedRow);
	return {
		window: { scrollY: window.scrollY, scrollX: window.scrollX },
		document: { scrollTop: document.documentElement.scrollTop },
		shell: shell ? {
			scrollTop: shell.scrollTop,
			scrollHeight: shell.scrollHeight,
			clientHeight: shell.clientHeight,
			overflowY: style(shell).overflowY,
		} : null,
		content: content ? {
			scrollTop: content.scrollTop,
			scrollHeight: content.scrollHeight,
			clientHeight: content.clientHeight,
		} : null,
		sessionCheckbox: session ? {
			dataState: session.getAttribute('data-state'),
			ariaChecked: session.getAttribute('aria-checked'),
			indicatorMounted: Boolean(indicator),
			fill: sessionStyle.backgroundColor,
			border: sessionStyle.borderColor,
			glyph: glyph ? style(glyph).color : null,
		} : null,
		selectedRow: selectedRow ? {
			classes: selectedRow.className,
			background: rowStyle.backgroundColor,
			border: rowStyle.borderColor,
		} : null,
		importButton: importButton ? {
			label: importButton.textContent.trim(),
			disabled: importButton.disabled,
		} : null,
		confirmCheckbox: confirm ? {
			dataState: confirm.getAttribute('data-state'),
			disabled: confirm.getAttribute('data-disabled') !== null,
		} : null,
		/*
		 * THE FLOW'S STEP COUNT, counted from the DOM rather than asserted: how
		 * many separate controls a user has to touch to reach an enabled Import
		 * button. It is the number that says whether the flow is one action or
		 * three, and it is what a still cannot show.
		 */
		flow: {
			previewButtonPresent: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Preview'),
			importEnabled: importButton ? !importButton.disabled : false,
			acknowledgementPresent: Boolean(confirm),
		},
		/*
		 * THE PREVIEW'S FAILURE, WHERE IT IS RENDERED. "inline" is the claim
		 * that the reason and its Retry are inside the block that holds the
		 * controls they explain; "retryInGate" is the half that would be false
		 * if the failure were only in the section banner above the list.
		 */
		previewFailure: (() => {
			const gate = importButton ? importButton.closest('div.rounded-lg') : null;
			const retryAnywhere = [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry');
			/*
			 * The Retry is looked for INSIDE the gate, not in the document:
			 * another section can render its own Retry button, and a
			 * document-wide find would report that one as the preview's.
			 */
			const retryInGate = gate
				? [...gate.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry')
				: false;
			const text = gate ? (gate.textContent || '') : '';
			return {
				stated: /Could not build the preview/.test(document.body.innerText || ''),
				inline: /Could not build the preview/.test(text),
				retryPresent: retryAnywhere,
				retryInGate,
				spinner: /Building the preview/.test(document.body.innerText || ''),
			};
		})(),
		/* The completion CTA is only reachable when a result exists. */
		completion: {
			ctaPresent: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Import more conversations')),
			resultHeading: /Import result/.test(document.body.innerText || ''),
		},
		/* What the glass paint applied, read back from the document. */
		glass: document.documentElement.dataset.glass
			? {
					kinds: document.documentElement.dataset.glass,
					canvasAlpha: getComputedStyle(document.documentElement).getPropertyValue('--lo-glass-a-canvas').trim(),
					selectedAlpha: getComputedStyle(document.documentElement).getPropertyValue('--lo-glass-a-row-selected').trim(),
				}
			: null,
		theme: document.documentElement.dataset.theme,
		scheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
	};
})()`;

/**
 * The two states the rig measures.
 *
 * `before` is the surface as the operator finds it: the import section in
 * view, nothing selected, no preview. `after` is the surface once the flow has
 * been walked - a conversation selected, the preview built, the acknowledgement
 * given, the Import button live.
 */

/**
 * Waits for the automatic preview to have been built.
 *
 * The pattern is the preview SUMMARY's own shape - a session count, a message
 * count and a compaction count separated by the middot - rather than "some
 * paragraph with a number in it": the source cards also print a session count,
 * and a looser match would report the preview as built before it was.
 */
const PREVIEW_BUILT = `(() => {
	const summary = [...document.querySelectorAll('p')].find((p) => /^\\d+ sessions? · \\d+ messages? · \\d+ compactions?$/.test(p.textContent.trim()));
	return Boolean(summary);
})()`;

/**
 * Scrolls the settings content container to the import section, the way an
 * operator who has found the section would have scrolled there.
 *
 * The container's own `scrollTop` is set rather than `scrollIntoView` being
 * called, and that is not a detail: `scrollIntoView` with the default
 * `container: "all"` walks EVERY scrolling ancestor, including the app's
 * `overflow: hidden` shell root, and moving that box is the very defect this
 * rig measures. A rig that used the broken call to set up its own measurement
 * would report the defect as the baseline.
 */
const SCROLL_TO_SECTION = `(() => {
	const content = document.querySelector('[data-settings-content]');
	const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Import conversations');
	if (!content || !heading) return false;
	content.scrollTop += heading.getBoundingClientRect().top - content.getBoundingClientRect().top;
	return true;
})()`;

/**
 * The one interaction a user makes to select a conversation: the row's title
 * button. The checkbox is a second way to the same toggle, and the operator
 * reaches for whichever they see first, so the rig presses the title.
 */
const SELECT_A_ROW = `(() => {
	const box = [...document.querySelectorAll('[role="checkbox"]')].find((b) => !/^I understand/.test(b.getAttribute('aria-label') || ''));
	if (!box) return false;
	const row = box.closest('div.rounded-md');
	/*
	 * THE ROW TEXT IS A LABEL on this build, and a second button on the build
	 * before it. The label is preferred because it is the affordance a user
	 * actually presses; the button is the fallback that keeps one rig able to
	 * measure the pre-fix build, where no label exists.
	 */
	const label = row?.querySelector('label[for]');
	if (label) { label.click(); return true; }
	const title = row?.querySelector('button:not([role="checkbox"])');
	if (!title) return false;
	title.click();
	return true;
})()`;

/**
 * The manual Preview control, if the build still has one.
 *
 * On the build this rig was written against, the preview was asked for by
 * pressing a button that read "Preview" under a heading that also read
 * "Preview", in a section below the list. The rig presses it when it is there,
 * because the flow's step count is the number of interactions a user has to
 * perform, and a control that is on screen but not pressed is not a step
 * anyone took.
 */
const PRESS_PREVIEW = `(() => {
	const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Preview');
	if (!button) return false;
	button.click();
	return true;
})()`;

/** The acknowledgement, ticked. */
const TICK_ACKNOWLEDGEMENT = `(() => {
	const box = [...document.querySelectorAll('[role="checkbox"]')].find((b) => /^I understand/.test(b.getAttribute('aria-label') || ''));
	if (!box) return false;
	box.click();
	return true;
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
		return (await fetch(`${ORIGIN}/import-settings-geometry.html`)).ok;
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
			join(RIG, "import-settings-geometry.vite.mjs"),
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
	dataDir = join(tmpdir(), `lo-import-settings-geometry-${process.pid}`);
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

const waitFor = async (cdp, expression, label) => {
	for (let i = 0; i < 120; i++) {
		if ((await evaluate(cdp, expression)) === true) return;
		await sleep(100);
	}
	const body = await evaluate(cdp, "document.body.innerText.slice(0, 300)");
	throw new Error(
		`${label} never happened — ${body}${cdp.log.length ? `\npage log:\n  ${cdp.log.slice(-6).join("\n  ")}` : ""}`,
	);
};

/**
 * Walks the flow the way a user does and counts the interactions.
 *
 * Each step is a real click on a real control, and the walk stops the moment
 * the Import button is live - so the number is what a user would have to do,
 * not what the code could do.
 */
const measureFlow = async (cdp) => {
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/import-settings-geometry.html`,
	});
	await waitFor(cdp, READY, "the import section");
	await evaluate(cdp, SCROLL_TO_SECTION);
	await sleep(120);

	const steps = [];
	const importLive = `(() => {
		const button = [...document.querySelectorAll('button')].find((b) => /^Import \\d/.test(b.textContent.trim()));
		return Boolean(button) && !button.disabled;
	})()`;

	const step = async (label, script) => {
		const pressed = await evaluate(cdp, script);
		if (pressed !== true) return false;
		steps.push(label);
		return true;
	};

	// 1. Choose a conversation.
	await step("select a conversation", SELECT_A_ROW);

	// 2. The manual Preview control, on a build that still has one.
	for (let i = 0; i < 40; i++) {
		if ((await evaluate(cdp, PREVIEW_BUILT)) === true) break;
		if ((await evaluate(cdp, PRESS_PREVIEW)) === true) {
			steps.push("press the Preview button");
			break;
		}
		await sleep(100);
	}
	await waitFor(cdp, PREVIEW_BUILT, "the preview to be built");

	// 3. Acknowledge the copy - the gate the Import button holds shut.
	if ((await evaluate(cdp, importLive)) !== true) {
		await step("tick the acknowledgement", TICK_ACKNOWLEDGEMENT);
	}

	const enabled = (await evaluate(cdp, importLive)) === true;
	return { steps, stepCount: steps.length, importEnabled: enabled };
};

/**
 * Opens the page in one named configuration, ready to be driven.
 *
 * Each state is a FRESH PAGE with its own query parameters rather than a
 * sequence of mutations inside one page: the states the review asked for are
 * reached by different fixture behaviour (a refusing preview, a result-bearing
 * job), and carrying one page through all of them would make the fixture lie
 * about what the component did on its own.
 */
const openState = async (cdp, options = {}) => {
	const {
		theme = "localOperatorDark",
		glass = false,
		previewFail = false,
		complete = false,
		width = VIEWPORT.width,
		height = VIEWPORT.height,
	} = options;
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	const params = new URLSearchParams({ theme });
	if (glass) params.set("glass", "1");
	if (previewFail) params.set("previewFail", "1");
	if (complete) params.set("complete", "1");
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/import-settings-geometry.html?${params.toString()}`,
	});
	await waitFor(cdp, READY, "the import section");
	await evaluate(cdp, SCROLL_TO_SECTION);
	// The page fills in asynchronously; content above the section moves the
	// container by itself, so the baseline is taken after it settles.
	await sleep(1200);
};

const shoot = async (cdp, out, name) => {
	if (!out) return;
	mkdirSync(out, { recursive: true });
	const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(out, `${name}.png`), Buffer.from(shot.data, "base64"));
};

const IMPORT_LIVE = `(() => {
	const button = [...document.querySelectorAll('button')].find((b) => /^Import \\d/.test(b.textContent.trim()));
	return Boolean(button) && !button.disabled;
})()`;

const TICK_ACK = `(() => {
	const boxes = [...document.querySelectorAll('[role="checkbox"]')];
	const ack = boxes.find((box) => /^I understand/.test(box.getAttribute('aria-label') || ''));
	if (!ack || ack.getAttribute('data-state') === 'checked') return false;
	ack.click();
	return true;
})()`;

const CLICK_IMPORT = `(() => {
	const button = [...document.querySelectorAll('button')].find((b) => /^Import \\d/.test(b.textContent.trim()));
	if (!button || button.disabled) return false;
	button.click();
	return true;
})()`;

/**
 * The states round-1 review asked to see, each measured and captured.
 *
 * `pending` is the frame a user sees between selecting a row and the preview
 * arriving - the debounce window. It is a frame, not an inference: the spinner
 * is the only thing on screen that says the build is coming.
 */
const captureStates = async (cdp, out) => {
	const states = {};

	// pending + settled, on the default dark palette.
	await openState(cdp);
	await evaluate(cdp, SELECT_A_ROW);
	states.pending = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "pending");
	await waitFor(cdp, PREVIEW_BUILT, "the automatic preview");
	await sleep(400);
	states.settled = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "settled");

	// the preview failure, stated beside the controls it disables.
	await openState(cdp, { previewFail: true });
	await evaluate(cdp, SELECT_A_ROW);
	await waitFor(
		cdp,
		`(() => /Could not build the preview/.test(document.body.innerText || ''))()`,
		"the inline preview failure",
	);
	await sleep(200);
	states.failure = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "failure");

	// completion: a status carrying a nested result, so the CTA is reachable.
	await openState(cdp, { complete: true });
	await evaluate(cdp, SELECT_A_ROW);
	await waitFor(cdp, PREVIEW_BUILT, "the automatic preview");
	await evaluate(cdp, TICK_ACK);
	await waitFor(cdp, IMPORT_LIVE, "an enabled Import button");
	await evaluate(cdp, CLICK_IMPORT);
	await waitFor(
		cdp,
		`(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Import more conversations')))()`,
		"the completion CTA",
	);
	await sleep(300);
	states.completion = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "completion");

	// glass on: the app's own paint, applied exactly as the hook applies it.
	await openState(cdp, { glass: true });
	await evaluate(cdp, SELECT_A_ROW);
	await waitFor(cdp, PREVIEW_BUILT, "the automatic preview");
	await sleep(400);
	states.glass = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "glass");

	// narrow: the smallest supported width the settings column is designed for.
	await openState(cdp, { width: 1000, height: 900 });
	await evaluate(cdp, SELECT_A_ROW);
	await waitFor(cdp, PREVIEW_BUILT, "the automatic preview");
	await sleep(400);
	states.narrow = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "narrow");

	// light: the other scheme, where the role ladder inverts.
	await openState(cdp, { theme: "localOperatorLight" });
	await evaluate(cdp, SELECT_A_ROW);
	await waitFor(cdp, PREVIEW_BUILT, "the automatic preview");
	await sleep(400);
	states.light = await evaluate(cdp, PROBE);
	if (out) await shoot(cdp, out, "light");

	return states;
};

const main = async () => {
	await startVite();
	const cdp = await startChrome();
	const records = {};
	try {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: VIEWPORT.width,
			height: VIEWPORT.height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/import-settings-geometry.html`,
		});
		await waitFor(cdp, READY, "the import section");
		/*
		 * The import section is at the foot of the settings page, so the
		 * operator scrolls to it before anything else. That scroll is the
		 * BASELINE the preview build is measured against - it is the settings
		 * content container's own reading position, and it is set on that
		 * container (see SCROLL_TO_SECTION) rather than with scrollIntoView.
		 */
		await evaluate(cdp, SCROLL_TO_SECTION);
		/*
		 * LET THE PAGE SETTLE before the first reading. The settings page loads
		 * its sections asynchronously, and content that appears ABOVE the import
		 * section moves the container's scroll position by itself - which is
		 * the page filling in, not the preview moving it. A reading taken
		 * before the page has settled would charge that movement to whatever
		 * happened next.
		 */
		await sleep(1200);

		/*
		 * BEFORE: the surface as it arrives, and the scroll state a preview
		 * build is about to be measured against.
		 */
		records.before = await evaluate(cdp, PROBE);

		if (OUT_DIR) {
			mkdirSync(OUT_DIR, { recursive: true });
			const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(
				join(OUT_DIR, "before.png"),
				Buffer.from(shot.data, "base64"),
			);
		}

		/*
		 * THE ONE INTERACTION: a session row is selected. On the old build this
		 * was the first of three separate steps, and the preview had to be
		 * asked for in another section. Here it is the only step before the
		 * acknowledgement.
		 */
		const selected = await evaluate(cdp, SELECT_A_ROW);
		if (selected !== true) {
			throw new Error("no session row to select");
		}
		/*
		 * SELECTED: the state BETWEEN the selection and the preview. The
		 * preview is debounced (250ms), so this reading is taken while the
		 * build is still pending, and the difference between it and the one
		 * below is EXACTLY what building the preview moved - which is the
		 * question the defect is about. Reading only "before the selection" and
		 * "after the preview" would charge the page's own loading to the
		 * preview.
		 */
		records.selected = await evaluate(cdp, PROBE);
		/*
		 * THE MANUAL PREVIEW CONTROL, on a build that still has one. The rig
		 * presses it when it is there, because the rig has to measure the build
		 * BEFORE the fix as well as after it, and on that build the preview is
		 * only ever built by pressing that button.
		 *
		 * The button does not exist until the selection has re-rendered, so the
		 * rig waits for it rather than pressing on the frame the row was
		 * clicked on.
		 */
		for (let i = 0; i < 40; i++) {
			if ((await evaluate(cdp, PREVIEW_BUILT)) === true) break;
			if ((await evaluate(cdp, PRESS_PREVIEW)) === true) {
				records.manualPreviewPressed = true;
				break;
			}
			await sleep(100);
		}
		await waitFor(cdp, PREVIEW_BUILT, "the preview to be built");
		/*
		 * LET THE COLOURS SETTLE before reading them. The checkbox and the row
		 * both transition their ground over `--transition-duration-fast` (120ms),
		 * and a probe fired the instant the preview lands reads the frame the
		 * transition started FROM - which is how a run against the pre-fix build
		 * reported the checked box's fill as the surface colour while its
		 * `data-state` said "checked". The number has to describe the state the
		 * user ends up looking at.
		 */
		await sleep(400);

		records.after = await evaluate(cdp, PROBE);

		if (OUT_DIR) {
			/*
			 * The frame is taken HERE, immediately after this state's numbers,
			 * because the flow walk below navigates the page again: a frame
			 * written after it would show the flow's end state under the
			 * "after" name, and a reader comparing the frame with the numbers
			 * beside it would be comparing two different states.
			 */
			const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(
				join(OUT_DIR, "after.png"),
				Buffer.from(shot.data, "base64"),
			);
		}

		/*
		 * THE FLOW'S STEP COUNT: how many separate interactions a user performs
		 * before the Import button is live. This is the defect that is not a
		 * pixel - three disconnected interactions (select, then find and press a
		 * button in another section, then tick a second, identically shaped
		 * empty square) became two (select, then tick the square that gates the
		 * button).
		 *
		 * The count is measured, not asserted: each step is a real click on a
		 * real control, and the walk stops the moment the Import button is
		 * enabled.
		 */
		records.flow = await measureFlow(cdp);

		if (OUT_DIR) {
			const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
			writeFileSync(
				join(OUT_DIR, "flow-complete.png"),
				Buffer.from(shot.data, "base64"),
			);
		}

		/*
		 * The states a still cannot infer: the debounce window, a refused
		 * preview, the completion CTA, the translucent ground, a narrow column
		 * and the light scheme. Each is measured and captured in one run, so the
		 * frames and the numbers beside them describe one DOM.
		 *
		 * AFTER the flow frame above, because this phase navigates the page:
		 * capturing flow-complete after it would photograph the LAST state
		 * measured here and label it as the flow's end.
		 */
		if (EXTRA_STATES) records.states = await captureStates(cdp, OUT_DIR);

		if (OUT_DIR) {
			const numbersPath = join(OUT_DIR, "numbers.json");
			const merged = existsSync(numbersPath)
				? JSON.parse(readFileSync(numbersPath, "utf8"))
				: {};
			merged.importSettingsGeometry = {
				viewport: VIEWPORT,
				...records,
				flow: records.flow,
			};
			writeFileSync(numbersPath, `${JSON.stringify(merged, null, 2)}\n`);
		}
	} finally {
		teardown();
	}

	if (AS_JSON) {
		console.log(JSON.stringify(records, null, 2));
		return;
	}

	const line = (m) =>
		[
			`window.scrollY=${m.window.scrollY}`,
			`documentElement.scrollTop=${m.document.scrollTop}`,
			`shellRoot.scrollTop=${m.shell ? m.shell.scrollTop : "-"}`,
			`shellRoot.scrollHeight/clientHeight=${m.shell ? `${m.shell.scrollHeight}/${m.shell.clientHeight}` : "-"}`,
			`content.scrollTop=${m.content ? m.content.scrollTop : "-"}`,
			`checkbox.data-state=${m.sessionCheckbox ? m.sessionCheckbox.dataState : "-"}`,
			`indicator=${m.sessionCheckbox ? (m.sessionCheckbox.indicatorMounted ? "mounted" : "absent") : "-"}`,
			`fill=${m.sessionCheckbox ? m.sessionCheckbox.fill : "-"}`,
			`row.selected=${m.selectedRow ? "yes" : "no"}`,
			`previewButton=${m.flow.previewButtonPresent ? "present" : "absent"}`,
			`importEnabled=${m.flow.importEnabled}`,
		].join("  ");
	console.log(
		`\nimport settings geometry — ${VIEWPORT.width}x${VIEWPORT.height}\n`,
	);
	console.log(`before:  ${line(records.before)}`);
	console.log(`after:   ${line(records.after)}`);
	console.log(
		`\nflow: ${records.flow.stepCount} interactions to an enabled Import button (${records.flow.steps.join(" -> ")})  importEnabled=${records.flow.importEnabled}`,
	);
	const before = records.before;
	const after = records.after;
	const mid = records.selected ?? before;
	console.log(
		`\nBUILDING THE PREVIEW MOVED:  shell root ${(after.shell?.scrollTop ?? 0) - (mid.shell?.scrollTop ?? 0)}px   window ${after.window.scrollY - mid.window.scrollY}px   content ${(after.content?.scrollTop ?? 0) - (mid.content?.scrollTop ?? 0)}px`,
	);
	console.log(
		`FROM ARRIVAL TO BUILT:         shell root ${(after.shell?.scrollTop ?? 0) - (before.shell?.scrollTop ?? 0)}px   window ${after.window.scrollY - before.window.scrollY}px   content ${(after.content?.scrollTop ?? 0) - (before.content?.scrollTop ?? 0)}px`,
	);
	const st = records.states ?? {};
	const stLine = (name) => {
		const m = st[name];
		if (!m) return `${name}: -`;
		const glass = m.glass
			? `  glass=${m.glass.kinds} canvasA=${m.glass.canvasAlpha} selectedA=${m.glass.selectedAlpha}`
			: "";
		const failure = m.previewFailure
			? `  failureInline=${m.previewFailure.inline} retryInGate=${m.previewFailure.retryInGate} spinner=${m.previewFailure.spinner}`
			: "";
		return `${name}: theme=${m.theme} scheme=${m.scheme} shellRoot.scrollTop=${m.shell ? m.shell.scrollTop : "-"} window.scrollY=${m.window.scrollY} content.scrollTop=${m.content ? m.content.scrollTop : "-"} checkbox=${m.sessionCheckbox ? m.sessionCheckbox.dataState : "-"} row=${m.selectedRow ? "selected" : "-"}${failure}${glass}`;
	};
	console.log("");
	for (const name of [
		"pending",
		"settled",
		"failure",
		"completion",
		"glass",
		"narrow",
		"light",
	]) {
		console.log(stLine(name));
	}
	if (OUT_DIR) console.log(`\nframes and numbers: ${OUT_DIR}`);
};

await main();
