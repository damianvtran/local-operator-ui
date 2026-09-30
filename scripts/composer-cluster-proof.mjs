#!/usr/bin/env node
/**
 * Drive the composer cluster's three surfaces and photograph what the keys do.
 *
 *     node scripts/composer-cluster-proof.mjs <storybook-origin> <out-dir>
 *
 * The story is `chat-message-input--composer-cluster` — the PRODUCTION composer
 * over a fixture desk bridge and a fixture `/theme` host — and this rig speaks
 * raw CDP to a private `--headless=new` Chromium (the same technique
 * `scripts/slash-enter-proof.mjs` states; no browser-automation dependency).
 *
 * ## What each case is, and what makes the pair evidence
 *
 * The three claims are about STATE THAT ONLY EXISTS MID-GESTURE, so each case
 * types (or pastes) a draft, presses real keys through
 * `Input.dispatchKeyEvent`, and reads back the draft plus the story's two
 * record strips:
 *
 *   - `history-*` (issue #673): the recall's engagement rule. The EMPTY case is
 *     the preserved gesture and must agree on both trees; the DRAFT cases are
 *     the defect, and the same script run on a tree WITHOUT the fix records the
 *     draft being swapped for a recall — `FAIL` in its `result.json`, which is
 *     exactly what the before frames show.
 *   - `skill-*` (issue #664): the `$` list. On a tree without the feature the
 *     list never opens, so the accept case clicks nothing (the draft survives,
 *     un-reassembled) and the send case's Enter submits the RAW text — the
 *     `[data-sent]` strip carries both halves byte for byte.
 *   - `theme-*` (issue #676): `/theme dracula` dispatched, the story mounts the
 *     real `ThemePicker` with the dispatcher's action shape. Both trees mount a
 *     dialog; what differs is its content — the grid (before) versus the
 *     confirmation receipt (after) — and `dialogRows` reads the difference.
 *
 * ## Why a committed script and not a throwaway rig
 *
 * Both halves are in the tree — this driver, and the story it drives — so the
 * frames can be re-derived with two commands, and running it against a tree
 * without each fix is the point of every pair:
 *
 *     pnpm storybook
 *     node scripts/composer-cluster-proof.mjs http://localhost:6006 "$OUT"
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/*
 * The switch every headless Chrome in this repository is launched with. A
 * scratch `HOME` has no login keychain, so Chrome tries to CREATE one and
 * macOS puts an authorization dialog on the operator's screen for a test run —
 * see `chrome-keychain.mjs`. `chrome-keychain.test.mjs` walks every launch site
 * in `scripts/`, so a rig that spawns Chrome without this fails the suite.
 */
import { withMockKeychain } from "./chrome-keychain.mjs";

/*
 * The one regex this rig needs, at module scope: biome's `useTopLevelRegex`
 * charges a literal compiled inside a function, and the stderr listener below
 * runs on every chunk Chrome writes.
 */
const DEVTOOLS_LISTENING = /DevTools listening on (ws:\/\/[^\s]+)/;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:6006";
const OUT = process.argv[3] ?? "docs/evidence/chat-composer-cluster";
/*
 * The story's own id: `<kebab(title)>--<kebab(story)>` for `Chat/Message input`
 * / `ComposerCluster` (`message-input.stories.tsx`). Named rather than
 * discovered so a rename fails loudly at the first wait instead of
 * photographing Storybook's own error page.
 */
const STORY =
	process.env.COMPOSER_PROOF_STORY ?? "chat-message-input--composer-cluster";
/* The app's own default window, and the frame the story is authored at. */
const WIDTH = Number(process.env.COMPOSER_PROOF_WIDTH ?? 1380);
const HEIGHT = Number(process.env.COMPOSER_PROOF_HEIGHT ?? 900);
const THEME = process.env.COMPOSER_PROOF_THEME ?? "localOperatorDark";
/*
 * How long to wait for the story to render. Generous because a Storybook DEV
 * server compiles the story's module graph on first request and this app's
 * composer reaches most of the renderer: measured at ~90 s cold for the first
 * load on this box, then under 5 s for every load after it.
 */
const READY_MS = Number(process.env.COMPOSER_PROOF_READY_MS ?? 150_000);

/* The preview's persisted-preferences key, seeded so the store's theme and the
   story arg agree from the first paint (the same seam `capture-evidence.mjs`
   uses; without it the store rehydrates to whatever the last page left). */
