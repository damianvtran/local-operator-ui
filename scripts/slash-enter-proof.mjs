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

/*
 * The one regex this rig needs, at module scope: biome's `useTopLevelRegex`
 * charges a literal compiled inside a function, and the stderr listener below
 * runs on every chunk Chrome writes.
 */
const DEVTOOLS_LISTENING = /DevTools listening on (ws:\/\/[^\s]+)/;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:6006";
const OUT = process.argv[3] ?? "docs/evidence/chat-slash-enter-gestures";
/*
 * The story's own id: `<kebab(title)>--<kebab(story)>` for
 * `Chat/Message input` / `SlashEnter` (`message-input.stories.tsx`). Named
 * rather than discovered so a rename fails loudly at the first wait instead of
 * photographing Storybook's own error page.
 */
const STORY =
	process.env.SLASH_PROOF_STORY ?? "chat-message-input--slash-enter";
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
		name: "ambiguous-enter-at-bare-slash",
		why: "The popup's FIRST state, and the one a browsing user presses Enter in: `/` matches everything, the candidates share no prefix, so the word cannot grow and Enter is deliberately inert. The line has to name the gestures that act instead (UX round 1, U1-U3).",
		word: "",
		key: "Enter",
		expect: {
			ran: "none",
			draft: "/",
			list: "Slash commands",
			enterNote:
				"Enter needs a row you pick: ↓ then Enter · Tab completes this row.",
		},
	},
	{
		name: "ambiguous-enter-at-the-shared-prefix",
		why: "The same inert key in the state `/l` + Enter just grew into: `/lo` IS the common prefix of `login`, `logout` and `loop`, so a second Enter cannot narrow either, and the same line has to carry it (U2).",
		word: "lo",
		key: "Enter",
		expect: {
			ran: "none",
			draft: "/lo",
			list: "Slash commands",
			enterNote:
				"Enter needs a row you pick: ↓ then Enter · Tab completes this row.",
		},
	},
	{
		name: "enter-completes-and-the-next-enter-runs",
		why: "The U4 arm: `/clear`'s destination declines a POINTER run like `/model`'s, but its completion closes the list, so the NEXT Enter runs it. Its line says so, and that line is in this case's BEFORE frame (the popup is gone by the AFTER one, which is why only the outcome is asserted here — the wording is pinned by `slash-contract.test.mjs`).",
		word: "clear",
		key: "Enter",
		expect: { ran: "none", draft: "/clear ", list: null },
	},
	{
		name: "click-runs-analytics",
		why: "The pointer arm, which already worked: a click on the row runs the command on the same pick.",
		word: "ana",
		click: "/analytics",
		expect: { ran: "/analytics", draft: "" },
	},
	/*
	 * THE `/rename` FLAG ROW, the operator's report, in both halves.
	 *
	 * Six cases rather than two because the report had two defects and each needs
	 * its own frame pair: the row did not SUGGEST as the user typed (`-`, `--`, `r`,
	 * `ref`), and a CLICK on it autofilled the composer and waited for Enter
	 * instead of performing the refresh. A single `ref` case would show both, but
	 * the typed-word half is exactly the list the report said was empty, so each
	 * spelling the user named gets its own before/after pair — that is what makes
	 * the frames evidence about the suggestion rather than about the click.
	 *
	 * The list label is `Options` (`ARGUMENT_SOURCE_LABEL`), not `Arguments`: the
	 * rows are spelling options for one flag, and the label says so. Asserting it
	 * here is what catches a source added without a label, because `phaseLabel`
	 * falls back to the un-named `Arguments` only when `source` is undefined.
	 *
	 * The DISPATCHED value is the hard half: the row's click must reach
	 * `onSlashCommand` as `rename --refresh` (the same command the dispatcher
	 * posts and the backend's `parse_title_arg` reads as a refresh), and the box
	 * must be EMPTY afterwards — a click that only autofilled would show `ran:
	 * none` with the draft carrying the flag, which is the defect's own frame.
	 */
	{
		name: "rename-suggests-on-dash",
		why: "The first half of the report: typing `-` must offer the `--refresh` row. Before the fix this list did not exist, so the gesture produced an empty state.",
		word: "rename -",
		typeOnly: true,
		expect: {
			ran: "none",
			draft: "/rename -",
			list: "Command arguments",
			phase: "Options",
			active:
				"--refreshRe-read the conversation and name it againresumes auto-naming",
		},
	},
	{
		name: "rename-suggests-on-double-dash",
		why: "`--`: the row is the only candidate the dash-dash prefix can mean, so it is highlighted and the list is up.",
		word: "rename --",
		typeOnly: true,
		expect: {
			ran: "none",
			draft: "/rename --",
			list: "Command arguments",
			phase: "Options",
			active:
				"--refreshRe-read the conversation and name it againresumes auto-naming",
		},
	},
	{
		name: "rename-suggests-on-r",
		why: "`r`: offered as a subsequence of `--refresh`, the same fuzzy habit every other command's list teaches.",
		word: "rename r",
		typeOnly: true,
		expect: {
			ran: "none",
			draft: "/rename r",
			list: "Command arguments",
			phase: "Options",
			active:
				"--refreshRe-read the conversation and name it againresumes auto-naming",
		},
	},
	{
		name: "rename-suggests-on-ref",
		why: "`ref`, the spelling the operator named. The row displays `--refresh` while matching the typed `ref` — the alias buys rank, the row teaches the flag.",
		word: "rename ref",
		typeOnly: true,
		expect: {
			ran: "none",
			draft: "/rename ref",
			list: "Command arguments",
			phase: "Options",
			active:
				"--refreshRe-read the conversation and name it againresumes auto-naming",
		},
	},
	{
		name: "rename-suggests-on-bare-word",
		why: "`refresh`, the bare spelling the row carries as an alias: an exact hit on the alias, displayed as the flag the row teaches.",
		word: "rename refresh",
		typeOnly: true,
		expect: {
			ran: "none",
			draft: "/rename refresh",
			list: "Command arguments",
			phase: "Options",
			active:
				"--refreshRe-read the conversation and name it againresumes auto-naming",
		},
	},
	{
		name: "rename-empty-space-offers-nothing",
		why: "The bare space after the word, the state the operator's report photographed: the flag list does NOT open on an empty query, so the naming form's gesture is untouched. Before the fix this list did not exist at all; after it, this state is deliberately still empty.",
		word: "rename ",
		typeOnly: true,
		noListBefore: true,
		expect: {
			ran: "none",
			draft: "/rename ",
			list: null,
			phase: null,
			active: null,
		},
	},
	{
		name: "rename-click-runs-the-refresh",
		why: "The second half of the report: a CLICK on the row must RUN the refresh on the same gesture, not autofill and wait for Enter.",
		word: "rename ref",
		click: "--refresh",
		expect: { ran: "/rename --refresh", draft: "", list: null },
	},
	{
		name: "rename-bare-enter-opens-the-form",
		why: "The no-regression half: bare `/rename ` + Enter still presents the naming form (recorded as the invocation `rename` with empty args) and does NOT run a refresh. The flag row must not turn the space that opens the form into a run — the empty-query arm of `slashRunAllowed` is what keeps this true.",
		word: "rename ",
		key: "Enter",
		noListBefore: true,
		expect: { ran: "/rename", list: null },
	},
	{
		name: "rename-titled-enter-keeps-the-title",
		why: "The other no-regression half: `/rename quarterly review` is a literal title, dispatched with those words as its argument, and never a refresh. The flag list is shut over it — a title matches no flag — so nothing is drawn over the sentence.",
		word: "rename quarterly review",
		key: "Enter",
		noListBefore: true,
		expect: { ran: "/rename quarterly review", list: null },
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
		/* The popup's own ENTER line, verbatim: the gesture strip's first
		   paragraph, which is what the copy findings are about. Read here rather
		   than from the frame because a reviewer checking "does the line describe
		   the key" wants the string, and the frame is where they check the
		   weight and placement. */
		enterNote: box && box.lastElementChild
			? text(box.lastElementChild.querySelector("p"))
			: null,
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
async function typeWord(
	word,
	trailing = "",
	caretLefts = 0,
	expectList = true,
) {
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
	/*
	 * Wait for the listbox to reach the state this case EXPECTS, rather than
	 * waiting for one to appear and returning.
	 *
	 * Two states are in play and they are both legitimate, so a rig that waited
	 * only for "a list appeared" could read the previous case's box and could not
	 * express the new one. A flag list (`/rename`) opens on a TYPED flag and stays
	 * shut on an empty query, so `expectList === false` cases wait for the box to be
	 * ABSENT — and the `true` cases still wait for it to appear, so a slow first
	 * render is never read as "no list". Polling both ways is also what closes the
	 * settle race a plain `return` left: the `/rename ` + Enter case read a stale
	 * box in the frame before the effect closed it.
	 */
	const started = Date.now();
	for (;;) {
		const open = await evaluate(
			`Boolean(document.querySelector('[role="listbox"]'))`,
		);
		if (expectList ? open : !open) return;
		if (Date.now() - started > 10_000) {
			/*
			 * NOT fatal, deliberately, and this is what makes the BEFORE half work on a
			 * tree WITHOUT the fix: on `origin/main` there is no `/rename` argument list,
			 * so a suggestion case waits for a box that never opens. A driver that threw
			 * here could not produce a BEFORE record at all — the run would die on the
			 * first case rather than document it — while returning lets the frame be taken
			 * and the case record its own `list: null` mismatch, which is exactly the
			 * evidence the pair exists to show. On this branch the wait is satisfied on the
			 * render after the keystroke, so the tolerance costs nothing where it works.
			 */
			console.log(
				`  (the list never ${expectList ? "opened" : "closed"} for "/${word}" — recording the state as it stands)`,
			);
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
		const row = [...box.querySelectorAll('[role="option"]')].find((node) =>
			node.textContent.includes(${JSON.stringify(label)}),
		);
		if (!row) return null;
		const r = row.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	/*
	 * NOT fatal: on a tree without the row the case's whole point is that there is
	 * nothing to click, and throwing here would abort the run instead of recording
	 * it. The caller records the unchanged draft as its own mismatch.
	 */
	if (!point) {
		console.log(
			`  (no row matching "${label}" in the list — nothing to click)`,
		);
		return false;
	}
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
		const gesture = testCase.typeOnly
			? `type "/${testCase.word}" and read the list`
			: testCase.click
				? `click on the "${testCase.click}" row after typing "/${testCase.word}"`
				: `${testCase.key} after typing "/${testCase.word}"`;
		await reset();
		await send("Page.addScriptToEvaluateOnNewDocument", {
			source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(THEME)} }, version: 0 })); } catch {}`,
		});
		/*
		 * The wait applies to the BEFORE state, which for a type-only case IS the
		 * state under test and for a gesture case is the list the gesture acts on.
		 * So only a type-only case can ask for "no list": the `/clear` case's
		 * `list: null` describes its AFTER state (the completion closed the box),
		 * while the box is legitimately up as the gesture is taken.
		 */
		await typeWord(
			testCase.word,
			testCase.trailing,
			testCase.caretLefts,
			/*
			 * Whether the list should be UP in the BEFORE state. Almost always yes — the
			 * gesture is taken against a list. The exception is `noListBefore`: the flag
			 * list's EMPTY state, which is shut for a type-only case reading it as its
			 * answer and for the bare-Enter case whose whole point is that `/rename `
			 * opens nothing to complete. Named per case rather than inferred from the
			 * expectation, because an AFTER of `null` is a different fact (a gesture
			 * that CLOSED the list, e.g. `/clear`) and would make the wait wrong.
			 */
			!testCase.noListBefore,
		);
		const before = await evaluate(READ_STATE);
		const beforeFrame = await shoot(`${testCase.name}-before`);
		/*
		 * A TYPE-ONLY case presses no key and clicks nothing: the whole question is
		 * what the list OFFERS as the user types, so the state read right after the
		 * typing IS the answer, and the "before" frame is the only frame. The field
		 * assertions are then read off `before` rather than `after` — same fields,
		 * same expectations, one gesture fewer — so a case cannot claim a suggestion
		 * it only produced after some other key moved the word.
		 */
		if (!testCase.typeOnly) {
			if (testCase.click) {
				await clickRow(testCase.click);
			} else {
				await press(...KEYS[testCase.key]);
			}
			await sleep(400);
		}
		const after = testCase.typeOnly ? before : await evaluate(READ_STATE);
		const afterFrame = testCase.typeOnly
			? beforeFrame
			: await shoot(`${testCase.name}-after`);

		const mismatches = [];
		for (const [field, expected] of Object.entries(testCase.expect)) {
			const actual = after[field];
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
	writeFileSync(
		join(OUT, "result.json"),
		`${JSON.stringify(record, null, 2)}\n`,
	);
	chrome.kill("SIGTERM");
}

console.log(
	`\n${CASES.length - failures}/${CASES.length} gestures behaved as the rule requires; record: ${join(OUT, "result.json")}`,
);
process.exit(failures === 0 ? 0 : 1);
