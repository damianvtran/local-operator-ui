#!/usr/bin/env node
/**
 * Model-picker affordance driver — an ADDITIVE extension of the window-mode
 * harness (`docs/evidence/window-mode/harness/`), written for the audit of the
 * `/model` picker's feedback.
 *
 *     node drive-model-picker.mjs <cdp-port> <out-dir> [hash-route]
 *
 * Run through `run.sh` with `DRIVE_SCRIPT` pointed at this file, so the app, its
 * backend and its isolated store are the harness's own:
 *
 *     DRIVE_SCRIPT=docs/evidence/window-mode/harness/drive-model-picker.mjs \
 *       bash docs/evidence/window-mode/harness/run.sh . picker headless 1380x900
 *
 * It differs from `drive.mjs` in three ways, all of them about getting the
 * REAL picker on screen and keeping it there long enough to photograph:
 *
 *  1. The first-run onboarding modal is dismissed by seeding its persisted
 *     store (`onboarding-storage`) before the app's own scripts run. Without it
 *     the modal covers the composer and no command can be typed. Seeded through
 *     `Page.addScriptToEvaluateOnNewDocument` + a reload, the same mechanism
 *     `scripts/capture-evidence.mjs` uses for the UI preferences store.
 *  2. The picker is opened the way a user opens it: focus the composer textarea,
 *     type `/model`, press Enter. Every interaction after that is a real CDP
 *     input event — `Input.dispatchMouseEvent` for hover and click,
 *     `Input.dispatchKeyEvent` for the arrow keys and Enter — so the frames are
 *     the product reacting to input, not to a state we poked into it.
 *  3. Each state is photographed AND measured. The measurement is a
 *     `Runtime.evaluate` in the app's own renderer reading computed styles: a
 *     frame shows the symptom, the numbers show the cause.
 *
 * Frames are written to <out-dir>/picker-*.png and the measurements to
 * <out-dir>/picker-metrics.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2];
const OUT = process.argv[3];
const ROUTE = process.argv[4] ?? "#/chat/a1a1a1a1a1a1";
if (!PORT || !OUT) {
	console.error("usage: drive-model-picker.mjs <cdp-port> <out-dir> [hash-route]");
	process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/**
 * A per-run prefix for the frame names.
 *
 * The same driver runs twice for this branch's evidence: once on the branch's
 * own seed (the refusal path, and the pairs whose `before-*` halves were taken
 * under it) and once on a credentialed seed, which is the only run that reaches
 * a switch the owner ACCEPTS. Without a prefix the second run's frames overwrite
 * the first's under the same names, and a reviewer would be reading a frame from
 * one seed labelled as the other's. Run 2 passes `PICKER_FRAME_PREFIX=cred-`, so
 * every frame says which seed produced it.
 */
const PREFIX = process.env.PICKER_FRAME_PREFIX ?? "";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`PICKER ${message}`);

let page = null;
for (let i = 0; i < 60; i += 1) {
	try {
		const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
	}
};
await new Promise((r) => (ws.onopen = r));
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
	writeFileSync(join(OUT, `${PREFIX}${name}`), Buffer.from(res.data, "base64"));
	return res.data.length;
};

/* ---------------------------------------------------------------- input */

const mouse = (type, x, y, extra = {}) =>
	send("Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button: type === "mouseMoved" ? "none" : "left",
		clickCount: type === "mouseMoved" ? 0 : 1,
		...extra,
	});

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

const ARROWS = {
	ArrowDown: { vk: 40 },
	ArrowUp: { vk: 38 },
	Escape: { vk: 27 },
	Enter: { vk: 13 },
};