const PREFS_KEY = "ui-preferences-storage";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The gestures, and what each one is FOR.
 *
 * `expect` is written as a PREDICATE over the post-gesture reading, and it is
 * what the rule requires rather than what the run happened to answer: on a tree
 * without a given fix the case records FAIL with the state the frame shows,
 * which is the other half of every pair.
 */
const CASES = [
	{
		name: "history-empty-recalls",
		why: "The preserved gesture: an empty box still recalls (newest first) and ArrowDown returns past the newest to the empty draft. Both trees must agree — the fix narrows the trigger, it does not remove the walk.",
		drive: async () => {
			await clearDraft();
			await press(...KEYS.ArrowUp);
			await sleep(400);
			const recalled = await evaluate(READ_STATE);
			await press(...KEYS.ArrowDown);
			await sleep(400);
			const returned = await evaluate(READ_STATE);
			return { state: recalled, extra: { returned } };
		},
		expect: (state, extra) => [
			["draft", state.draft, "run the migration again please"],
			["after ArrowDown", extra.returned.draft, ""],
		],
	},
	{
		name: "history-draft-survives-arrowup",
		why: "The defect: a single-line draft with the caret at column 0. Before, the first-line gate took the recall branch and swapped the draft; after, ArrowUp is the textarea's own movement and the draft is intact.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "draft" });
			/* Column 0 via a real key: Home on the only line. */
			await press("Home", "Home", 36);
			await sleep(200);
			await press(...KEYS.ArrowUp);
			await sleep(400);
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [["draft", state.draft, "draft"]],
	},
	{
		name: "history-draft-multiline-arrowup",
		why: "The same misfire on a multi-line draft: the caret is walked onto line 1 by a native ArrowUp first (both trees), and the SECOND ArrowUp is the one the old gate misfired on — before, the draft is replaced by a recall; after, nothing moves at the top of the draft.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "one\ntwo" });
			/* The caret the insertion actually left, recorded before any key: the
			   first press below is only a NATIVE move if the caret starts on line
			   2, and the probe exists so that claim is read rather than assumed. */
			const typed = await evaluate(READ_STATE);
			await press(...KEYS.ArrowUp);
			await sleep(300);
			const before = await evaluate(READ_STATE);
			await press(...KEYS.ArrowUp);
			await sleep(400);
			return { state: await evaluate(READ_STATE), extra: { typed, before } };
		},
		expect: (state) => [["draft", state.draft, "one\ntwo"]],
	},
	{
		name: "skill-list-opens",
		why: "The `$` list: typed inline (`fix this $res`), the list opens over the discovered vocabulary — the one row the evidence admits starts with `res` — where before there was no list at all.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "fix this $res" });
			await waitForList();
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [
			["list", state.list, "Skills"],
			["rows", state.rows.length, 1],
			[
				"active starts with the skill",
				String(state.active).startsWith("$research"),
				true,
			],
		],
	},
	{
		name: "skill-list-empty",
		why: 'A `$` query with NO matches keeps its listbox and says the miss (design round 1, D3): `$zzz` unmounted the list silently where the sibling `/` palette renders "No commands match." in the same place, so the two lists disagreed about how to answer a miss. The before half records the silent unmount (no listbox at all).',
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "$zzz" });
			await waitForList();
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [
			["list", state.list, "Skills"],
			["no rows", state.rows.length, 0],
			[
				"the miss is stated",
				String(state.listText).includes("No skills match."),
				true,
			],
		],
	},
	{
		name: "skill-accepted-reassembles",
		why: "Accepting the row: the token moves to the FRONT with the surviving draft as its request (`fix this $res` → `$research fix this `), staged for send. The click is used here so the before tree — which has no list to click — simply leaves the draft alone; the keyboard accept is the unit suites' (the accept write is `skillCompletionFor`, executed there).",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "fix this $res" });
			await waitForList();
			await clickRow("$research");
			await sleep(400);
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [["draft", state.draft, "$research fix this "]],
	},
	{
		name: "skill-send-expands",
		why: "The submission: Enter accepts the row, then Enter sends — and the `[data-sent]` strip is the claim, because the payload is `invoke.py`'s expansion. Before, the same keys sent the raw prose (`fix this $res`), which is the second half of the pair.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "fix this $res" });
			await waitForList();
			await press(...KEYS.Enter);
			await sleep(400);
			await press(...KEYS.Enter);
			await sleep(600);
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [
			[
				"the payload is the skill expansion",
				String(state.sent).startsWith(
					"The user invoked the `research` skill directly.",
				),
				true,
			],
			[
				"the typed line rides the attribute",
				String(state.sent).includes(
					'<skill name="research" invocation="$research fix this">',
				),
				true,
			],
			[
				"the request is the last line",
				String(state.sent).endsWith("fix this"),
				true,
			],
			["the box retired the send", state.draft, ""],
		],
	},
	{
		name: "theme-qualified-confirms",
		why: "The double selection (issue #676): `/theme dracula` submits and the dialog mounts. Before, the full grid under the applied receipt; after, the confirmation — the receipt and no rows.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "/theme dracula" });
			await sleep(300);
			/* The argument list is up; Escape closes it so Enter is the SUBMIT
			   (the same two presses a user makes when they type rather than pick). */
			await press(...KEYS.Escape);
			await sleep(200);
			await press(...KEYS.Enter);
			await waitForDialog();
			/* The dialog's own mount effect applies the theme and writes the receipt one
			   render later; reading at the first paint raced it (measured: an empty
			   receipt beside a correct frame), so the read lets that render land. */
			await sleep(400);
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [
			["dispatched", state.dispatched, "/theme dracula"],
			[
				"the receipt is the dialog",
				String(state.dialog).includes("Theme: Dracula"),
				true,
			],
			["no grid behind it", state.dialogRows, 0],
		],
	},
	{
		name: "theme-bare-keeps-the-grid",
		why: "The modal remains for a bare `/theme`: no argument names the choice, so the table IS the surface. Both trees must agree on this frame — it is the counter-case that keeps the confirmation from being a removal.",
		drive: async () => {
			await clearDraft();
			await send("Input.insertText", { text: "/theme" });
			await sleep(300);
			await press(...KEYS.Escape);
			await sleep(200);
			await press(...KEYS.Enter);
			await waitForDialog();
			/* The dialog's own mount effect applies the theme and writes the receipt one
			   render later; reading at the first paint raced it (measured: an empty
			   receipt beside a correct frame), so the read lets that render land. */
			await sleep(400);
			return { state: await evaluate(READ_STATE) };
		},
		expect: (state) => [
			["dispatched", state.dispatched, "/theme"],
			["the grid is up", state.dialogRows > 0, true],
			[
				"and it holds the real table",
				String(state.dialog).includes("Dracula"),
				true,
			],
		],
	},
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "composer-cluster-proof-"));
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
		const m = buf.match(DEVTOOLS_LISTENING);
		if (m) {
			clearTimeout(t);
			resolve(m[1]);
		}
	});
});

