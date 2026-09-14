#!/usr/bin/env node
/**
 * HISTORICAL / UNVALIDATED capture driver — not a supported validation recipe.
 *
 * PR #154 QA found that the model-row path below calls HTMLElement.click(),
 * whereas PickerRow selects on onMouseDown. Its unchanged-reading result proves
 * no backend refusal: it never submitted the row selection. Do not fix or run
 * this driver to obtain this recovery's evidence. All new page interactions and
 * screenshots require the approved browser tool; missing approval is BLOCKED.
 * The prose below describes the original intent, not completed evidence.
 *
 * Why this set cannot be a story. The claim is not about the strip's markup; it
 * is that a pick made on a pane with NO session behind it is resolved by the
 * BACKEND (`sessions.preview` with the chosen `model`) and then born on by the
 * first turn (`sessions.create`). A Storybook frame would photograph a stubbed
 * transport and prove neither half. So this drives the shipped renderer through
 * the dev desktop proxy — the same-origin `/__desktop` branch `desktop-api.ts`
 * already ships for browser development — against a real, isolated backend.
 *
 * `actionable` runs against a backend advertising `features.draft_selection: 1`;
 * `inert` runs the same steps against one that does not, and asserts the chips
 * stay inert and no picker opens. Neither the successful pick/send sequence nor
 * that negative-control pair was completed; the retained PNGs stop at the open
 * model picker. See docs/evidence/draft-pick-live/README.md for the exact limits.
 *
 * A completed run intended to write `numbers.json`; no such file is committed
 * with the historical PNGs. The intended number source is the live DOM when the
 * frame beside it was taken: the readings' own `aria-label`s (which carry the
 * window, the ladder and the level the backend resolved), their geometry across
 * the send, and the picker's own rows. The model and level that served the
 * first turn are read from the BACKEND's own session record afterwards, never
 * from the UI, and written into the same file.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://127.0.0.1:5204";
const OUT = process.argv[3] ?? "docs/evidence/draft-pick-live";
const MODE = process.argv[4] ?? "actionable";
const ISOLATED = process.env.DRAFT_PICK_ISOLATED_DIR;

if (!ISOLATED) {
	console.error(
		"node scripts/draft-pick-evidence.mjs <origin> <out> [actionable|inert] — DRAFT_PICK_ISOLATED_DIR must name the isolated backend root the proxy points at, because the first turn's model is read from that backend and not from the screen",
	);
	process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const dataDir = join(tmpdir(), `draft-pick-evidence-${process.pid}`);
mkdirSync(dataDir, { recursive: true });

/* ---- chrome, raw CDP, nothing installed -------------------------------- */

