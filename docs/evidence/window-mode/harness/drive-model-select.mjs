#!/usr/bin/env node
/**
 * Settings model-select driver — an ADDITIVE extension of the window-mode
 * harness (`docs/evidence/window-mode/harness/`), written for the evidence set
 * of the canonical-ID fix (`fix/openai-sol-settings`, "recognize and search
 * canonical provider model IDs").
 *
 *     node drive-model-select.mjs <cdp-port> <out-dir> [hash-route]
 *
 * Run through `run.sh` with `DRIVE_SCRIPT` / `EXTRA_SEED` pointed at this pair,
 * so the app, its backend and its isolated store are the harness's own:
 *
 *     EXTRA_SEED=docs/evidence/window-mode/harness/seed-model-select.mjs \
 *     DRIVE_SCRIPT=docs/evidence/window-mode/harness/drive-model-select.mjs \
 *       bash docs/evidence/window-mode/harness/run.sh <tree> <label> headless 1380x900
 *
 * WHAT IT PHOTOGRAPHS, in one run, on BOTH trees (the seed and this driver are
 * the same for the `before` and `after` halves; only the app build differs):
 *
 *   01-stored-value           the Settings "Model settings" row at rest, showing
 *                             the stored `openai/gpt-6.1-sol` — raw on the base
 *                             tree, resolved to the catalogue row after the fix.
 *   02-select-open-populated  the same row with its list open at rest (the whole
 *                             catalogue, and which row is marked as selected).
 *   (00-loading-catalogue)    the list while the catalogue is IN FLIGHT, captured
 *                             only when the app itself reports `busy` both
 *                             before and after the shutter — otherwise not
 *                             shipped and recorded as not reached.
 *   03-search-canonical-id    the raw canonical ID (`gpt-6.1-sol`) typed into
 *                             the field: which rows the filter admits.
 *   04-search-no-match        a query matching nothing: the list names the
 *                             outcome ("No matches") and stays open.
 *   05-custom-typed-row       a genuinely unknown value typed: the typed-value
 *                             row is offered (allowCustom preserved).
 *   06-custom-committed       after the deliberate click commits it: the field
 *                             holds the value it was given, and the scratch
 *                             config file shows the write.
 *   07-custom-selected-row    the list reopened: the value renders as the
 *                             Custom row, marked selected.
 *
 * Every wait is a predicate poll (bounded, no fixed sleep that could photograph
 * a state that has not arrived), every interaction is a real CDP input event
 * (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`),
 * and every frame is committed beside a metrics JSON read from the renderer and
 * from the scratch config file (`metrics.json`).
 *
 * The no-save control is measured where it is readable without inventing a
 * channel: the scratch `config/config.yml` is read THREE times — at rest before
 * any interaction, after the display/search states, and after the deliberate
 * commit — so "normalising display or filtering never saves" is a comparison of
 * the stored value across the run, and the commit that DOES save is visibly a
 * different event.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2];
const OUT = process.argv[3];
if (!PORT || !OUT) {
	console.error(
		"usage: drive-model-select.mjs <cdp-port> <out-dir> [hash-route]",
	);
	process.exit(1);
}
const SCRATCH = OUT;
const FRAMES = join(OUT, "frames");
mkdirSync(FRAMES, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`MODEL-SELECT ${message}`);

/* --------------------------------------------------------------- connect */

let page = null;
for (let i = 0; i < 60; i += 1) {
	try {
		const list = await (
			await fetch(`http://127.0.0.1:${PORT}/json/list`)
		).json();
		page = list.find((t) => t.type === "page" && t.url.includes("#/"));
		if (page) break;
	} catch {}
	await wait(1000);
}
if (!page) throw new Error("no app window on the CDP port");

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error
			? reject(new Error(JSON.stringify(msg.error)))
			: resolve(msg.result);
	}
};
await new Promise((resolve) => {
	ws.onopen = resolve;
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});

const evaluate = async (expression) => {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(`eval failed: ${JSON.stringify(res.exceptionDetails)}`);
	return res.result.value;
};

const shot = async (name) => {
	const res = await send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: false,
	});
	writeFileSync(join(FRAMES, name), Buffer.from(res.data, "base64"));
	return res.data.length;
};

/**
 * Poll a page predicate until it answers truthy, or fail the run naming what
 * was waited for. The only sleeps in this driver are the short settle after a
 * predicate has answered (so the shutter sees the painted state, not the tick
 * the predicate read) and this interval.
 */
