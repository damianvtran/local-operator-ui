#!/usr/bin/env node
/**
 * Prove, by TYPING, which slash-completion gesture runs a command.
 *
 *     node scripts/slash-enter-proof.mjs <storybook-origin> <out-dir>
 *
 * The operator's report was that picking a command row in the composer's slash
 * popup completed the word and needed a SECOND Enter before the dialog opened.
 * Which half of that was true could not be answered by reading the source: the
 * pointer arm and the keyboard arm are one decision each, and the gesture that
 * was already working and the one that was not look identical in a diff.
 *
 * So this drives the real gesture at the real component: the production
 * `MessageInput` (Storybook story `chat-message-input--slash-enter`), over a
 * fixture command registry with a fixture desktop bridge, with a PRIVATE
 * `--headless=new` Chromium spoken to over raw CDP — real key events through
 * `Input.dispatchKeyEvent`, the same technique `scripts/mentioned-files-app-proof.mjs`
 * uses for Escape, and no browser-automation dependency.
 *
 * ## What it asserts, and what it does not
 *
 * Each case types a word, presses ONE key (or clicks one row), and reads back
 * what the composer did with it: the draft, whether the list is still up, which
 * list it is, and what the composer DISPATCHED — the story records every
 * `onSlashCommand` invocation on screen (`[data-slash-dispatched]`), which is the
 * half a screenshot alone would leave to the reader's memory of the old build.
 *
 * What it cannot see: the dialog a command opens. That is the dispatcher's path
 * (`slash-dispatch` → the picker host), and this story records the invocation
 * instead of rendering it; the live end-to-end walk belongs to the QA pass on
 * the built app. Nothing here is a claim that a panel mounted.
 *
 * ## Why a committed script and not a throwaway rig
 *
 * The repository already learned this once (`scripts/click-proof.mjs`): frames
 * that name a script living in one machine's `/tmp` are evidence nobody else can
 * re-derive. Both halves of this rig are in the tree — this driver, and the story
 * it drives — so the frames beside it can be reproduced with two commands:
 *
 *     pnpm storybook            # or: pnpm build-storybook && npx http-server ...
 *     node scripts/slash-enter-proof.mjs http://localhost:6006 docs/evidence/chat-slash-enter-gestures
 *
 * Running it against a tree WITHOUT the fix is the point of the pair: the same
 * command on `origin/main` records the same gestures completing instead of
 * running, which is what makes these frames evidence of the change rather than
 * of the feature.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/*
 * The switch every headless Chrome in this repository is launched with. A
 * scratch `HOME` has no login keychain, so Chrome tries to CREATE one and
 * macOS puts an authorization dialog on the operator's screen for a test run -
 * see `chrome-keychain.mjs`. `chrome-keychain.test.mjs` walks every launch site
 * in `scripts/`, so a rig that spawns Chrome without this fails the suite.
 */
import { withMockKeychain } from "./chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:6006";
const OUT = process.argv[3] ?? "docs/evidence/chat-slash-enter-gestures";
/*
 * The story's own id: `<kebab(title)>--<kebab(story)>` for
 * `Chat/Message input` / `SlashEnter` (`message-input.stories.tsx`). Named
 * rather than discovered so a rename fails loudly at the first wait instead of
 * photographing Storybook's own error page.
 */
const STORY = process.env.SLASH_PROOF_STORY ?? "chat-message-input--slash-enter";
/* The app's own default window, and the frame the story is authored at. */
const WIDTH = Number(process.env.SLASH_PROOF_WIDTH ?? 1380);
const HEIGHT = Number(process.env.SLASH_PROOF_HEIGHT ?? 900);
const THEME = process.env.SLASH_PROOF_THEME ?? "localOperatorDark";
/*
 * How long to wait for the story to render. Generous because a Storybook DEV
 * server compiles the story's module graph on first request and this app's
 * composer reaches most of the renderer: measured at ~90 s cold for the first
 * load on this box, then under 5 s for every load after it.
 */
const READY_MS = Number(process.env.SLASH_PROOF_READY_MS ?? 150_000);
/* The preview's persisted-preferences key, seeded so the store's theme and the
   story arg agree from the first paint (the same seam `capture-evidence.mjs`
   uses; without it the store rehydrates to whatever the last page left). */