const browser = new WebSocket(wsUrl);
await new Promise((resolve) => {
	browser.onopen = resolve;
});
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
const raw = (method, params, sessionId) =>
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
		throw new Error(
			res.exceptionDetails.exception?.description ?? "page error",
		);
	}
	return res.result.value;
}

/** Everything a case can read back, in one probe. */
const READ_STATE = `(() => {
	const text = (node) => (node ? node.textContent.replace(/\\s+/g, " ").trim() : null);
	const box = document.querySelector('[role="listbox"]');
	const dialog = document.querySelector('[role="dialog"]');
	const options = box ? [...box.querySelectorAll('[role="option"]')] : [];
	const active = box ? box.querySelector('[role="option"][aria-selected="true"]') : null;
	return {
		draft: document.querySelector("textarea")?.value ?? null,
		/* The DOM caret, so a walk case can prove WHERE the walk started rather
		   than describing it: the multiline case's second press is only the
		   misfire if the first one genuinely parked the caret on line 1. */
		sel: document.querySelector("textarea")?.selectionStart ?? null,
		list: box ? box.getAttribute("aria-label") : null,
		/* The listbox's whole text: a no-match query's box holds no options but
		   does hold the miss (design round 1, D3), which the rows field cannot see. */
		listText: text(box),
		rows: options.map((node) => text(node)),
		active: active ? text(active) : null,
		sent: text(document.querySelector("[data-sent]")),
		dispatched: text(document.querySelector("[data-dispatched]")),
		dialog: text(dialog),
		/* The dialog's own row count: the grid is rows; a confirmation has none. */
		dialogRows: dialog ? dialog.querySelectorAll('[role="option"]').length : 0,
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
	Escape: ["Escape", "Escape", 27],
	ArrowUp: ["ArrowUp", "ArrowUp", 38],
	ArrowDown: ["ArrowDown", "ArrowDown", 40],
	Backspace: ["Backspace", "Backspace", 8],
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
 * The DRAFT is not cleared by the reload: it belongs to the conversation store
 * and comes back with the page, which is why `clearDraft` works with real keys
 * before each case types.
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
				return field ? { ok: true } : { ok: false };
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

/** Focus the composer the way a user does. */
async function focusComposer() {
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
}

/**
 * Clear the draft before typing.
 *
 * The composer persists its draft per conversation, and this story always
 * speaks for the same one, so a reload does NOT start from an empty box: the
 * previous case's text comes back with it. The SELECTION is set here and the
 * DELETE is a real key event — selecting all is a caret fact the page can state
 * for the driver, while the removal is the composer's own handling of
 * Backspace, which is what makes React see it.
 */
async function clearDraft() {
	await focusComposer();
	for (let round = 0; round < 4; round += 1) {
		await evaluate(`(() => {
			const field = document.querySelector("textarea");
			if (!field) return;
			field.focus();
			field.setSelectionRange(0, field.value.length);
			return field.value.length;
		})()`);
		await press(...KEYS.Backspace);
		await sleep(120);
		const value = await evaluate(
			`document.querySelector("textarea")?.value ?? null`,
		);
		if (value === "") return;
	}
	throw new Error("the draft did not clear before the case's typing");
}

/**
 * Wait for a listbox to be up — with a non-fatal timeout.
 *
 * NOT fatal, deliberately, and this is what makes the BEFORE halves work on a
 * tree WITHOUT the fix: on the base tree there is no `$` list, so a case waits
 * for a box that never opens. A driver that threw here could not produce a
 * before record at all; returning lets the frame be taken and the case record
 * its own mismatch, which is exactly the evidence the pair exists to show.
 */
async function waitForList() {
	const started = Date.now();
	for (;;) {
		const open = await evaluate(
			`Boolean(document.querySelector('[role="listbox"]'))`,
		);
		if (open) return;
		if (Date.now() - started > 10_000) {
			console.log("  (no list opened — recording the state as it stands)");
			return;
		}
		await wait(100);
	}
}

async function waitForDialog() {
	const started = Date.now();
	for (;;) {
		const open = await evaluate(
			`Boolean(document.querySelector('[role="dialog"]'))`,
		);
		if (open) return;
		if (Date.now() - started > 10_000) {
			console.log("  (no dialog mounted — recording the state as it stands)");
			return;
		}
		await wait(100);
	}
}

/** A real press-and-release at the named row's painted centre. */
async function clickRow(label) {
	const point = await evaluate(`(() => {
		const box = document.querySelector('[role="listbox"]');
		if (!box) return null;
		const rows = [...box.querySelectorAll('[role="option"]')];
		const row = rows.find((node) => node.textContent.includes(${JSON.stringify(label)}));
		if (!row) return null;
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (!point) {
		console.log(
			`  (no row matching ${JSON.stringify(label)} — nothing clicked)`,
		);
		return false;
	}
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
	return true;
}

const pageProblems = [];
browser.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data);
	if (msg.method === "Runtime.exceptionThrown") {
		pageProblems.push(
			`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`,
		);
	}
	if (
		msg.method === "Runtime.consoleAPICalled" &&
		msg.params.type === "error"
	) {
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
	driver: "scripts/composer-cluster-proof.mjs",
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
		await reset();
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(THEME)} }, version: 0 })); } catch {}`,
		});
		const { state, extra } = await testCase.drive();
		const frame = await shoot(testCase.name);

		const mismatches = [];
		for (const [field, actual, expected] of testCase.expect(
			state,
			extra ?? {},
		)) {
			if (actual !== expected) {
				mismatches.push(
					`${field}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`,
				);
			}
		}
		if (mismatches.length > 0) failures += 1;
		record.cases.push({
			name: testCase.name,
			why: testCase.why,
			state,
			extra: extra ?? null,
			frame,
			verdict: mismatches.length === 0 ? "PASS" : "FAIL",
			mismatches,
		});
		console.log(
			`${mismatches.length === 0 ? "PASS" : "FAIL"} ${testCase.name}`,
		);
		console.log(
			`  draft=${JSON.stringify(state.draft)} list=${JSON.stringify(state.list)} sent=${JSON.stringify(String(state.sent).slice(0, 60))}… dialogRows=${state.dialogRows} dispatched=${JSON.stringify(state.dispatched)}`,
		);
		for (const mismatch of mismatches) console.log(`  ${mismatch}`);
	}
} finally {
	record.pageProblems = pageProblems;
	record.failures = failures;
	writeFileSync(
		join(OUT, "result.json"),
		`${JSON.stringify(record, null, 2)}\n`,
	);
	chrome.kill("SIGTERM");
}

console.log(
	`\n${CASES.length - failures}/${CASES.length} cases behaved as the rule requires; record: ${join(OUT, "result.json")}`,
);
process.exit(failures === 0 ? 0 : 1);