const waitFor = async (
	label,
	expression,
	{ timeoutMs = 45000, intervalMs = 200 } = {},
) => {
	const started = Date.now();
	let lastError = null;
	for (;;) {
		try {
			const value = await evaluate(expression);
			if (value) return value;
		} catch (error) {
			// A reload tears the old document's context down under a poll; that is
			// transient and the next poll lands in the new context. A persistent
			// fault still times out, and its last error is surfaced below.
			lastError = error;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				`waited ${timeoutMs}ms for ${label}; it never held${lastError ? ` (last error: ${lastError.message})` : ""}`,
			);
		}
		await wait(intervalMs);
	}
};

/* ----------------------------------------------------------------- input */

const mouse = (type, x, y, extra = {}) =>
	send("Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button: type === "mouseMoved" ? "none" : "left",
		clickCount: type === "mouseMoved" ? 0 : 1,
		...extra,
	});

const click = async (x, y) => {
	await mouse("mouseMoved", x, y);
	await wait(120);
	await mouse("mousePressed", x, y);
	await mouse("mouseReleased", x, y);
};

const key = async (code, keyName, extra = {}) => {
	for (const type of ["keyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			code,
			key: keyName,
			windowsVirtualKeyCode: extra.vk,
			nativeVirtualKeyCode: extra.vk,
			...extra,
		});
	}
};

const ESCAPE = { code: "Escape", key: "Escape", vk: 27 };

/* ----------------------------------------------------------- model input */

/**
 * The Settings model row's own input. Found through the section's own label
 * (`#model-settings` → `label[for]` whose text is `Model`) rather than by
 * position, because the section also holds the hosting provider's combobox and
 * the two must not be confused.
 */
const MODEL_INPUT = `(() => {
  const section = document.getElementById("model-settings");
  if (!section) return null;
  const label = [...section.querySelectorAll("label[for]")].find(
    (l) => (l.textContent || "").trim() === "Model",
  );
  if (!label) return null;
  const input = document.getElementById(label.getAttribute("for"));
  if (!input) return null;
  const r = input.getBoundingClientRect();
  return {
    id: input.id,
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    value: input.value,
    disabled: input.disabled,
  };
})()`;

const scrollSectionIntoView = async () => {
	const moved = await evaluate(`(() => {
    const section = document.getElementById("model-settings");
    if (!section) return false;
    section.scrollIntoView({ block: "center" });
    return true;
  })()`);
	if (!moved) return null;
	await wait(350);
	return evaluate(MODEL_INPUT);
};

/**
 * Focus the model input with a real pointer click, after clicking the section
 * heading first: the control selects its own text on FOCUS, so a query can only
 * replace the previous text when focus is re-entered (a click on an
 * already-focused input does not re-fire `focus`). Body-level blur via the
 * heading keeps that a real user gesture rather than a `select()` poked from
 * the driver.
 */