const PREFS_KEY = "ui-preferences-storage";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The gestures, and what each one is FOR.
 *
 * `expect` is what the rule requires, not what the run happened to answer: the
 * `ran` field is the composer's own dispatch record, so a case that completes
 * when it must run fails here rather than being described as working.
 */
const CASES = [
	{
		name: "enter-runs-analytics",
		why: "The report: Enter on a command row completes the word and the dialog needs a second Enter.",
		word: "analytics",
		key: "Enter",
		expect: { ran: "/analytics", draft: "" },
	},
	{
		name: "enter-completes-a-list-command",
		why: "A destination that opens an inline list still only completes and opens it — `/model` never runs on the Enter that names it.",
		word: "model",
		key: "Enter",
		expect: { ran: "none", draft: "/model ", list: "Command arguments" },
	},
	{
		name: "tab-never-runs",
		why: "Tab is the completion key: it takes the highlighted row and never runs it.",
		word: "analytics",
		key: "Tab",
		expect: { ran: "none", draft: "/analytics ", list: null },
	},
	{
		name: "ambiguous-enter-grows-the-prefix",
		why: "`/l` leaves the whole `l` family (`login`, `logout`, `loop` — the real registry's own set), so Enter grows the word to their common prefix `lo` and leaves the list up.",
		word: "l",
		key: "Enter",
		expect: { ran: "none", draft: "/lo", list: "Slash commands" },
	},
	{
		name: "ambiguous-enter-keeps-the-written-message",
		why: "The same growth on a draft that has a message after the word — the shape review round 1 (F1) found the separator being deleted from, turning `/l hello` into `/lohello`.",
		word: "l",
		trailing: " hello",
		caretLefts: 6,
		key: "Enter",
		expect: { ran: "none", draft: "/lo hello", list: "Slash commands" },
	},
	{
		name: "click-runs-analytics",
		why: "The pointer arm, which already worked: a click on the row runs the command on the same pick.",
		word: "ana",
		click: "/analytics",
		expect: { ran: "/analytics", draft: "" },
	},
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "slash-enter-proof-"));
const chrome = spawn(
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
		const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
		if (m) {
			clearTimeout(t);
			resolve(m[1]);
		}
	});
});

const browser = new WebSocket(wsUrl);
await new Promise((r) => (browser.onopen = r));
let nextId = 1;
const pending = new Map();
browser.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
const raw = (method, params = {}, sessionId) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		browser.send(
			JSON.stringify({
				id,
				method,
				params,
				...(sessionId ? { sessionId } : {}),
			}),
		);
	});

const target = await raw("Target.createTarget", { url: "about:blank" });
const attached = await raw("Target.attachToTarget", {
	targetId: target.targetId,
	flatten: true,
});
const sessionId = attached.sessionId;
const send = (method, params = {}) => raw(method, params, sessionId);

async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails) {
		throw new Error(res.exceptionDetails.exception?.description ?? "page error");
	}
	return res.result.value;
}

/** Everything a case can read back, in one probe. */
const READ_STATE = `(() => {
	const text = (node) => (node ? node.textContent.replace(/\\s+/g, " ").trim() : null);
	const box = document.querySelector('[role="listbox"]');
	const options = box ? [...box.querySelectorAll('[role="option"]')] : [];
	const active = box ? box.querySelector('[role="option"][aria-selected="true"]') : null;
	return {
		draft: document.querySelector("textarea")?.value ?? null,
		list: box ? box.getAttribute("aria-label") : null,
		/* The popup's own phase label: its first row says "Commands" or the
		   argument list's subject ("Models"). */
		phase: box ? text(box.firstElementChild) : null,
		rows: options.map((node) => text(node)),
		active: active ? text(active) : null,
		ran: text(document.querySelector("[data-slash-dispatched]")),
	};
})()`;

/** A real key press, dispatched the way a keyboard sends one. */
async function press(keyName, code, virtualKeyCode, modifiers = 0) {
	for (const type of ["keyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			key: keyName,
			code,
			windowsVirtualKeyCode: virtualKeyCode,
			nativeVirtualKeyCode: virtualKeyCode,
			modifiers,
		});
	}
}

