#!/usr/bin/env node
/**
 * The operator's defect-2 sequence, driven against HER rail row.
 *
 *     node drive-aida.mjs <cdp-port> <scratch-root>
 *
 * The operator's report, verbatim: "if you click the aida sidebar it correctly
 * selects the aida session but then if you click to another conversation it
 * keeps aida highlighted instead of properly unhighlighting". The sequence this
 * rig drives is exactly that: press the rail row, then press a conversation in
 * the chat list, and read - after every press - the rail row's `aria-current`
 * and computed ground, the list rows' marks, the hash, and the pane's own
 * text. Two readings discriminate the report: (a) the pane moves to the other
 * conversation while her row stays lit (highlight staleness), and (b) the
 * switch never lands (pane stays on her). The rig records both states for every
 * press, and the same-point press of the list's repeat-press guard as its own
 * scene because it is the one press this app holds back by design.
 *
 * Run by `run.sh` through `run-aida.sh`, which turns the assistant ON for the
 * isolated launches (`ACK_NO_AIDA=0`, `aida.enabled: true` in the seed). Her
 * row exists only with the capability AND the install switch open; the row and
 * its badge/marks are read through `nav-item-aida` / `nav-aida-badge`.
 *
 * The badge scene is the manager's question (i): a completion in her session
 * while her conversation is the open view, read through the deferral window.
 * The gone-conversation scene is question (b): a press on a conversation the
 * backend no longer holds, while hers is current - on this build `openSession`
 * has no guard read and no rollback, so the switch must STAND and her row must
 * stay unlit (the stream answers the 404 with the pane's missing notice).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/* Her row exists only while the aida read answers enabled; poll for it. */
const waitForHerRow = async (budgetMs) => {
	const started = Date.now();
	while (Date.now() - started < budgetMs) {
		const probe = await readRows();
		if (probe.rail.some((r) => r.tag === "nav-item-aida"))
			return { probe, ms: Date.now() - started };
		await wait(500);
	}
	return null;
};

const herRow = (probe) =>
	probe.rail.find((r) => r.tag === "nav-item-aida") ?? null;
const herBadge = (probe) =>
	probe.railBadges.find((b) => b.tag === "nav-aida-badge") ?? null;

/*
 * The pane's own text, as the proxy for "which conversation the view is on":
 * the transcript carries `role="log"` (canonical-transcript.tsx), and a notice
 * (a missing session, a tombstone) renders inside it - so this reads the pane
 * rather than inferring it from the highlight.
 */
const PANE_PROBE = `(() => {
  const log = document.querySelector('[role="log"]');
  return {
    paneText: log ? (log.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 260) : null,
    panePresent: Boolean(log),
  };
})()`;

const sceneRead = async (state) => {
	const probe = await readRows();
	const pane = await evaluate(PANE_PROBE);
	const working = await evaluate(
		`(() => { const b = document.querySelector('[data-tour-tag="nav-item-aida"]'); return b ? Boolean(b.querySelector('svg[class*="animate-spin"]')) : null; })()`,
	);
	const scene = {
		hash: probe.hash,
		herRow: herRow(probe),
		herBadge: herBadge(probe),
		herWorking: working,
		rail: probe.rail,
		railBadges: probe.railBadges,
		currentList: probe.rows
			.filter((r) => r.button && r.button.ariaCurrent === "page")
			.map((r) => ({ id: r.id, label: r.button.label })),
		pane,
	};
	readings.scenes[state] = { ...(readings.scenes[state] ?? {}), ...scene };
	if (state) await shoot(state);
	return scene;
};

const pressHerRow = async () => {
	const rect = await evaluate(`(() => {
	  const b = document.querySelector('[data-tour-tag="nav-item-aida"]');
	  if (!b) return null;
	  const r = b.getBoundingClientRect();
	  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
	})()`);
	if (!rect) throw new Error("her rail row has no button");
	await press(rect);
};

const pressListRow = async (id) => {
	await evaluate(`(() => {
	  const w = document.querySelector('[data-session-row=${JSON.stringify(id)}]');
	  if (w) w.scrollIntoView({ block: 'center' });
	})()`);
	await wait(250);
	const before = await readRows();
	const row = rowById(before, id);
	if (!row || !row.button.visible)
		throw new Error(`row ${id} is not on screen`);
	await press(row.button.rect);
	await wait(900);
	return before;
};