const chrome = spawn(
	CHROME,
	[
		/* `detached` puts the browser in its own process group, so the sweep below
		   can kill the whole tree rather than the parent and its orphans. */

	"--headless=new",
	"--no-sandbox",
	"--disable-gpu",
	"--hide-scrollbars",
	"--window-size=1440,1000",
	`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	],
	{ detached: true },
);

/*
 * Every exit path frees the profile and the browser.
 *
 * The first version killed Chrome only on the success path, and 36 of its
 * helpers were still running when the next person looked — an evidence rig that
 * leaks a browser per failed run is a defect in the rig, not in the run. `exit`
 * covers the throws (the driver's own `waitFor` failures and the refusals that
 * are deliberately errors), `uncaughtException`/`unhandledRejection` cover the
 * async ones, and this remains `mktemp`-scoped, so it can never touch another
 * session's Chrome.
 */
const cleanup = () => {
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {}
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {}
};
process.on("exit", cleanup);
process.on("uncaughtException", (error) => {
	console.error(error);
	cleanup();
	process.exit(1);
});
process.on("unhandledRejection", (error) => {
	console.error(error);
	cleanup();
	process.exit(1);
});

/** Chrome prints the DevTools websocket on stderr; there is no other handle. */
const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const timer = setTimeout(() => reject(new Error("Chrome did not report a debug port")), 30_000);
	chrome.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
		if (m) {
			clearTimeout(timer);
			resolve(m[1]);
		}
	});
	chrome.on("exit", (code) => reject(new Error(`Chrome exited early (${code})`)));
});

const { host } = new URL(wsUrl);
const targets = await (await fetch(`http://${host}/json`)).json();
const page = targets.find((t) => t.type === "page");
const sock = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => sock.addEventListener("open", r, { once: true }));

let seq = 0;
const pending = new Map();
sock.addEventListener("message", (e) => {
	const msg = JSON.parse(e.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
	}
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
		sock.send(JSON.stringify({ id, method, params }));
	});

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const ev = async (expression) => {
	const { result } = await send("Runtime.evaluate", {
		awaitPromise: true,
		returnByValue: true,
		expression,
	});
	if (result.subtype === "error") throw new Error(result.description ?? "evaluate failed");
	return result.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a predicate to hold, and FAIL if it never does.
 *
 * A driver that screenshots on a timer photographs whatever the page happened
 * to be doing; every wait here is for the state the frame claims, so a frame
 * that comes out wrong is an error rather than a quieter artifact.
 */
const waitFor = async (expression, label, timeout = 30_000) => {
	const deadline = Date.now() + timeout;
	for (;;) {
		if (await ev(expression)) return;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await sleep(250);
	}
};

/** The readings a frame is about, read off the DOM rather than from a capture of my own. */
const READINGS = `(() => {
	const strip = document.querySelector("[data-lo-session-strip]");
	if (!strip) return null;
	const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
	return {
		draft: strip.hasAttribute("data-lo-session-strip-draft"),
		strip: box(strip),
		readings: [...strip.querySelectorAll("button, span[tabindex]")].map((el) => ({
			label: el.getAttribute("aria-label") || el.textContent.trim(),
			disabled: el.getAttribute("aria-disabled") === "true",
			tag: el.tagName.toLowerCase(),
			box: box(el),
		})),
	};
})()`;

const numbers = {};
const shot = async (name, note) => {
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	numbers[name] = { note, ...(await ev(READINGS)) };
	console.log(`shot ${name}: ${note}`);
};

const click = async (selector) =>
	ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);

/* ---- the run ------------------------------------------------------------ */

await send("Page.navigate", { url: `${ORIGIN}/draft-pick-evidence.html` });
await waitFor(
	`[...document.querySelectorAll("button,a")].some((x) => /^New chat( with .+)?$/.test(x.getAttribute("aria-label") || x.textContent.trim()))`,
	"a New chat control in the shell",
);
const harnessError = await ev(
	`(() => window.__HARNESS_ERROR__ || (document.body.innerText.trim().length ? "" : "no text rendered"))()`,
);
if (harnessError) throw new Error(`the harness page did not render: ${harnessError}`);

/*
 * Into a NEW conversation, through the shell's own control.
 *
 * The landing state has no composer at all — the app's shell offers `New chat`,
 * and the pane it opens is the one the operator's report is about. Clicking it
 * rather than routing to a URL keeps this the app's own path there.
 */
/*
 * Either the plain control or an agent's — the sidebar offers whichever the
 * shell decides, and both reach a draft. Which one is used is recorded, because
 * only the plain one reaches the state with NO resolved model.
 */
const opened = await ev(
	`(() => { const all = [...document.querySelectorAll("button,a")]; const label = (x) => x.getAttribute("aria-label") || x.textContent.trim(); const el = all.find((x) => label(x) === "New chat") ?? all.find((x) => /^New chat with .+$/.test(label(x))); if (!el) return null; el.click(); return label(el); })()`,
);
if (!opened) throw new Error("no New chat control in the shell");
const plainNewChat = opened === "New chat";
await waitFor(`!!document.querySelector("textarea")`, "the composer to mount");

/*
 * Two draft states, and both are the app's own.
 *
 * `New chat` with nothing chosen yet is the pane the operator's report is
 * about, and it is the state design round 1 asked for as D3: the resolution
 * names no model, so the reading offered is the pick itself. Photographed
 * first, because choosing an agent navigates away from it.
 */
await waitFor(
	`(() => { const s = document.querySelector("[data-lo-session-strip]"); return !!s && s.hasAttribute("data-lo-session-strip-draft") && !!s.querySelector("button[aria-label^='Model:']"); })()`,
	"the new conversation's readings",
);
if (MODE === "actionable" && plainNewChat) {
	await shot(
		"draft-no-model",
		"a NEW conversation with nothing chosen yet: no model is resolved, and the reading offered is the pick (design D3)",
	);
}

/*
 * The draft with an IDENTITY, which is what a resolved draft looks like: the
 * app's own `New chat with <agent>` route, so the backend's `sessions.preview`
 * has an agent to resolve for. The wait is for a model that is not the
 * unresolved placeholder — a frame taken earlier would be a picture of the
 * state above rather than of the capability.
 */
const choseAgent = await ev(
	`(() => { const el = [...document.querySelectorAll("button,a")].find((x) => /^New chat with /.test(x.getAttribute("aria-label") || "")); if (!el) return false; el.click(); return true; })()`,
);
if (!choseAgent) throw new Error("the shell offered no New chat with <agent> control to reach a resolved draft");
await waitFor(
	`(() => { const b = document.querySelector("button[aria-label^='Model:']"); return !!b && !/none resolved yet/.test(b.getAttribute("aria-label") || ""); })()`,
	"the draft's model to be resolved by the backend",
	45_000,
);


if (MODE === "inert") {
	await ev(`(() => { const el = [...document.querySelectorAll("button,a")].find((x) => /^New chat with /.test(x.getAttribute("aria-label") || "")); if (el) el.click(); return !!el; })()`);
	await sleep(2500);
	await shot("inert-at-rest", "the same pane on a backend without `draft_selection`: the readings are inert");
	const opened = await click(`button[aria-label^='Model:']`);
	await sleep(1500);
	const dialog = await ev(`!!document.querySelector("[role='dialog']")`);
	if (dialog) throw new Error("a picker opened on a backend that cannot honour a pick — the gate is not gating");
	numbers.inert = { clicked: opened, dialogOpened: dialog };
	await shot("inert-no-picker", "the same click, and no picker: this is the negative control");
	await report();
	process.exit(0);
}

await shot("draft-at-rest", "a NEW conversation pane, capability present: the model and effort readings are controls");

/* 1. the model picker, opened from the reading itself. */
await click(`button[aria-label^='Model:']`);
await waitFor(`!!document.querySelector("[role='dialog']")`, "the model picker");
await sleep(600);
await shot("picker-open", "the model picker open on a draft pane, at the same dialog a session's reading opens");

/* 2. a model the BACKEND will resolve, found by trying the rows in order. */
const label = `document.querySelector("button[aria-label^='Model:']").getAttribute("aria-label")`;
const before = await ev(label);
let pickRecord = null;
for (let attempt = 0; attempt < 6 && !pickRecord; attempt++) {
	if (!(await ev(`!!document.querySelector("[role='dialog']")`))) {
		await click(`button[aria-label^='Model:']`);
		await waitFor(`!!document.querySelector("[role='dialog']")`, "the model picker");
		await sleep(500);
	}
	const chosen = await ev(`(() => {
		const rows = [...document.querySelectorAll("[role='option']")];
		const target = rows[${attempt}];
		if (!target) return null;
		const text = target.textContent.trim().split("\\n")[0];
		target.click();
		return text;
	})()`);
	if (!chosen) break;
	const deadline = Date.now() + 12_000;
	for (;;) {
		const now = await ev(label);
		if (now !== before) {
			pickRecord = { chosen, before, after: now, rowIndex: attempt };
			break;
		}
		if (Date.now() > deadline) break;
		await sleep(400);
	}
	if (!pickRecord) numbers[`pickRefused-${attempt}`] = { chosen, reading: await ev(label) };
}
if (!pickRecord) {
	throw new Error(
		"no catalogue row this isolated backend would resolve: every row's pick left the draft's reading unchanged, so the pane would have photographed the DEFAULT model under a picked name — recorded in numbers.json instead",
	);
}
await sleep(600);
await shot("model-picked", `chosen: ${pickRecord.chosen} — the window, the price pair and the ladder on screen are the backend\'s answer for it`);
numbers.modelPick = pickRecord;

/* 3. the effort ladder the CHOSEN model carries, and a rung of it. */
/*
 * The effort reading, WHEN THIS BACKEND RESOLVES A LADDER.
 *
 * Recorded rather than thrown when it is absent, because absent is a real
 * answer here and the reason is a backend fact, not a rendering choice: a draft's
 * spec comes from `sessions.preview`, which skips the account-metadata step a
 * cold session's does, so the resolution can carry `reasoning_efforts: []` even
 * for a model whose ladder the session will have. The strip then hides the chip
 * (`!draft || effort.levelKnown`) and offers no picker, which is design R19/R21:
 * an absent level beats a fabricated one. This driver records what it saw; it
 * does not invent a rung, and it does not substitute the model chip for this cell.
 */
const effortOpen = await click(`button[aria-label^='Reasoning effort:']`);
if (!effortOpen) {
	numbers.effortReading = {
		state: "absent",
		observed: await ev(`(() => {
			const s = document.querySelector("[data-lo-session-strip]");
			return {
				readings: [...s.querySelectorAll("button, span[tabindex]")].map((el) => el.getAttribute("aria-label")),
				model: s.querySelector("button[aria-label^='Model:']")?.getAttribute("aria-label"),
			};
		})()`),
		why: "the backend's `sessions.preview` spec carried an empty ladder (reasoning_efforts: []), so no rung is offered on a draft; observed payload recorded in this file rather than worked around in the renderer",
	};
	console.log("effort reading absent on this backend build — recorded, not worked around");
} else {
await waitFor(`!!document.querySelector("[role='dialog']")`, "the effort picker");
await sleep(600);
await shot("effort-picker-open", "the effort ladder of the CHOSEN model, read off the backend's resolution rather than the picker's own row");
const rung = await ev(`(() => { const r = [...document.querySelectorAll("[role='option']")].find((x) => x.getAttribute("aria-selected") !== "true"); return r ? (r.getAttribute("data-value") || r.textContent.trim().split("\\n")[0]) : null; })()`);
if (!rung) throw new Error("no second rung to pick");
await ev(`(() => { const r = [...document.querySelectorAll("[role='option']")].find((x) => x.getAttribute("aria-selected") !== "true"); r.click(); return true; })()`);
await waitFor(
	`/Reasoning effort: ${rung}/.test(document.querySelector("button[aria-label^='Reasoning effort:']")?.getAttribute("aria-label") || "")`,
	"the rung to be recorded",
	45_000,
);
await sleep(600);
await shot("effort-picked", `chosen rung: ${rung} of the chosen model's ladder`);
numbers.effortPick = { rung, label: await ev(`document.querySelector("button[aria-label^='Reasoning effort:']").getAttribute("aria-label")`) };

}

/* Close the dialog the way a keyboard user does, so the send is a plain send. */
await ev(`(() => { document.querySelector("[role='dialog']")?.querySelector("button[aria-label*='Close' i], button[aria-label*='close' i]")?.click(); return true; })()`);
await sleep(800);

/* 4. the send, on the shipped submit path. */
numbers.beforeSend = await ev(READINGS);
await ev(`(() => { const t = document.querySelector("textarea"); t.focus(); return true; })()`);
await send("Input.insertText", { text: "Which model and reasoning level is answering this?" });
const sendButton = await ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /send message/i.test(x.getAttribute("aria-label") || "")); if (!b) return false; b.click(); return true; })()`);
if (!sendButton) throw new Error("could not find the composer's own Send message control");
await waitFor(
	`(() => { const s = document.querySelector("[data-lo-session-strip]"); return !!s && !s.hasAttribute("data-lo-session-strip-draft"); })()`,
	"the first receipt, where the draft's strip becomes a session's",
	60_000,
);
await sleep(1200);
await shot("after-send", "the same pane after send: the draft's strip has become a session's, and the readings did not move");

/* 5. the first turn, in the transcript, and the session's own record. */
await waitFor(`document.body.innerText.includes("Which model and reasoning level")`, "the first turn in the transcript", 60_000);
await sleep(2500);
await shot("first-turn", "the first turn, in the transcript of the session the send created");

numbers.firstTurn = await ev(`(() => {
	const rows = [...document.querySelectorAll("[data-lo-session-strip]")];
	const strip = rows[0];
	return strip ? { model: strip.querySelector("button[aria-label^='Model:']")?.getAttribute("aria-label"), effort: strip.querySelector("button[aria-label^='Reasoning effort:']")?.getAttribute("aria-label") } : null;
})()`);

/*
 * The backend's OWN record of what served the turn.
 *
 * Read from the isolated root, not from the screen, because the whole point of
 * the claim is that the model on the pane is the model the backend used. The
 * renderer can only ever be a witness to what it was told.
 */
numbers.backendRecord = readSessionRecord(ISOLATED);

await report();
chrome.kill("SIGKILL");
rmSync(dataDir, { recursive: true, force: true });

async function report() {
	const after = MODE === "inert" ? null : await ev(READINGS);
	if (after) {
		numbers.afterSend = after;
		const moved = numbers.beforeSend && JSON.stringify(numbers.beforeSend.strip) !== JSON.stringify(after.strip);
		numbers.shift = {
			stripBefore: numbers.beforeSend?.strip,
			stripAfter: after.strip,
			moved,
		};
	}
	writeFileSync(join(OUT, "numbers.json"), `${JSON.stringify(numbers, null, 2)}\n`);
	console.log(`wrote ${OUT}/numbers.json`);
}

/**
 * The isolated backend's own session record: its journal names the model and
 * level the turn ran on, which is the only non-UI evidence of that.
 */
function readSessionRecord(root) {
	try {
		const dir = join(root, ".local-operator", "sessions");
		const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
		const newest = files
			.map((f) => ({ f, m: readFileSync(join(dir, f), "utf8") }))
			.sort((a, b) => b.m.length - a.m.length)[0];
		if (!newest) return { note: `no session records under ${dir}` };
		const parsed = JSON.parse(newest.m);
		return {
			file: newest.f,
			model: parsed.model ?? parsed.config?.model ?? null,
			reasoning_effort:
				parsed.reasoning_effort ?? parsed.config?.reasoning_effort ?? parsed.config?.model?.reasoning_effort ?? null,
			keys: Object.keys(parsed).slice(0, 24),
		};
	} catch (error) {
		return { note: `could not read the backend's own record: ${String(error)}` };
	}
}