const KEYS = {
	Enter: ["Enter", "Enter", 13],
	Tab: ["Tab", "Tab", 9],
};

async function shoot(name) {
	const { data } = await send("Page.captureScreenshot", {
		format: "png",
	});
	const path = join(OUT, `${name}.png`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return path;
}

/**
 * Load the story fresh, so each case starts from a mounted composer.
 *
 * The DRAFT is not cleared here: it belongs to the conversation store and comes
 * back with the page, which is why `typeWord` clears it with real keys before
 * typing. This only waits for the composer to exist.
 */
async function reset() {
	await send("Page.navigate", { url: "about:blank" });
	await wait(150);
	await send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${STORY}&viewMode=story&args=theme:${THEME}`,
	});
	const started = Date.now();
	for (;;) {
		const ready = await evaluate(
			`(() => {
				const field = document.querySelector("textarea");
				return field ? { ok: true, value: field.value } : { ok: false };
			})()`,
		);
		if (ready.ok) return;
		if (Date.now() - started > READY_MS) {
			throw new Error(
				`the story's composer never rendered (last: ${JSON.stringify(ready)})`,
			);
		}
		await wait(200);
	}
}

/** Focus the composer the way a user does, then type the word. */
async function typeWord(word, trailing = "", caretLefts = 0) {
	const point = await evaluate(`(() => {
		const field = document.querySelector("textarea");
		if (!field) return null;
		const r = field.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!point) throw new Error("no composer textarea to focus");
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
			modifiers: 0,
			pointerType: "mouse",
		});
	}
	/*
	 * Clear the draft before typing.
	 *
	 * The composer persists its draft per conversation
	 * (`conversation-input-store`), and this story always speaks for the same
	 * one, so a reload does NOT start from an empty box: the previous case's
	 * word comes back with it. Measured, not assumed — the first run of this
	 * driver failed on exactly that ("never rendered an empty draft (last:
	 * "/model ")").
	 *
	 * The SELECTION is set here and the DELETE is a real key event: selecting
	 * all is a caret fact the page can state for the driver, while the word is
	 * removed by the composer's own handling of Backspace, which is what makes
	 * the store end up holding "" as any keystroke would leave it.
	 */
	await evaluate(`(() => {
		const field = document.querySelector("textarea");
		field.focus();
		field.setSelectionRange(0, field.value.length);
		return field.value.length;
	})()`);
	await press("Backspace", "Backspace", 8, 0);
	const cleared = await evaluate(
		`document.querySelector("textarea")?.value ?? null`,
	);
	if (cleared !== "") {
		throw new Error(
			`the draft did not clear before typing (last: ${JSON.stringify(cleared)})`,
		);
	}
	/*
	 * `Input.insertText` rather than a DOM write: the composer is a CONTROLLED
	 * textarea, and a value written straight into the DOM fires no input event,
	 * so React would never see the draft and the popup would never open. This is
	 * the same path a paste takes. The leading slash is part of the gesture — it
	 * is what makes the token a command — and the cases carry the WORD, the way
	 * the query the matcher reads does.
	 */
	await send("Input.insertText", { text: `/${word}${trailing}` });
	/*
	 * A draft with a message after the word needs its caret INSIDE the word, and
	 * these are real arrow presses rather than a `setSelectionRange`: the composer
	 * keeps its own caret state (`onSelect`), so a selection written straight into
	 * the DOM would leave React reading the old position and the list would never
	 * open. Six Lefts from the end of `/l hello` land right after the `l`.
	 */
	for (let i = 0; i < caretLefts; i += 1) {
		await press("ArrowLeft", "ArrowLeft", 37);
	}
	/* The popup opens on the query's own render, not on a timer, but the list's
	   rows come from the fixture's query — wait for the box rather than a fixed
	   sleep, so a slow first render cannot be read as "no list". */
	const started = Date.now();
	for (;;) {
		const open = await evaluate(
			`Boolean(document.querySelector('[role="listbox"]'))`,
		);
		if (open) return;
		if (Date.now() - started > 10_000) {
			throw new Error(`the list never opened for "/${word}"`);
		}
		await wait(100);
	}
}

/** A real press-and-release at the named row's painted centre. */
async function clickRow(label) {
	const point = await evaluate(`(() => {
		const box = document.querySelector('[role="listbox"]');
		if (!box) return null;
		const row = [...box.querySelectorAll('[role="option"]')].find((node) =>
			node.textContent.includes(${JSON.stringify(label)}),
		);
		if (!row) return null;
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!point) throw new Error(`no row matching ${label} in the list`);
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: point.x,
		y: point.y,
		button: "none",
		buttons: 0,
		clickCount: 0,
		modifiers: 0,
		pointerType: "mouse",
	});
	for (const type of ["mousePressed", "mouseReleased"]) {
		await send("Input.dispatchMouseEvent", {
			type,
			x: point.x,
			y: point.y,
			button: "left",
			buttons: type === "mousePressed" ? 1 : 0,
			clickCount: 1,
			modifiers: 0,
			pointerType: "mouse",
		});
	}
}