/* --- Scene 0: her row idle --------------------------------------------------------- */

await goto(`#/chat/${VIEWED}`);
await wait(800);
const stood = await waitForHerRow(25_000);
if (!stood) {
	readings.fatal =
		"her rail row never rendered: the aida read never answered enabled";
	writeFileSync(
		join(SCRATCH, `readings-${PREFIX}.json`),
		`${JSON.stringify(readings, null, 2)}\n`,
	);
	console.log("DRIVE: her rail row never rendered - refusing to drive scenes");
	process.exit(3);
}
readings.herRail = { waitedMs: stood.ms, row: herRow(stood.probe) };
console.log(
	`DRIVE: her rail row appeared after ${stood.ms} ms: ${JSON.stringify(herRow(stood.probe))}`,
);
const idle = await sceneRead("her-idle");
console.log(
	`DRIVE: idle: her=${JSON.stringify(idle.herRow)} badge=${JSON.stringify(idle.herBadge)} list=${JSON.stringify(idle.currentList.map((c) => c.id))}`,
);

/* --- Scene 1: the operator's step 1 - press her rail row --------------------------- */

const herPressStart = Date.now();
await pressHerRow();
let herOpen = null;
for (let i = 0; i < 80; i += 1) {
	await wait(250);
	const probe = await readRows();
	const her = herRow(probe);
	if (her && her.ariaCurrent === "page" && probe.hash.startsWith("#/chat/")) {
		herOpen = { probe, ms: Date.now() - herPressStart };
		break;
	}
}
if (!herOpen) {
	verdicts.defects.push(
		"pressing her rail row never marked it current - the press did not select her",
	);
	readings.sequence = { refused: "her press never selected" };
} else {
	const herSessionId = herOpen.probe.hash.slice("#/chat/".length);
	readings.herSession = { id: herSessionId, selectedAfterMs: herOpen.ms };
	console.log(
		`DRIVE: her row selected after ${herOpen.ms} ms; her session is ${herSessionId}`,
	);
	const selected = await sceneRead("her-selected");
	console.log(
		`DRIVE: her-selected: her=${selected.herRow?.ariaCurrent} list=${JSON.stringify(selected.currentList.map((c) => c.id))} hash=${selected.hash}`,
	);

	/*
	 * --- Scene 2: the operator's step 2 - a chat-list press after hers ---------------
	 */
	const sequence = [];
	const listStep = async (id, state) => {
		await pressListRow(id);
		const scene = await sceneRead(state);
		const entry = {
			pressed: id,
			state,
			hash: scene.hash,
			herCurrent: scene.herRow ? scene.herRow.ariaCurrent : null,
			herBackground: scene.herRow ? scene.herRow.background : null,
			listCurrent: scene.currentList.map((c) => c.id),
			paneHead: scene.pane.paneText ? scene.pane.paneText.slice(0, 90) : null,
		};
		sequence.push(entry);
		console.log(
			`DRIVE: pressed ${id}: hash=${entry.hash} her=${entry.herCurrent ?? "none"} list=${JSON.stringify(entry.listCurrent)}`,
		);
		return scene;
	};
	await listStep(OTHER, "after-other");
	await listStep(THIRD, "after-third");

	/*
	 * --- Scene 3: the same point pressed twice, pointer unmoved (the guard) ---------
	 */
	{
		const before = await pressListRow(OTHER);
		const rect = before.rows.find((r) => r.id === OTHER)?.button.rect;
		const firstAfter = await readRows();
		const cx = rect.x + rect.width / 2;
		const cy = rect.y + rect.height / 2;
		await wait(300);
		await mouse("mousePressed", cx, cy);
		await mouse("mouseReleased", cx, cy);
		await wait(900);
		const second = await sceneRead("repeat-same-point");
		const moved = {
			repeated: {
				hash: second.hash,
				listCurrent: second.currentList.map((c) => c.id),
			},
		};
		/* The record is expired by a real move: away, then a DIFFERENT row. */
		await mouse("mouseMoved", cx + 60, cy + 60);
		await wait(200);
		const thirdRow = rowById(await readRows(), THIRD);
		if (thirdRow?.button?.visible) {
			await mouse(
				"mouseMoved",
				thirdRow.button.rect.x + thirdRow.button.rect.width / 2,
				thirdRow.button.rect.y + thirdRow.button.rect.height / 2,
			);
			await wait(200);
			await mouse(
				"mousePressed",
				thirdRow.button.rect.x + thirdRow.button.rect.width / 2,
				thirdRow.button.rect.y + thirdRow.button.rect.height / 2,
			);
			await mouse(
				"mouseReleased",
				thirdRow.button.rect.x + thirdRow.button.rect.width / 2,
				thirdRow.button.rect.y + thirdRow.button.rect.height / 2,
			);
			await wait(900);
		}
		const third = await sceneRead("repeat-after-move");
		moved.afterMove = {
			hash: third.hash,
			listCurrent: third.currentList.map((c) => c.id),
		};
		readings.repeatPress = moved;
		console.log(
			`DRIVE: repeat-press: same-point=${JSON.stringify(moved.repeated)} after-move=${JSON.stringify(moved.afterMove)}`,
		);
	}

	/*
	 * --- Scene 4: a conversation the backend no longer holds, hers current ----------
	 */
	{
		await pressHerRow();
		await wait(1200);
		const held = await sceneRead("gone-hold");
		if (held.herRow?.ariaCurrent !== "page")
			verdicts.notes.push(
				"the gone-conversation scene could not re-select her row before the press",
			);
		/*
		 * The row's LAST painted rect, captured before the store moves under it:
		 * a reader presses the row they can SEE, and the feed's reap of a deleted
		 * conversation can land between the unlink and the press (measured: the
		 * press then lands on whichever row slid into place, and the readings
		 * record that instead of the scene refusing to run). The run's OWN
		 * scratch store is what is unlinked.
		 */
		const before = await readRows();
		const otherRow = rowById(before, OTHER);
		readings.gonePress = {
			rowPresent: Boolean(otherRow?.button?.visible),
		};
		const otherDir = join(SCRATCH, "config", "sessions", OTHER);
		rmSync(otherDir, { recursive: true, force: true });
		if (otherRow?.button?.visible) {
			await press(otherRow.button.rect);
			await wait(900);
		} else {
			verdicts.notes.push(
				"the gone-conversation row was already reaped before the press; the scene records the hold only",
			);
		}
		await wait(2_600);
		const gone = await sceneRead("after-gone");
		/* The stream's 404 is a round trip: give it a second window, then re-read. */
		await wait(6_000);
		const goneLate = await sceneRead("after-gone-late");
		readings.goneLate = {
			paneHead: goneLate.pane.paneText
				? goneLate.pane.paneText.slice(0, 140)
				: null,
		};
		const entry = {
			hash: gone.hash,
			herCurrent: gone.herRow ? gone.herRow.ariaCurrent : null,
			listCurrent: gone.currentList.map((c) => c.id),
			paneHead: gone.pane.paneText ? gone.pane.paneText.slice(0, 140) : null,
		};
		readings.goneConversation = entry;
		console.log(
			`DRIVE: gone conversation pressed: hash=${entry.hash} her=${entry.herCurrent ?? "none"} list=${JSON.stringify(entry.listCurrent)} pane=${JSON.stringify(entry.paneHead)}`,
		);
	}

	/*
	 * --- Scene 5: a completion in her conversation, and her badge -------------------
	 */
	{
		await pressHerRow();
		await wait(1500);
		const before = await sceneRead("badge-before");
		readings.badge = {
			before: {
				badge: before.herBadge,
				list: before.currentList.map((c) => c.id),
			},
		};
		console.log(`DRIVE: badge before=${JSON.stringify(before.herBadge)}`);
		/*
		 * THE FRESH-COMPLETION TIMELINE, and the frame the busy mark gets (round-2
		 * D1/Q1). `data-completion-complete` is the attribute the receipt's anchor
		 * gate asks for; the probe records, per 200 ms, whether it is present on
		 * the pane's own anchors and whether the row still says it is responding,
		 * so the moment the harness can (and cannot) acknowledge a fresh
		 * completion is measured rather than inferred. The working frame is taken
		 * on the first sample that shows the spinner, before the turn settles.
		 */
		const FRESHNESS_PROBE = `(() => {
		  const pane = document.querySelector('[role="log"]');
		  const anchors = [...document.querySelectorAll('[data-completion-anchor]')].map((el) => ({
		    id: el.getAttribute('data-completion-anchor'),
		    complete: el.getAttribute('data-completion-complete') === 'true',
		  }));
		  return {
		    anchors,
		    completeCount: anchors.filter((a) => a.complete).length,
		    responding: pane ? /responding/i.test(pane.innerText || '') : null,
		  };
		})()`;
		const freshness = { samples: [], workingFrame: null };
		let workingSeen = null;
		const sent = await sendTurn(
			herSessionId,
			"Rig turn: a ledger note, please.",
		);
		readings.badge.turn = { status: sent.status };
		/*
		 * The busy mark is the turn's own length, and the rail row states it in
		 * its own accessible name ("Aida, working", `renderNavItem`'s `markLabel`)
		 * as well as in the spinner glyph, so the poll asks the NAME rather than
		 * a class that a reduced-motion build drops (`motion-safe:animate-spin`
		 * keeps the static glyph). Generous on purpose: the mark's window is the
		 * mock turn plus the status feed's lag.
		 */
		for (let i = 0; i < 200; i += 1) {
			const busy = await evaluate(
				`(() => { const b = document.querySelector('[data-tour-tag="nav-item-aida"]'); if (!b) return null; return { label: b.getAttribute('aria-label'), spin: Boolean(b.querySelector('svg[class*="animate-spin"]')) }; })()`,
			);
			if (
				busy &&
				(/(^|, )working$/.test(busy.label ?? "") || busy.spin === true)
			) {
				workingSeen = i * 100;
				await shoot("her-working");
				freshness.workingFrame = "her-working";
				break;
			}
			await wait(100);
		}
		for (let i = 0; i < 150; i += 1) {
			await wait(200);
			const sample = await evaluate(FRESHNESS_PROBE);
			const last = freshness.samples.at(-1);
			if (
				!last ||
				last.completeCount !== sample.completeCount ||
				last.responding !== sample.responding
			) {
				freshness.samples.push({
					t: i * 200,
					completeCount: sample.completeCount,
					responding: sample.responding,
					anchors: sample.anchors,
				});
			}
			freshness.lastT = i * 200;
			if (i > 4 && sample.completeCount > 0 && sample.responding === false)
				break;
		}
		freshness.finalSample = {
			t: freshness.lastT ?? 0,
			completeCount: (freshness.samples.at(-1) ?? {}).completeCount ?? 0,
		};
		readings.badge.freshness = freshness;
		readings.badge.workingSeenAfterMs = workingSeen;
		console.log(
			`DRIVE: freshness last=${JSON.stringify(freshness.samples.at(-1) ?? null)} workingSeen=${workingSeen}`,
		);
		const appeared = await waitForUnseen(
			herSessionId,
			(s) => s.unseen === true,
			60_000,
			"badge",
		);
		readings.badge.appear = {
			ok: appeared.ok,
			timeline: appeared.timeline,
			attention: appeared.attention,
		};
		console.log(
			`DRIVE: her completion arrived: ${JSON.stringify(readings.badge.appear.timeline?.at?.(-1) ?? null)} workingSeen=${workingSeen}`,
		);
		let badgeWaitMs = null;
		for (let i = 0; i < 120; i += 1) {
			const probe = await readRows();
			if (herBadge(probe)) {
				badgeWaitMs = i * 250;
				break;
			}
			await wait(250);
		}
		readings.badge.badgeWaitMs = badgeWaitMs;
		const marked = await sceneRead("her-badge");
		readings.badge.marked = { badge: marked.herBadge, herRow: marked.herRow };
		/* The notice's own arrival, read while it is still fresh (Q3's "early" arm). */
		readings.viewedRowEarly = {
			describedBy: await evaluate(
				`(() => { const b = document.querySelector('[data-session-row=${JSON.stringify(herSessionId)}] [data-chat-row]'); return b ? b.getAttribute('aria-describedby') : null; })()`,
			),
			badge: marked.herBadge,
		};
		console.log(
			`DRIVE: badge after completion=${JSON.stringify(marked.herBadge)}`,
		);
		/*
		 * Q3: the viewed unread row's own channels, read before touching anything
		 * else - the flyout text (a dwell), and the `aria-describedby` attribute
		 * (present only while this row has a remedy sentence to point at).
		 */
		{
			const described = await evaluate(
				`(() => { const b = document.querySelector('[data-session-row=${JSON.stringify(herSessionId)}] [data-chat-row]'); return b ? b.getAttribute('aria-describedby') : null; })()`,
			);
			const flyout = await hoverRowAndRead(herSessionId, "viewed-row-flyout");
			readings.viewedRow = { describedBy: described, flyout };
			console.log(
				`DRIVE: viewed-row: describedBy=${JSON.stringify(described)} flyout=${JSON.stringify(flyout && flyout.text)}`,
			);
		}
		/*
		 * The re-read leg of the freshness question: leave the conversation and
		 * come back, then read the same probe - the operator's own switch shape,
		 * and the reading QA's Q1 says makes the attribute appear.
		 */
		{
			await pressListRow(THIRD);
			await wait(1200);
			await pressHerRow();
			await wait(1800);
			const after = await evaluate(FRESHNESS_PROBE);
			readings.badge.freshnessAfterReRead = after;
			console.log(`DRIVE: freshness after re-read=${JSON.stringify(after)}`);
		}
		/* The ladder's own window, so a give-up (if any) is on the log by now. */
		await wait(75_000);
		const logLines = giveUpLines(readAppLog());
		const finalProbe = await readRows();
		const clauses = giveUpClauses(finalProbe);
		readings.giveUp = { logLines, rowClauses: clauses };
		console.log(
			`DRIVE: give-up check: logLines=${logLines.length} rowClauses=${clauses.length}`,
		);
		/* The bulk receipt, if the backend offers it, as the live-clear path. */
		const bulk = await evaluate(
			`(() => { const b = [...document.querySelectorAll('button')].find((x) => /(mark|clear).{0,24}read/i.test(x.innerText || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { label: (b.innerText || '').trim().slice(0, 48), x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
		);
		if (bulk) {
			await mouse("mouseMoved", bulk.x, bulk.y);
			await wait(120);
			await mouse("mousePressed", bulk.x, bulk.y);
			await mouse("mouseReleased", bulk.x, bulk.y);
			await wait(2_000);
			const toast = await evaluate(
				`(() => { const t = document.querySelector('[data-sonner-toast]'); return t ? (t.innerText || '').replace(/\\s+/g, ' ').trim() : null; })()`,
			);
			const cleared = await sceneRead("her-badge-cleared");
			readings.badge.bulk = {
				label: bulk.label,
				badge: cleared.herBadge,
				toast,
			};
			console.log(
				`DRIVE: bulk "${bulk.label}" -> badge=${JSON.stringify(cleared.herBadge)}`,
			);
		} else {
			verdicts.notes.push(
				"the bulk read-receipt control was not found in the DOM; the badge's live clear is recorded through the backend read only",
			);
			readings.badge.bulk = null;
		}
	}

	/*
	 * --- The verdict ----------------------------------------------------------------
	 */
	{
		let ok = true;
		for (const step of sequence) {
			const exclusive =
				step.herCurrent === null &&
				step.listCurrent.length === 1 &&
				step.listCurrent[0] === step.pressed &&
				step.hash === `#/chat/${step.pressed}`;
			step.verdict = { ...step, exclusive };
			if (!exclusive) ok = false;
		}
		readings.sequence = sequence;
		if (ok)
			verdicts.passes.push(
				"her rail row unlights on every chat-list press, and the pressed row alone is current",
			);
		else
			verdicts.defects.push(
				`a chat-list press left the wrong marks: ${JSON.stringify(
					sequence
						.filter((s) => !s.verdict.exclusive)
						.map((s) => ({
							pressed: s.pressed,
							her: s.herCurrent,
							list: s.listCurrent,
							hash: s.hash,
						})),
				)}`,
			);
	}
}

const finalLog = readAppLog();
readings.giveUp = readings.giveUp ?? {};
readings.giveUp.logLines = readings.giveUp.logLines ?? giveUpLines(finalLog);
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
