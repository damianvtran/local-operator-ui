#!/usr/bin/env node
/**
 * The ack/selection scenes, the page readings and the backend ground truth.
 *
 *     node drive.mjs <cdp-port> <scratch-root>
 *
 * Run by `run.sh` against the BUILT app in `headless` window mode paired to an
 * isolated `local-operator serve` holding `seed.mjs`'s store, whose config names
 * the TEST hosting so a REAL turn can run with no network. Three things ride
 * the environment because the harness owns the harness: `ACK_PREFIX` (the tree
 * the frames came from), `ACK_THEME` (the palette this pass is about) and the
 * backend's URL + bearer (`ACK_BACKEND_URL`, `LOCAL_OPERATOR_DESKTOP_TOKEN`).
 *
 * WHAT IT MEASURES, and against what:
 *
 *  1. SELECTION — one row is current at a time. The rig opens the first seeded
 *     conversation, clicks a second, then a third, then back, and after every
 *     click reads `aria-current` and the computed ground of EVERY row. The
 *     defect it is looking for is a click that opens a conversation while the
 *     previously current row keeps its mark.
 *
 *  2. THE COMPLETION MARK — the operator's case. A completion is produced by
 *     POSTing a message to the isolated backend (the api's own `/messages`
 *     route), so the mark the sidebar draws is a REAL completion's `unseen`
 *     level, read from the backend itself as ground truth. Three states:
 *
 *       - open + focused: the delivery arrives while the conversation is the
 *         open, focused view. Expected: it does not stick.
 *       - open + away, then the window's return: the delivery arrives while the
 *         app is not the foreground application; the window coming back is
 *         expected to acknowledge it.
 *       - switched away and back: the operator's own workaround, recorded so
 *         the fixed behaviour can be compared against it.
 *
 *  FOCUS IS EMULATED, and this is the lever: a `headless` window is never
 *  shown and cannot be focused, so `document.hasFocus()` reads false and both
 *  the receipt's own gate and the watch lease see "nobody is watching". The rig
 *  turns `Emulation.setFocusEmulationEnabled` on and off and asserts what the
 *  PAGE reports for each state, so every reading below is taken with the page's
 *  own answer in hand rather than assuming what the lever did.
 *
 *  A BACKEND READ, NOT A DOUBLED UI READ: `unseen` off `GET
 *  /v1/desktop/sessions` is the same value the sidebar's row is a rendering of,
 *  so "the app acknowledged the completion" is proven by the backend's own
 *  answer rather than by the absence of a class.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [PORT, SCRATCH] = process.argv.slice(2);
const PREFIX = process.env.ACK_PREFIX ?? "frame";
const THEME = process.env.ACK_THEME ?? "localOperatorDark";
const BACKEND = process.env.ACK_BACKEND_URL ?? "";
const TOKEN = process.env.LOCAL_OPERATOR_DESKTOP_TOKEN ?? "";
if (!PORT || !SCRATCH) {
	console.error("usage: drive.mjs <cdp-port> <scratch-root>");
	process.exit(1);
}
const OUT = join(SCRATCH, "frames");
mkdirSync(OUT, { recursive: true });

const VIEWED = "c1c1c1c1c1c1";
const OTHER = "c2c2c2c2c2c2";
const THIRD = "c3c3c3c3c3c3";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let page = null;
for (let i = 0; i < 90; i += 1) {
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
const tryEval = async (expression) => {
	try {
		return await evaluate(expression);
	} catch {
		return null;
	}
};

const mouse = (type, x, y) =>
	send("Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button: type === "mouseMoved" ? "none" : "left",
		buttons: type === "mousePressed" ? 1 : 0,
		clickCount: type === "mouseMoved" ? 0 : 1,
	});

const capture = async (label) => {
	const result = await evaluate(
		`window.__loDevDriver.capture(${JSON.stringify(label)})`,
	);
	await wait(120);
	return result;
};

/* ---------------------------------------------------------------- the page */

await send("Page.enable");
await send("Runtime.enable");