const pageProblems = [];
browser.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Runtime.exceptionThrown") {
		pageProblems.push(
			`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`,
		);
	}
	if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
		pageProblems.push(
			`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`,
		);
	}
});

mkdirSync(OUT, { recursive: true });

const record = {
	origin: ORIGIN,
	story: STORY,
	theme: THEME,
	viewport: { width: WIDTH, height: HEIGHT },
	driver: "scripts/slash-enter-proof.mjs",
	at: new Date().toISOString(),
	cases: [],
};

let failures = 0;
try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: WIDTH,
		height: HEIGHT,
		deviceScaleFactor: 1,
		mobile: false,
	});
	/*
	 * Focus emulation, because a headless browser's page is never focused and
	 * the composer's own `:focus-visible` ring is part of what a reviewer reads
	 * off the frame (`capture-evidence.mjs` enables the same switch).
	 */
	await send("Emulation.setFocusEmulationEnabled", { enabled: true });

	for (const testCase of CASES) {
		const gesture = testCase.click
			? `click on the "${testCase.click}" row after typing "/${testCase.word}"`
			: `${testCase.key} after typing "/${testCase.word}"`;
		await reset();
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(THEME)} }, version: 0 })); } catch {}`,
		});		await typeWord(testCase.word, testCase.trailing, testCase.caretLefts);
		const before = await evaluate(READ_STATE);
		const beforeFrame = await shoot(`${testCase.name}-before`);
		if (testCase.click) {
			await clickRow(testCase.click);
		} else {
			await press(...KEYS[testCase.key]);
		}
		await sleep(400);
		const after = await evaluate(READ_STATE);
		const afterFrame = await shoot(`${testCase.name}-after`);

		const mismatches = [];
		for (const [field, expected] of Object.entries(testCase.expect)) {
			const actual = after[field];
			if (actual !== expected) {
				mismatches.push(`${field}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
			}
		}
		if (mismatches.length > 0) failures += 1;
		record.cases.push({
			name: testCase.name,
			why: testCase.why,
			gesture,
			expect: testCase.expect,
			before,
			after,
			beforeFrame,
			afterFrame,
			verdict: mismatches.length === 0 ? "PASS" : "FAIL",
			mismatches,
		});
		console.log(
			`${mismatches.length === 0 ? "PASS" : "FAIL"} ${testCase.name}: ${gesture}`,
		);
		console.log(
			`  before: draft=${JSON.stringify(before.draft)} list=${JSON.stringify(before.list)} active=${JSON.stringify(before.active)} ran=${JSON.stringify(before.ran)}`,
		);
		console.log(
			`  after:  draft=${JSON.stringify(after.draft)} list=${JSON.stringify(after.list)} phase=${JSON.stringify(after.phase)} ran=${JSON.stringify(after.ran)}`,
		);
		for (const mismatch of mismatches) console.log(`  ${mismatch}`);
	}
} finally {
	record.pageProblems = pageProblems;
	record.failures = failures;
	writeFileSync(join(OUT, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
	chrome.kill("SIGTERM");
}

console.log(
	`\n${CASES.length - failures}/${CASES.length} gestures behaved as the rule requires; record: ${join(OUT, "result.json")}`,
);
process.exit(failures === 0 ? 0 : 1);