/** The centre of the element at `index` among `selector` matches, in device pixels. */
const centreOf = async (selector, index = 0) =>
	evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })()`);

/**
 * Pick a row FOR REAL, or say why not.
 *
 * A click outside a Radix dialog DISMISSES the dialog, so a row read off the
 * DOM without checking where it is can turn a "pick" step into a dismissal —
 * which is exactly what happened here: the list was scrolled, `centreOf`
 * returned the rect of an off-screen row, the click landed on the scrim, and
 * `closed-while-in-flight` was captured with no pick in flight at all (the
 * transcript note count stayed at 1 through both frames). Scroll the row into
 * view, re-measure, and refuse to click a point that is not inside the dialog.
 * Returns false when the row could not be brought into view, so a missing state
 * is reported rather than photographed as something else.
 */
const pickRowAt = async (index) => {
	const probe = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    const row = rows[${index}];
    const dlg = document.querySelector('[role="dialog"]');
    if (!row || !dlg) return null;
    row.scrollIntoView({ block: "center" });
    return true;
  })()`);
	if (!probe) return null;
	await wait(500);
	const point = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    const row = rows[${index}];
    const dlg = document.querySelector('[role="dialog"]');
    if (!row || !dlg) return null;
    const r = row.getBoundingClientRect();
    const d = dlg.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const inside = x > d.left && x < d.right && y > d.top && y < d.bottom;
    return { x, y, inside, label: row.textContent.trim().slice(0, 48) };
  })()`);
	if (!point) return null;
	if (!point.inside) {
		log(`row ${index} could not be brought inside the dialog; not clicking it`);
		return null;
	}
	await mouse("mouseMoved", point.x, point.y);
	await wait(300);
	await mouse("mousePressed", point.x, point.y);
	await mouse("mouseReleased", point.x, point.y);
	return point;
};

/* ------------------------------------------------------------- measure */

/**
 * One reading of the picker's feedback surface, straight out of the renderer.
 *
 * Every value here is a resolved computed style or geometry, because the claim
 * under audit is "the user cannot tell X happened" and that has to be stated in
 * pixels and ratios rather than in adjectives.
 */
const MEASURE = `(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const colour = (el, prop) => { const s = cs(el); return s ? s[prop] : null; };
  const dialog = document.querySelector('[role="dialog"]');
  const list = document.querySelector('[role="listbox"]');
  const options = [...document.querySelectorAll('[role="option"]')];
  const active = options.find((o) => o.getAttribute("aria-selected") === "true");
  const hovered = options.find((o) => o.hasAttribute("data-hovered"));
  const picked = options.find((o) => o.hasAttribute("data-picked"));
  // The footer's copy is state-dependent ("Arrows move · Enter picks X · Esc
  // closes" / "Switching the model…" / "Esc closes"), so it is matched by its
  // opening words rather than by a fixed list — the previous list is what this
  // matcher had to grow every time the copy changed.
  const footer = [...document.querySelectorAll("span")].find((s) =>
    /^(Arrows move|Esc closes|Applying the change|Switching the model)/.test((s.textContent || "").trim()));
  const checkbox = document.querySelector('[role="checkbox"]');
  const refresh = [...document.querySelectorAll("button")].find((b) =>
    /Refresh from providers|Live list/.test(b.textContent || ""));
  const strip = [...document.querySelectorAll("output")].map((o) => o.textContent.replace(/\\s+/g, " ").trim()).filter(Boolean).pop() || null;
  const stripEl = strip ? [...document.querySelectorAll("output")].filter((o) => o.textContent.trim()).pop() : null;
  const footerButton = [...document.querySelectorAll("button")].find((b) =>
    /^(Done|Close|Cancel)$/.test((b.textContent || "").trim()));
  const band = document.querySelector("[data-lo-session-strip]");
  const inList = (el) => {
    if (!el || !list) return null;
    const r = el.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
  };
  const outline = (el) => el ? { width: cs(el).outlineWidth, style: cs(el).outlineStyle, colour: cs(el).outlineColor, offset: cs(el).outlineOffset } : null;
  return JSON.stringify({
    dialogOpen: Boolean(dialog),
    /*
     * U7: the dialog's own header sentence, the one place that names the
     * session's model in WORDS. Read from the dialog's "aria-describedby"
     * node rather than by class, so "the header and the check agree" is read
     * off the same run as "currentIndex" — the still shows the sentence, this
     * says whether it is the same model the mark is on.
     */
    dialogDescription: (() => {
      const id = dialog ? dialog.getAttribute("aria-describedby") : null;
      const el = id ? document.getElementById(id) : null;
      return el ? el.textContent.replace(/\\s+/g, " ").trim().slice(0, 200) : null;
    })(),
    dialogBg: colour(dialog, "backgroundColor"),
    dialogRect: dialog ? (() => { const r = dialog.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() : null,
    rowCount: options.length,
    activeIndex: active ? options.indexOf(active) : null,
    activeBg: colour(active, "backgroundColor"),
    activeLabel: active ? active.textContent.trim().slice(0, 48) : null,
    activeIsCurrent: active ? active.hasAttribute("data-current") : null,
    /* U1: whether the row Enter would pick is even on screen. */
    activeInList: inList(active),
    currentIndex: options.findIndex((o) => o.hasAttribute("data-current")),
    checkColour: (() => { const o = options.find((x) => x.hasAttribute("data-current")); return o && o.querySelector("svg") ? colour(o.querySelector("svg"), "color") : null; })(),
    rowBgs: options.map((o) => colour(o, "backgroundColor")),
    /* D12: the structural half of the pointer's and the in-flight mark. */
    hoveredLabel: hovered ? hovered.textContent.trim().slice(0, 48) : null,
    hoveredBg: colour(hovered, "backgroundColor"),
    hoveredOutline: outline(hovered),
    activeOutline: outline(active),
    pickedLabel: picked ? picked.textContent.trim().slice(0, 48) : null,
    pickedOutline: outline(picked),
    listOverflow: list ? { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, gap: list.scrollHeight - list.clientHeight, scrollbar: list.offsetWidth - list.clientWidth } : null,
    footerText: footer ? footer.textContent.trim() : null,
    footerColour: colour(footer, "color"),
    checkbox: checkbox ? { state: checkbox.getAttribute("data-state"), border: colour(checkbox, "borderTopColor"), bg: colour(checkbox, "backgroundColor"), label: (checkbox.closest("div")?.textContent || "").trim().slice(0, 60) } : null,
    refresh: refresh ? { text: refresh.textContent.trim(), colour: colour(refresh, "color"), disabled: refresh.disabled } : null,
    strip: strip ? { text: strip.slice(0, 220), bg: colour(stripEl, "backgroundColor"), border: colour(stripEl, "borderTopColor"), ink: colour(stripEl, "color"), classes: stripEl ? stripEl.className : null } : null,
    footerButton: footerButton ? footerButton.textContent.trim() : null,
    /* U2/U3: the band after the dialog is gone, and what the transcript says. */
    bandText: band ? band.textContent.replace(/\\s+/g, " ").trim().slice(0, 120) : null,
    bandInk: band ? colour(band.querySelector("[class*=ink]") || band, "color") : null,
    bandSpinners: band ? band.querySelectorAll('[role="status"], [aria-hidden="true"].animate-spin').length : 0,
    transcriptNote: (() => {
      const t = document.body.innerText.replace(/\\s+/g, " ").trim();
      const m = t.match(/The model was (?:not )?changed\\.?[^.]*\\./);
      return m ? m[0].slice(0, 200) : null;
    })(),
    /*
     * COUNTED, not just read. U2's claim is that the note appears when the
     * answer lands even with the dialog gone, and the refusal text is the same
     * for every refused pick — so a note that was already in the transcript
     * (from an earlier pick in the same run) cannot be told from a new one by
     * its text. The count is what makes "a second note was written while the
     * dialog was closed" a measurement rather than an impression.
     */
    transcriptNoteCount: (document.body.innerText.match(/The model was (?:not )?changed/g) || []).length,
    searchValue: (document.querySelector('[role="combobox"]') || {}).value ?? null,
    bodyHead: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 200),
  });
})()`;

const readState = async () => JSON.parse(await evaluate(MEASURE));

const metrics = [];

/** Photograph + measure, and keep both under one label. */
const capture = async (label) => {
	const bytes = await shot(`picker-${label}.png`);
	const state = await readState();
	metrics.push({ label, frame: `${PREFIX}picker-${label}.png`, bytes, ...state });
	log(`${label}: rows=${state.rowCount} active=${state.activeIndex} dialog=${state.dialogOpen} footer=${JSON.stringify(state.footerText)} strip=${state.strip ? JSON.stringify(state.strip.text.slice(0, 60)) : "none"} button=${state.footerButton}`);
	return state;
};

/* ----------------------------------------------------------------- run */

await send("Page.enable");
await send("Runtime.enable");

// Dismiss first-run onboarding, then reload so the seeded store is what the app
// boots on. `partialize` persists exactly these three fields.
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `try {
    localStorage.setItem("onboarding-storage", JSON.stringify({
      state: { isModalComplete: true, isTourComplete: true, currentStep: "connect_provider" },
      version: 0,
    }));
  } catch {}`,
});
await send("Page.reload");
await wait(4000);

// The chat route carries the composer; the seeded transcript comes from seed.mjs.
await evaluate(`location.hash = ${JSON.stringify(ROUTE)}`);
await wait(3000);

await capture("00-chat-before");

/* Open the picker the way a user does: focus the composer, type /model, Enter. */
const composer = await evaluate(`(() => {
  const el = document.querySelector('textarea[data-tour-tag="chat-input-textarea"]') || document.querySelector("textarea");
  if (!el) return null;
  el.focus();
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (!composer) throw new Error("no composer textarea found");
await mouse("mousePressed", composer.x, composer.y);
await mouse("mouseReleased", composer.x, composer.y);
await send("Input.insertText", { text: "/model" });
await wait(600);
await capture("01-composer-slash-model");

/*
 * TWO Enters, and the reason is the product's own behaviour: typing `/model`
 * opens the composer's slash popup, and the first Enter COMPLETES the command
 * (`/model ` in the buffer) rather than submitting it — measured here, the
 * backend's `sessions.command` endpoint received no request at all after one
 * Enter, and the picker never mounted. The second Enter dispatches. Probed
 * rather than assumed: the loop below presses up to three times and stops as
 * soon as the picker's dialog exists, so a future change that makes one Enter
 * enough cannot break the capture.
 */
for (let attempt = 0; attempt < 3; attempt += 1) {
	await key("Enter", "Enter", ARROWS.Enter);
	let opened = false;
	for (let poll = 0; poll < 16; poll += 1) {
		await wait(500);
		opened = await evaluate(
			`Boolean(document.querySelector('[role="dialog"]'))`,
		);
		if (opened) break;
	}
	if (opened) {
		log(`picker opened after ${attempt + 1} Enter press(es)`);
		break;
	}
	log(`no dialog after Enter #${attempt + 1}; retrying`);
}
await wait(1500);
await capture("02-picker-open");

const rowCount = (await readState()).rowCount;
if (!rowCount) {
	log("WARNING: the catalogue returned no rows — the picker states below cannot be reached");
}

/* Hover a row that is NOT the in-force one. */
const hoverTarget = 4;
const hoverPoint = await centreOf('[role="option"]', hoverTarget);
if (hoverPoint) {
	// A first move to a neutral point, then onto the row, so the handler sees a
	// real movement rather than a pointer that appears already in place.
	await mouse("mouseMoved", hoverPoint.x, hoverPoint.y - 90);
	await wait(300);
	await mouse("mouseMoved", hoverPoint.x, hoverPoint.y);
	await wait(900);
	await capture("03-row-hovered");
}

/* The same state by keyboard: move the highlight off the current row. */
for (let step = 0; step < 4; step += 1) await key("ArrowDown", "ArrowDown", ARROWS);
await wait(900);
await capture("04-keyboard-highlight");

/* The mouse leaving the list entirely — is the highlight cleared? */
await mouse("mouseMoved", hoverPoint ? hoverPoint.x : 600, 40);
await wait(900);
await capture("05-pointer-left-list");

/* The persist checkbox, ticked. */
const checkPoint = await evaluate(`(() => {
  const el = document.querySelector('[role="checkbox"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (checkPoint) {
	await mouse("mousePressed", checkPoint.x, checkPoint.y);
	await mouse("mouseReleased", checkPoint.x, checkPoint.y);
	await wait(700);
	await capture("06-persist-checked");
}

/* Pick a row: photograph immediately after the click (the least-feedback
   moment), then after the owner has answered. */
const pickPoint = await centreOf('[role="option"]', 3);
if (pickPoint) {
	await mouse("mouseMoved", pickPoint.x, pickPoint.y);
	await wait(600);
	await capture("10-row-before-pick");
	await mouse("mousePressed", pickPoint.x, pickPoint.y);
	await mouse("mouseReleased", pickPoint.x, pickPoint.y);
	await wait(60);
	await capture("11-pick-immediate");
	await wait(1500);
	await capture("12-pick-in-flight");
	await wait(4000);
	await capture("13-pick-result");
}

/* Refresh from providers, photographed at the click and after it settles. */
const refreshPoint = await evaluate(`(() => {
  const el = [...document.querySelectorAll("button")].find((b) => /Refresh from providers/.test(b.textContent || ""));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`);
if (refreshPoint) {
	await mouse("mouseMoved", refreshPoint.x, refreshPoint.y);
	await wait(500);
	await capture("07-refresh-hovered");
	await mouse("mousePressed", refreshPoint.x, refreshPoint.y);
	await mouse("mouseReleased", refreshPoint.x, refreshPoint.y);
	await wait(60);
	await capture("08-refresh-clicked-immediate");
	await wait(5000);
	await capture("09-refresh-settled");
}

/* Close and look at what acknowledges the change afterwards. */
await key("Escape", "Escape", ARROWS.Escape);
await wait(1200);
await capture("14-after-close");
await evaluate("window.scrollTo(0, 0)");

/*
 * ------------------------------------------------------------------------
 * Round-2 states. Appended rather than interleaved so the nine states above
 * stay the same run, in the same order, with the same labels — a reviewer
 * comparing these frames against the audit's `before-*` halves is comparing
 * one thing, not two.
 * ------------------------------------------------------------------------
 */

/** Re-open the picker, the same way the run opened it the first time. */
const reopen = async () => {
	const box = await evaluate(`(() => {
    const el = document.querySelector('textarea[data-tour-tag="chat-input-textarea"]') || document.querySelector("textarea");
    if (!el) return null;
    el.focus();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
	if (!box) return false;
	await mouse("mousePressed", box.x, box.y);
	await mouse("mouseReleased", box.x, box.y);
	await send("Input.insertText", { text: "/model" });
	await wait(600);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await key("Enter", "Enter", ARROWS.Enter);
		for (let poll = 0; poll < 16; poll += 1) {
			await wait(500);
			if (await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`))
				return true;
		}
	}
	return false;
};

/*
 * U1's invariant — "the user can always tell which model Enter will switch to"
 * — photographed with the pointer OFF the keyboard's row AND the list scrolled
 * away from it: the footer names the row the key acts on while the pointer
 * rests somewhere else entirely.
 */
if (await reopen()) {
	await wait(1500);
	await evaluate(`(() => {
    const list = document.querySelector('[role="listbox"]');
    if (list) list.scrollTop = Math.min(1500, list.scrollHeight);
  })()`);
	await wait(700);
	const away = await centreOf('[role="option"]', 6);
	if (away) {
		await mouse("mouseMoved", away.x, away.y - 60);
		await wait(250);
		await mouse("mouseMoved", away.x, away.y);
		await wait(700);
	}
	await capture("15-footer-names-the-pick");

	/*
	 * U2: close the dialog while the pick is still in flight — the natural
	 * response to a long wait — and watch the band and the transcript. The
	 * refusal lands with nothing on screen, which is exactly the case the old
	 * close-edge write could not report.
	 *
	 * The note COUNT is measured before the click as well: the run has already
	 * been refused once by now, so the transcript already carries that sentence,
	 * and only a count can say that this pick added one of its own.
	 */
	await capture("15b-before-second-pick");
	const inFlight = await pickRowAt(3);
	if (inFlight) {
		await wait(80);
		await key("Escape", "Escape", ARROWS.Escape);
		await wait(160);
		await capture("16-closed-while-in-flight");
		await wait(3500);
		await capture("17-refusal-after-close");
	}
}

/*
 * Q1: the same pick on a row the dialog itself labels "no credential". The
 * owner accepts the spec (it is a switch, not a run), so this reaches the
 * SUCCESS path — and the strip has to say that the model it switched to cannot
 * run yet, which is the distinction the finding is about. The row is found by
 * its own rendered caveat, so the finding is reproduced from the surface rather
 * than from a fixture.
 */
if (await reopen()) {
	await wait(1500);
	const uncredentialed = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    const hit = rows.findIndex((r) => /no credential/.test(r.textContent || ""));
    if (hit < 0) return null;
    rows[hit].scrollIntoView({ block: "center" });
    return { index: hit, text: rows[hit].textContent.trim().slice(0, 80) };
  })()`);
	if (uncredentialed) {
		log(`needs-sign-in row: ${JSON.stringify(uncredentialed)}`);
		// Re-measured after the scroll: the rect read before `scrollIntoView` is
		// the row's position in its OLD scroll offset, so a click at it would land
		// on whatever the scroll had moved under the pointer.
		await wait(600);
		const point = await centreOf("[role=\"option\"]", uncredentialed.index);
		if (point) {
			await mouse("mouseMoved", point.x, point.y);
			await wait(400);
			await capture("18-needs-sign-in-row");
		}
		const clicked = await pickRowAt(uncredentialed.index);
		if (clicked) {
			log(`needs-sign-in pick: ${JSON.stringify(clicked)}`);
			await wait(2500);
			await capture("19-needs-sign-in-pick-settled");
			await key("Escape", "Escape", ARROWS.Escape);
			await wait(1200);
			await capture("20-needs-sign-in-after-close");
		}
	} else {
		log("no row carries the `no credential` caveat; Q1's state is not reachable in this run");
	}
}

const summary = await evaluate(`(() => {
  const t = document.body.innerText;
  return {
    chatRows: document.querySelectorAll("[data-chat-row]").length,
    containsReceipt: /model:.*→/.test(t),
    head: t.replace(/\\s+/g, " ").slice(0, 300),
    statusStrip: (() => {
      const el = document.querySelector("[data-session-status]") || document.querySelector("footer");
      return el ? el.textContent.replace(/\\s+/g, " ").slice(0, 200) : null;
    })(),
  };
})()`);

writeFileSync(
	join(OUT, "picker-metrics.json"),
	`${JSON.stringify({ route: ROUTE, summary, states: metrics }, null, 2)}\n`,
);
console.log(`PICKER SUMMARY ${JSON.stringify(summary)}`);
process.exit(0);