/*
 * A RETURNING USER, the only state a multi-conversation sidebar exists in; see
 * `docs/evidence/chat-sidebar-selection/harness/drive.mjs`, whose note this is
 * copied from because the mechanics are the app's own (`onboarding-storage` is
 * the persisted preference the modal reads).
 */
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `try {
	  const existing = JSON.parse(localStorage.getItem("onboarding-storage") || "{}");
	  localStorage.setItem("onboarding-storage", JSON.stringify({
	    ...existing,
	    state: { ...(existing.state || {}), isModalComplete: true, isTourComplete: true, currentStep: "connect_provider" },
	    version: existing.version ?? 0,
	  }));
	} catch {}`,
});
await send("Page.reload", {});

const waitForApp = async () => {
	for (let i = 0; i < 160; i += 1) {
		await wait(250);
		const ready = await tryEval(
			`Boolean(window.__loDevDriver) && Boolean(document.querySelector('nav[aria-label="Chats"]'))`,
		);
		if (ready === true) return;
	}
	throw new Error("the app did not come back after the reload");
};
await waitForApp();
const dialog = await evaluate(
	`document.querySelector('[role="dialog"], [role="alertdialog"]') ? (document.querySelector('[role="dialog"], [role="alertdialog"]').innerText || '').replace(/\\s+/g, ' ').slice(0, 60) : null`,
);
if (dialog !== null)
	throw new Error(`a modal is open over the sidebar: ${dialog}`);

const armed = await evaluate("Boolean(window.__loDevDriver)");
if (!armed) throw new Error("the dev driver is not armed in this launch");
const themeResult = await evaluate(
	`window.__loDevDriver.call("setTheme", ${JSON.stringify(THEME)})`,
);
if (themeResult.dataTheme !== THEME)
	throw new Error(
		`asked for ${THEME}, the document reports ${themeResult.dataTheme}`,
	);
await wait(600);

/* ------------------------------------------------------------- the probes */

/*
 * One row's readings. `aria-current` and the computed ground are BOTH read:
 * the mark is a class plus an attribute, and the failure this rig looks for is
 * exactly the two disagreeing with where the view is.
 */
const DESCRIBE = `
  const describe = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return {
      label: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 64),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      background: css.backgroundColor,
      ariaCurrent: el.getAttribute('aria-current'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      visible: r.width > 0 && r.height > 0,
    };
  };
`;

const ROWS_PROBE = `(() => {${DESCRIBE}
  const nav = document.querySelector('nav[aria-label="Chats"]');
  const wrappers = [...document.querySelectorAll('[data-session-row]')];
  const rows = wrappers.map((w) => {
    const button = w.querySelector('[data-chat-row]');
    const srs = [...w.querySelectorAll('.sr-only')].map((s) => (s.textContent || '').replace(/\\s+/g, ' ').trim());
    const describedby = button ? button.getAttribute('aria-describedby') : null;
    const described = describedby ? (document.getElementById(describedby)?.textContent || '').replace(/\\s+/g, ' ').trim() : null;
    return {
      id: w.getAttribute('data-session-row'),
      wrapper: describe(w),
      button: describe(button),
      srTexts: srs,
      unread: srs.some((s) => /(^|, )unread$/.test(s)) || /, unread$/.test(srs.join(' ')),
      described: described ? described.slice(0, 160) : null,
    };
  });
  const other = [...document.querySelectorAll('[data-chat-row]')]
    .filter((b) => !b.closest('[data-session-row]'))
    .map((b) => ({
      label: (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
      entity: b.hasAttribute('data-entity-name'),
      ariaCurrent: b.getAttribute('aria-current'),
    }));
  const rail = [...document.querySelectorAll('[data-tour-tag^="nav-item-"]')].map((b) => ({
    tag: b.getAttribute('data-tour-tag'),
    label: (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
    ariaCurrent: b.getAttribute('aria-current'),
  }));
  const railBadges = [...document.querySelectorAll('[data-tour-tag$="-badge"]')].map((b) => ({
    tag: b.getAttribute('data-tour-tag'),
    text: (b.textContent || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 64),
  }));
  return {
    hash: location.hash,
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    rows,
    other,
    rail,
    railBadges,
  };
})()`;