const focusModelInput = async () => {
	const heading = await evaluate(`(() => {
    const h = document.querySelector("#model-settings h2");
    if (!h) return null;
    h.scrollIntoView({ block: "center" });
    const r = h.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
	if (!heading) return null;
	await wait(250);
	await click(heading.x, heading.y);
	await wait(250);
	const point = await scrollSectionIntoView();
	if (!point || point.disabled) return null;
	await click(point.x, point.y);
	await wait(250);
	const focused = await evaluate(
		`document.activeElement === document.getElementById(${JSON.stringify(point.id)})`,
	);
	if (!focused) return null;
	return point;
};

/** Type `text` into the model input, replacing whatever it holds. */
const typeQuery = async (text) => {
	const point = await focusModelInput();
	if (!point) throw new Error("could not focus the model input for typing");
	await send("Input.insertText", { text });
	await wait(250);
	const value = await evaluate(
		`document.getElementById(${JSON.stringify(point.id)}).value`,
	);
	if (value !== text)
		throw new Error(`typed text did not take: ${JSON.stringify(value)}`);
	return point;
};

/* --------------------------------------------------------------- measure */

const MEASURE = `(() => {
  const section = document.getElementById("model-settings");
  const label = section
    ? [...section.querySelectorAll("label[for]")].find(
        (l) => (l.textContent || "").trim() === "Model",
      )
    : null;
  const input = label ? document.getElementById(label.getAttribute("for")) : null;
  const list = document.querySelector('[role="listbox"]');
  const options = [...document.querySelectorAll('[role="option"]')];
  const rows = options.map((o) => ({
    text: (o.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
    typed: o.dataset.comboboxRow === "typed",
    selected: o.getAttribute("aria-selected"),
  }));
  return JSON.stringify({
    hash: location.hash,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    inputValue: input ? input.value : null,
    inputDisabled: input ? input.disabled : null,
    expanded: input ? input.getAttribute("aria-expanded") : null,
    busyField: input && input.parentElement
      ? Boolean(input.parentElement.querySelector('[role="status"]'))
      : null,
    listboxText: list
      ? (list.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 400)
      : null,
    noMatches: list ? /No matches/.test(list.innerText || "") : null,
    optionCount: options.length,
    rows,
    catalogueRowVisible: rows.some(
      (r) => !r.typed && r.text.includes("GPT 6.1 Sol"),
    ),
    typedRowVisible: rows.some((r) => r.typed),
    customDescriptionVisible: rows.some((r) => r.text.includes("Custom model")),
    selectedRowText: (rows.find((r) => r.selected === "true") || {}).text ?? null,
    sectionHead: section
      ? (section.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 200)
      : null,
  });
})()`;

const readState = async () => JSON.parse(await evaluate(MEASURE));

const metrics = [];

/** Photograph + measure, and keep both under one label. */
const capture = async (label, file) => {
	const bytes = await shot(file);
	const state = await readState();
	metrics.push({ label, frame: file, bytes, ...state });
	log(
		`${label}: value=${JSON.stringify(state.inputValue)} open=${state.expanded} rows=${state.optionCount} known=${state.catalogueRowVisible} typed=${state.typedRowVisible} noMatches=${state.noMatches} busy=${state.busyField}`,
	);
	return state;
};

/* ---------------------------------------------------------------- config */

/**
 * The scratch config file's `model_name`, read from disk: that file is the
 * store of record the settings PATCH writes, so it is where "nothing saved
 * during display/search" can be read without inventing a channel.
 */
/**
 * The `model_name` line of the scratch config the run is writing into.
 *
 * Indentation-tolerant on purpose: every setting lives under `values:`
 * (`config.py`: "EVERY setting is read from `values`"), so the line the
 * backend writes is `  model_name: …`, and a `^model_name` anchor read it as
 * absent through one whole run. All matches are collected and the LAST is
 * taken, so a legacy top-level key (which does nothing) can never shadow the
 * live value.
 */
const CONFIG_MODEL_NAME = /^[ \t]*model_name:[ \t]*['"]?(.+?)['"]?[ \t]*$/gm;

/**
 * The stored model name, read from the scratch config file — the store of
 * record the settings page writes through, and the read that makes the
 * no-save control a measurement rather than an impression.
 */
const readConfigModelName = () => {
	try {
		const text = readFileSync(join(SCRATCH, "config", "config.yml"), "utf8");
		const matches = [...text.matchAll(CONFIG_MODEL_NAME)];
		return matches.length ? matches[matches.length - 1][1] : null;
	} catch {
		return null;
	}
};

const waitForConfig = async (expected, timeoutMs = 15000) => {
	const started = Date.now();
	for (;;) {
		if (readConfigModelName() === expected) return true;
		if (Date.now() - started > timeoutMs) return false;
		await wait(250);
	}
};

/* ------------------------------------------------------------------- run */

await send("Page.enable");
await send("Runtime.enable");

// Dismiss first-run onboarding AND drop the persisted models store, so this
// run's first catalogue read is fresh and its in-flight state is reachable.
// `partialize` persists the store; both writes mirror the mechanism
// `drive-model-picker.mjs` uses for the onboarding store.
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `try {
    localStorage.setItem("onboarding-storage", JSON.stringify({
      state: { isModalComplete: true, isTourComplete: true, currentStep: "connect_provider" },
      version: 0,
    }));
    localStorage.removeItem("local-operator-models");
  } catch {}`,
});
await send("Page.reload");
/**
 * Open the model row as fast as the app allows, so the FIRST-load catalogue
 * fetch (armed about a second after the settings page mounts) is not spent on
 * extra round trips. One evaluate per iteration sets the hash, waits for the
 * enabled row, scrolls it into view and reports its FRESH centre; the click
 * follows immediately, and the loop ends when the combobox says it is open.
 */
const openTheRow = async () => {
	const started = Date.now();
	let lastError = null;
	for (;;) {
		let probe = null;
		try {
			probe = await evaluate(`(() => {
      if (!location.hash.startsWith("#/settings")) {
        location.hash = "#/settings";
        return { stage: "hash" };
      }
      const found = ${MODEL_INPUT};
      if (!found || found.disabled || !found.value) return { stage: "config" };
      const input = document.getElementById(found.id);
      if (input.getAttribute("aria-expanded") === "true")
        return { stage: "open" };
      input.scrollIntoView({ block: "center" });
      const r = input.getBoundingClientRect();
      return { stage: "ready", x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
		} catch (error) {
			// A reload tears the old document's context down under a poll; the
			// next iteration lands in the new one.
			lastError = error;
		}
		if (probe && probe.stage === "open") return true;
		if (probe && probe.stage === "ready") await click(probe.x, probe.y);
		if (Date.now() - started > 90000) {
			throw new Error(
				`the Settings model row never became openable (last stage: ${probe ? probe.stage : "none"}${lastError ? `; last error: ${lastError.message}` : ""})`,
			);
		}
		await wait(120);
	}
};

/**
 * Watch the just-opened list: catch the in-flight catalogue if it is on
 * screen, and wait for the catalogue row to arrive. The in-flight frame ships
 * only when the app still reports the fetch in flight on BOTH sides of the
 * shutter; a frame whose window ended mid-capture is deleted rather than
 * shipped, because it would picture a state it does not describe. Returns
 * whether the in-flight frame shipped.
 */
const watchOpenList = async () => {
	let loadingCaptured = false;
	let busySamples = 0;
	const seenTexts = new Set();
	const started = Date.now();
	for (;;) {
		const state = await readState();
		if (state.busyField) busySamples += 1;
		if (state.listboxText) seenTexts.add(state.listboxText.slice(0, 60));
		if (state.busyField && !loadingCaptured) {
			const bytes = await shot("00-loading-catalogue.png");
			const after = await readState();
			if (after.busyField) {
				metrics.push({
					label: "00-loading-catalogue",
					frame: "00-loading-catalogue.png",
					bytes,
					...state,
					busyAfterShutter: after.busyField,
				});
				loadingCaptured = true;
				log("00-loading-catalogue: busy before and after the shutter");
			} else {
				unlinkSync(join(FRAMES, "00-loading-catalogue.png"));
				log(
					"00-loading-catalogue: in-flight window ended before the shutter; not shipped",
				);
			}
		}
		if (
			state.expanded === "true" &&
			state.rows.some((row) => !row.typed && row.text.includes("GPT 6.1 Sol"))
		)
			break;
		if (Date.now() - started > 60000) {
			throw new Error(
				`the catalogue row never reached the open list (list texts seen: ${JSON.stringify([...seenTexts])})`,
			);
		}
		await wait(120);
	}
	log(
		`open-list wait: busySamples=${busySamples} listTexts=${JSON.stringify([...seenTexts])}`,
	);
	return loadingCaptured;
};

const configReads = { baseline: readConfigModelName() };
log(`config.yml at rest: model_name=${JSON.stringify(configReads.baseline)}`);
if (!(await openTheRow())) throw new Error("the model row never opened");

/*
 * 02, THEN 01 — the order is load-bearing. The catalogue fetch arms about a
 * second after the settings page mounts, so the in-flight state lives and
 * dies inside the first click's poll loop; a capture between here and the
 * click spends that window on a screenshot and photographs a catalogue that
 * had already answered. The closed field 01 pictures is the same state before
 * and after one open/close cycle (the field reverts to the stored value on
 * Escape), so it is taken once the in-flight and populated frames are in hand.
 */
let loadingCaptured = await watchOpenList();
await wait(400);
await capture("02-select-open-populated", "02-select-open-populated.png");
await key(ESCAPE.code, ESCAPE.key, { vk: ESCAPE.vk });
await wait(350);

/* -- 01: the stored value at rest (closed field) ------------------------- */
await capture("01-stored-value", "01-stored-value.png");

/* -- 03: the raw canonical ID typed -------------------------------------- */
await typeQuery("gpt-6.1-sol");
await waitFor(
	"the typed query to reach the list",
	`(() => {
    const input = ${MODEL_INPUT};
    const list = document.querySelector('[role="listbox"]');
    return Boolean(input && input.value === "gpt-6.1-sol" && list);
  })()`,
);
await wait(350);
await capture("03-search-canonical-id", "03-search-canonical-id.png");

/* -- 04: a query matching nothing ---------------------------------------- */
await typeQuery("zzz-unlisted-query");
await waitFor(
	"the no-match message",
	`(() => {
    const list = document.querySelector('[role="listbox"]');
    return Boolean(list && /No matches/.test(list.innerText || ""));
  })()`,
);
await wait(350);
await capture("04-search-no-match", "04-search-no-match.png");

/* -- 05: a genuinely unknown value typed --------------------------------- */
await typeQuery("openai/synthetic-not-listed");
await waitFor(
	"the typed-value row",
	`[...document.querySelectorAll('[role="option"]')].some(
    (o) => o.dataset.comboboxRow === "typed" &&
      (o.textContent || "").includes("openai/synthetic-not-listed"),
  )`,
);
await wait(350);
await capture("05-custom-typed-row", "05-custom-typed-row.png");

configReads.afterSearch = readConfigModelName();
log(
	`config.yml after display/search states: model_name=${JSON.stringify(configReads.afterSearch)}`,
);

/* -- 06: the deliberate commit ------------------------------------------- */
{
	// The typed row is clicked only when its centre is actually inside the
	// listbox's own box, so an off-screen row cannot turn the "commit" into a
	// click on whatever scrolled under the pointer.
	const probe = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.dataset.comboboxRow === "typed",
    );
    const list = document.querySelector('[role="listbox"]');
    if (!row || !list) return null;
    row.scrollIntoView({ block: "center" });
    return true;
  })()`);
	if (!probe) throw new Error("no typed row to commit");
	await wait(300);
	const point = await evaluate(`(() => {
    const row = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.dataset.comboboxRow === "typed",
    );
    const list = document.querySelector('[role="listbox"]');
    if (!row || !list) return null;
    const r = row.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const inside = x > l.left && x < l.right && y > l.top && y < l.bottom;
    return { x, y, inside, text: (row.textContent || "").trim().slice(0, 120) };
  })()`);
	if (!point || !point.inside) {
		throw new Error(`typed row not clickable: ${JSON.stringify(point)}`);
	}
	await click(point.x, point.y);
	const saved = await waitForConfig("openai/synthetic-not-listed");
	if (!saved) {
		throw new Error("the committed value never reached config/config.yml");
	}
	await wait(400);
	await capture("06-custom-committed", "06-custom-committed.png");
	configReads.afterCommit = readConfigModelName();
	log(
		`commit: clicked ${JSON.stringify(point.text)}; config saved=${saved}; model_name=${JSON.stringify(configReads.afterCommit)}`,
	);
}

/* -- 07: the same value, rendered as the Custom row ----------------------- */
{
	const point = await scrollSectionIntoView();
	if (!point || point.disabled)
		throw new Error("model row vanished before reopen");
	await click(point.x, point.y);
	await waitFor(
		"the custom row marked selected",
		`[...document.querySelectorAll('[role="option"]')].some(
    (o) => o.getAttribute("aria-selected") === "true" &&
      (o.textContent || "").includes("Custom model"),
  )`,
	);
	await wait(350);
	await capture("07-custom-selected-row", "07-custom-selected-row.png");
	await key(ESCAPE.code, ESCAPE.key, { vk: ESCAPE.vk });
	await wait(250);
}

/*
 * One bounded retry for the in-flight state: the first attempt races the
 * first-load fetch, and on a loaded host it can be over before the click
 * lands. A reload clears the persisted models store again (the injected
 * script runs on every new document), re-arming the same real fetch; again
 * only a frame whose in-flight state held across the shutter is kept.
 */
if (loadingCaptured) {
	log("catalogue in-flight state reached on the first attempt");
} else {
	log("in-flight retry: clearing the models store and reloading once");
	await evaluate(
		`try { localStorage.removeItem("local-operator-models"); } catch {}`,
	);
	await send("Page.reload");
	await openTheRow();
	loadingCaptured = await watchOpenList();
	if (!loadingCaptured) {
		log("catalogue in-flight state not reached after both attempts");
	}
}

const summary = {
	configReads,
	configUnchangedAcrossDisplayAndSearch:
		configReads.baseline !== null &&
		configReads.baseline === configReads.afterSearch,
	catalogueInFlightCaptured: loadingCaptured,
	frames: metrics.map((m) => m.frame),
};
writeFileSync(
	join(OUT, "metrics.json"),
	`${JSON.stringify({ summary, states: metrics }, null, 2)}\n`,
);
console.log(`MODEL-SELECT SUMMARY ${JSON.stringify(summary)}`);
process.exit(0);