const readRows = () => evaluate(ROWS_PROBE);

const centre = (rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2];

const press = async (rect) => {
	const [x, y] = centre(rect);
	await mouse("mouseMoved", x, y);
	await wait(120);
	await mouse("mousePressed", x, y);
	await mouse("mouseReleased", x, y);
	await wait(600);
	await mouse("mouseMoved", 4, 4);
	await wait(150);
};

const goto = async (hash) => {
	await evaluate(`location.hash = ${JSON.stringify(hash)}`);
	for (let i = 0; i < 60; i += 1) {
		await wait(250);
		const ready = await evaluate(
			`Boolean(document.querySelector('[data-session-row][aria-current="page"], [data-chat-row][aria-current="page"]')) || null`,
		);
		if (ready) return;
	}
	throw new Error(`no row is marked current on ${hash}`);
};

const focusEmulation = async (enabled) => {
	await send("Emulation.setFocusEmulationEnabled", { enabled });
	await wait(150);
	return await evaluate("document.hasFocus()");
};

const rowById = (probe, id) => probe.rows.find((r) => r.id === id) ?? null;

const summariseRows = (probe) => ({
	current: probe.rows
		.filter((r) => r.button && r.button.ariaCurrent === "page")
		.map((r) => ({ id: r.id, label: r.button.label })),
	unreadRows: probe.rows.filter((r) => r.unread).map((r) => r.id),
	rows: probe.rows.map((r) => ({
		id: r.id,
		label: r.button ? r.button.label.slice(0, 32) : null,
		ariaCurrent: r.button ? r.button.ariaCurrent : null,
		buttonBg: r.button ? r.button.background : null,
		wrapperBg: r.wrapper ? r.wrapper.background : null,
		unread: r.unread,
		/* The receipt's own statement, in the channel a screen reader hears: the
		   give-up arm writes `Not marked read. Click the chat to try again.` here,
		   so "the app gave up" is assertable from the DOM rather than inferred. */
		described: r.described,
		srTexts: r.srTexts,
		visible: r.button ? r.button.visible : false,
	})),
	railCurrent: probe.rail
		.filter((r) => r.ariaCurrent === "page")
		.map((r) => r.tag),
	railBadges: probe.railBadges,
});

/*
 * The row's FLYOUT, opened by the pointer: the one channel a still can show for
 * the receipt's own clause ("Unseen completion, unread · click the chat to try
 * again" against "Unseen completion, unread"). Read from the DOM as well as
 * captured, because the text is the claim and the pixels are what a person sees.
 */
const hoverRowAndRead = async (id, state) => {
	const point = await evaluate(`(() => {
	  const w = document.querySelector('[data-session-row=${JSON.stringify(id)}]');
	  if (!w) return null;
	  w.scrollIntoView({ block: 'center' });
	  const b = w.querySelector('[data-chat-row]');
	  const r = b.getBoundingClientRect();
	  return { x: r.x + r.width / 2, y: r.y + Math.min(12, r.height / 2) };
	})()`);
	if (!point) return null;
	await mouse("mouseMoved", point.x, point.y);
	await wait(1_800);
	const text = await evaluate(
		`(() => { const t = document.querySelector('[role="tooltip"]'); return t ? (t.innerText || '').replace(/\\s+/g, ' ').trim() : null; })()`,
	);
	await shoot(state);
	await mouse("mouseMoved", 4, 4);
	await wait(200);
	return { point, text };
};

/* ------------------------------------------------------- the backend truth */

const api = async (path, init = {}) => {
	const res = await fetch(`${BACKEND}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
	});
	const text = await res.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: res.status, body };
};

/* The catalogue answer, tolerance-shaped: the row we want may live under a
   `data`/`sessions`/`rows` envelope depending on the daemon's version, so the
   extractor walks for the first array of session rows rather than pinning one
   envelope. */
const extractRows = (body) => {
	const seen = new Set();
	const walk = (node, depth) => {
		if (!node || typeof node !== "object" || depth > 6 || seen.has(node))
			return null;
		seen.add(node);
		if (Array.isArray(node)) {
			if (
				node.some(
					(item) =>
						item &&
						typeof item === "object" &&
						("session_id" in item || "id" in item),
				)
			)
				return node;
			for (const item of node) {
				const found = walk(item, depth + 1);
				if (found) return found;
			}
			return null;
		}
		for (const value of Object.values(node)) {
			const found = walk(value, depth + 1);
			if (found) return found;
		}
		return null;
	};
	return walk(body, 0) ?? [];
};

const attentionOf = async (sessionId) => {
	const { status, body } = await api("/v1/desktop/sessions?limit=100");
	if (status !== 200) return { status, row: null };
	/*
	 * The catalogue names a row `id` on the wire; the renderer's transport maps
	 * that to `session_id` before the store sees it. Match on either, so a
	 * daemon that renames the field is a wrong answer here rather than an
	 * empty one.
	 */
	const row =
		extractRows(body).find((r) => (r.session_id ?? r.id) === sessionId) ?? null;
	return { status, row };
};

const sendTurn = async (sessionId, text) => {
	const request_id =
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const { status, body } = await api(
		`/v1/desktop/sessions/${sessionId}/messages`,
		{
			method: "POST",
			body: JSON.stringify({ request_id, text, images: [], mode: "prompt" }),
		},
	);
	return {
		status,
		body:
			typeof body === "object"
				? JSON.stringify(body).slice(0, 200)
				: String(body).slice(0, 200),
	};
};

/**
 * Poll the BACKEND until `unseen` answers the predicate, recording every sample
 * so the timeline (when the mark appeared, how long it stood, when it cleared)
 * is in the readings rather than reconstructed from the two ends.
 */
const waitForUnseen = async (sessionId, want, budgetMs, _label) => {
	const started = Date.now();
	const timeline = [];
	let last = null;
	while (Date.now() - started < budgetMs) {
		const { status, row } = await attentionOf(sessionId);
		if (status === 200 && row) {
			const attention = row.attention ?? null;
			const sample = {
				t: Date.now() - started,
				unseen: attention ? attention.unseen === true : null,
				token: attention?.completion_token ?? null,
				event: row.event ?? null,
				statusCode: row.status?.code ?? null,
			};
			if (
				timeline.length === 0 ||
				timeline[timeline.length - 1].unseen !== sample.unseen ||
				timeline[timeline.length - 1].statusCode !== sample.statusCode
			) {
				timeline.push(sample);
			}
			last = { attention, row };
			if (want(sample)) {
				return { ok: true, timeline, attention: last.attention, status };
			}
		} else if (
			timeline.length === 0 ||
			timeline[timeline.length - 1].http !== status
		) {
			timeline.push({ t: Date.now() - started, http: status });
		}
		await wait(300);
	}
	return {
		ok: false,
		timeline,
		attention: last?.attention ?? null,
		status: last ? 200 : 0,
	};
};

/*
 * The two channels the GIVE-UP arm writes to, read as facts rather than inferred
 * from pixels: the app's own log line (`receipt unresolved after N attempts;
 * backing off`, emitted once per budget) and the row's description / flyout
 * clause (`Not marked read. Click the chat to try again.` /
 * `click the chat to try again`). A DEFERRED refusal writes to neither.
 */
const readAppLog = () => {
	try {
		return readFileSync(join(SCRATCH, "electron.log"), "utf8");
	} catch {
		return "";
	}
};
const giveUpLines = (log) =>
	log
		.split("\n")
		.filter((line) => line.includes("receipt unresolved"))
		.map((line) => line.trim().slice(0, 160));
const giveUpClauses = (probe) =>
	probe.rows
		.filter(
			(row) =>
				(row.described ?? "").includes("Not marked read") ||
				(row.srTexts ?? []).some((text) =>
					text.includes("click the chat to try again"),
				),
		)
		.map((row) => ({ id: row.id, described: row.described }));

/* --------------------------------------------------------------- the scenes */

const readings = { label: PREFIX, theme: THEME, scenes: {} };
const verdicts = { defects: [], passes: [] };
const frames = [];

const shoot = async (state) => {
	const label = `${PREFIX}-${state}`;
	const frame = await capture(label);
	frames.push({
		state,
		label,
		file: frame.path ?? null,
		pixels: frame.pixels ?? null,
		viewport: frame.viewport ?? null,
	});
	const probe = await readRows();
	readings.scenes[state] = {
		frame: {
			label,
			file: frame.path ?? null,
			pixels: frame.pixels ?? null,
			viewport: frame.viewport ?? null,
		},
		...(readings.scenes[state] ?? {}),
		page: summariseRows(probe),
		raw: {
			hash: probe.hash,
			hasFocus: probe.hasFocus,
			visibility: probe.visibility,
		},
	};
	return probe;
};

console.log(
	`DRIVE: theme=${THEME} backend=${BACKEND ? "set" : "MISSING"} token=${TOKEN ? "set" : "MISSING"}`,
);

/* The backend must hold the seeded conversations before anything is driven. */
const initial = await attentionOf(VIEWED);
readings.catalogue = {
	status: initial.status,
	found: Boolean(initial.row),
	rowKeys: initial.row ? Object.keys(initial.row) : null,
	attention: initial.row?.attention ?? null,
};
console.log(
	`DRIVE: catalogue status=${initial.status} viewed-found=${Boolean(initial.row)} attention=${JSON.stringify(initial.row?.attention ?? null)}`,
);
if (initial.status !== 200 || !initial.row) {
	console.log(
		"DRIVE: the backend does not hold the seeded store - refusing to drive scenes",
	);
	writeFileSync(
		join(SCRATCH, `readings-${PREFIX}.json`),
		`${JSON.stringify(readings, null, 2)}\n`,
	);
	process.exit(3);
}

/* --- Scene A: the opening state -------------------------------------------------- */

await goto(`#/chat/${VIEWED}`);
await wait(800);
readings.scenes.arrive = { page: summariseRows(await readRows()) };
console.log(
	`DRIVE: arrived at ${VIEWED}: ${JSON.stringify(readings.scenes.arrive.page.current)}`,
);

/* --- Scene B: selection exclusivity ----------------------------------------------- */

const selection = { steps: [] };

const clickRow = async (id, state) => {
	/*
	 * The row is brought into view FIRST, by the page's own scroll, and its rect
	 * is re-read afterwards: the press must land on the painted centre, and a
	 * rect measured before a scroll is a coordinate the row no longer occupies.
	 */
	await evaluate(`(() => {
	  const w = document.querySelector('[data-session-row=${JSON.stringify(id)}]');
	  if (w) w.scrollIntoView({ block: 'center' });
	})()`);
	await wait(200);
	const before = await readRows();
	const row = rowById(before, id);
	if (!row || !row.button.visible)
		throw new Error(`row ${id} is not on screen`);
	await press(row.button.rect);
	await wait(700);
	const after = await readRows();
	selection.steps.push({ clicked: id, state, after: summariseRows(after) });
	if (state) await shoot(state);
	return after;
};

const focused = await focusEmulation(true);
readings.focusEmulationOn = focused;

await clickRow(OTHER, "selection-other");
await clickRow(THIRD, "selection-third");
await clickRow(VIEWED, "selection-viewed-back");

/*
 * The defect's signature: after EVERY click, exactly one session row carries
 * `aria-current="page"` and it is the row that was clicked.
 */
{
	let ok = true;
	for (const step of selection.steps) {
		const current = step.after.rows
			.filter((r) => r.ariaCurrent === "page")
			.map((r) => r.id);
		const expected = step.clicked;
		const isExclusive = current.length === 1 && current[0] === expected;
		step.verdict = { current, expected, exclusive: isExclusive };
		if (!isExclusive) ok = false;
	}
	readings.selection = selection;
	if (ok)
		verdicts.passes.push(
			"selection: exactly one current row after each click, always the clicked one",
		);
	else
		verdicts.defects.push(
			`selection: a click left ${JSON.stringify(
				selection.steps
					.filter((s) => !s.verdict.exclusive)
					.map((s) => ({ clicked: s.clicked, current: s.verdict.current })),
			)}`,
		);
}

/* --- Scene C: a completion while the conversation is the open, focused view ------ */

const receipt = {};

const runTurnAndWatch = async (state, budgetMs, extraBlur) => {
	/*
	 * The mark's IDENTITY is its completion token, so an earlier turn still
	 * standing unseen cannot stand in for this one: the baseline token is read
	 * before the send and the appearance must carry a DIFFERENT one. A drain
	 * first gives the app its chance to clear any standing mark, and the drain's
	 * outcome is recorded either way.
	 */
	const drain = await waitForUnseen(
		VIEWED,
		(s) => s.unseen === false,
		10_000,
		`${state}-drain`,
	);
	const baseline = await attentionOf(VIEWED);
	const baselineToken = baseline.row?.attention?.completion_token ?? null;
	const blur = extraBlur ? await focusEmulation(false) : null;
	const measured = {
		blur,
		drain,
		baselineToken,
		turn: null,
		appear: null,
		cleared: null,
		notes: [],
	};
	const sent = await sendTurn(VIEWED, `Rig turn ${Date.now()}`);
	measured.turn = sent;
	if (sent.status !== 200) {
		measured.notes.push(`send answered ${sent.status}: ${sent.body}`);
		return measured;
	}
	const appear = await waitForUnseen(
		VIEWED,
		(s) => s.unseen === true && s.token !== null && s.token !== baselineToken,
		budgetMs,
		state,
	);
	measured.appear = appear;
	if (!appear.ok) {
		measured.notes.push("no unseen mark appeared within budget");
		return measured;
	}
	await shoot(`${state}-unread`);
	const focusedNow = await evaluate("document.hasFocus()");
	measured.focusedWhileUnread = focusedNow;
	/* The app's own chance to acknowledge: watch the backend for the clear. */
	const cleared = await waitForUnseen(
		VIEWED,
		(s) => s.unseen === false,
		6_000,
		state,
	);
	measured.cleared = cleared;
	return measured;
};

{
	/* focused, open view: a delivery must not stick */
	const first = await runTurnAndWatch("focused", 90_000, false);
	receipt.focused = first;
	if (first.appear?.ok) {
		verdicts.passes.push(
			"focused: a real completion produced a real unseen mark while the conversation was the open view",
		);
	} else {
		verdicts.defects.push(
			"focused: no unseen mark appeared for a real completion",
		);
	}
	receipt.focused.clearedWhileWatching = Boolean(first.cleared?.ok);
	await shoot("focused-after");
	/* The remedy channel, while the mark still stands: on the defect tree the
	   ladder has given up by now and the flyout says so; a deferral says nothing. */
	receipt.focused.flyout = await hoverRowAndRead(VIEWED, "remedy-flyout");
	console.log(
		`DRIVE: flyout on the unread row: ${JSON.stringify(receipt.focused.flyout?.text ?? null)}`,
	);

	/* away, then the window's return: the operator's stated expectation */
	const away = await runTurnAndWatch("away", 90_000, true);
	receipt.away = away;
	const stillUnread =
		away.appear?.ok &&
		(await waitForUnseen(VIEWED, () => false, 3_000, "away-hold")).timeline.at(
			-1,
		)?.unseen === true;
	receipt.away.stillUnreadWhileAway = stillUnread;
	if (away.appear?.ok) {
		const returned = await focusEmulation(true);
		receipt.away.returned = returned;
		const cleared = await waitForUnseen(
			VIEWED,
			(s) => s.unseen === false,
			8_000,
			"away",
		);
		receipt.away.clearedOnReturn = cleared;
		await shoot("away-recheck");
		receipt.away.clearedWhileReturned = cleared.ok;
	} else {
		verdicts.defects.push(
			"away: no unseen mark appeared, so the return case could not be measured",
		);
	}
}

/* --- Scene D: the operator's workaround — switch away and back ------------------- */

{
	/* make sure there is something to clear: one more delivery while away */
	const beforeSwitch = await runTurnAndWatch("switch-away", 90_000, true);
	receipt.switchAway = beforeSwitch;
	if (beforeSwitch.appear?.ok) {
		await clickRow(OTHER, null);
		const backProbe = await clickRow(VIEWED, null);
		const cleared = await waitForUnseen(
			VIEWED,
			(s) => s.unseen === false,
			8_000,
			"switch-back",
		);
		receipt.switchAway.clearedOnSwitchBack = cleared;
		receipt.switchAway.backProbeUnread = summariseRows(backProbe).unreadRows;
		await shoot("switch-back");
		await focusEmulation(true);
	} else {
		verdicts.notes = verdicts.notes ?? [];
		verdicts.notes.push(
			"the switch-away turn produced no mark; scene recorded without a clear",
		);
	}
}

/*
 * THE DISCRIMINATOR, and it is the defect's own shape: a foreground refusal that
 * is treated as a FAILURE spends the shared ladder, and the ladder's two
 * statements - the `receipt unresolved ... backing off` warning and the row's
 * give-up clause - are what a reader (and this rig) can see. A DEFERRAL writes
 * neither, and the mark simply stays until the condition it is waiting for
 * (a foreground window) exists.
 */
const appLog = readAppLog();
const logGiveUps = giveUpLines(appLog);
const finalProbe = await readRows();
const clauseGiveUps = giveUpClauses(finalProbe);
readings.giveUp = {
	logLines: logGiveUps,
	rowClauses: clauseGiveUps,
	settled: Boolean(receipt.focused?.clearedWhileWatching),
	returned: Boolean(receipt.away?.clearedWhileReturned),
	switchBack: receipt.switchAway?.clearedOnSwitchBack?.ok === true,
};
if (logGiveUps.length > 0 || clauseGiveUps.length > 0) {
	verdicts.defects.push(
		`the receipt gave up on a refusal that only said "not now" (log lines: ${logGiveUps.length}, row clauses: ${clauseGiveUps.length})`,
	);
} else {
	verdicts.passes.push(
		"the foreground refusal deferred: no give-up warning in the app log, no give-up clause on the row",
	);
}
verdicts.notes = verdicts.notes ?? [];
verdicts.notes.push(
	"RESIDUAL, BY CONSTRUCTION: the final CLEAR cannot be observed in this rig. Every receipt is refused by main's `guardForegroundReceipts`, because a headless window is never visible or focused and stealing the operator's focus to satisfy it is not a lever a rig may use. What is proven here is the deferral and its shape; the clear under a genuine foreground window is covered by the in-process suite (`scripts/completion-view-ack.test.mjs`) and the operator's live app.",
);
verdicts.notes.push(
	"FOCUS LAYER: the renderer gate (`document.hasFocus()` / `visibilityState`) was driven with CDP `Emulation.setFocusEmulationEnabled`, and `document.hasFocus()` was read back in every scene (see `raw.hasFocus`); main's gate (`BrowserWindow.isVisible() && !isMinimized() && isFocused()`) is the layer no agent rig can satisfy.",
);

readings.receipt = receipt;
readings.verdicts = verdicts;

writeFileSync(
	join(SCRATCH, `readings-${PREFIX}.json`),
	`${JSON.stringify(readings, null, 2)}\n`,
);
writeFileSync(
	join(SCRATCH, `frames-${PREFIX}.json`),
	`${JSON.stringify(frames, null, 2)}\n`,
);

console.log("---- VERDICT ----");
for (const pass of verdicts.passes) console.log(`PASS ${pass}`);
for (const defect of verdicts.defects) console.log(`DEFECT ${defect}`);
for (const note of verdicts.notes ?? []) console.log(`NOTE ${note}`);
console.log(`---- ${verdicts.defects.length} defect(s) observed ----`);

process.exit(verdicts.defects.length > 0 ? 2 : 0);
