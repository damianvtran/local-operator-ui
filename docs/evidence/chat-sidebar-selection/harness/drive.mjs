#!/usr/bin/env node
/**
 * The chat-sidebar selection frames, and the page readings that back them.
 *
 *     node drive.mjs <cdp-port> <out-dir> <route>
 *
 * Run by the window-mode harness (`DRIVE_SCRIPT`) — that signature is the
 * harness's, not this set's — against the BUILT app in `headless` window mode
 * paired to an isolated `local-operator serve` holding `seed.mjs`'s store. The
 * dev driver is armed for this launch, so the theme is set through the app's own
 * action (`setTheme`, the settings picker's verb) and the pixels come from
 * `webContents.capturePage()` — the app photographing itself — rather than from
 * a screenshot tool.
 *
 * Three things ride the environment because the harness owns the argument list:
 * `SIDEBAR_PREFIX` (`before`/`after`, the tree the frames came from),
 * `SIDEBAR_THEME` (the palette this pass is about) and `COMPARISON=1` (capture
 * the alternative-ground frame as well).
 *
 * WHAT IT CAPTURES, and why each state is its own frame:
 *
 *   <prefix>-selected         a session row marked current, with siblings above
 *                             and below it. The operator's report is about this
 *                             row, and a row alone in the list would not show it.
 *   <prefix>-selected-hover   the pointer ON that row. `rowStyle` carries a
 *                             hover step and the hover variant outranks a bare
 *                             background, so before the fix this frame showed the
 *                             selection being REPLACED by the hover ground.
 *   <prefix>-all-chats        the All chats filter active — the same
 *                             current-row state on the same panel ground.
 *   <prefix>-new-chat         the New chat row marked by a staged draft — the
 *                             second row the fix covers.
 *   <prefix>-selected-sibling-hover
 *                             the pointer on the row ABOVE the current one:
 *                             selection and hover on screen together, which is
 *                             what "the pointer read as the current row and the
 *                             current row did not" is a claim about.
 *   <prefix>-selected-bound   the agent-bound conversation selected, so the
 *                             marked row carries a trailing statement
 *                             (`· architect`) and a truncating title.
 *   <prefix>-nested-current   the same conversation's NESTED row (`pl-7`) under
 *                             its expanded entity, which is the only place a
 *                             child row's ground is on screen.
 *   <prefix>-entity-draft,
 *   <prefix>-entity-draft-hover
 *                             the entity row staging a TARGETED draft, at rest
 *                             and under the pointer. Round 1's MAJOR: this
 *                             element carries the hover step inside the element
 *                             that carries the ground.
 *   <prefix>-settings-rail     the settings rail's current section, the same
 *                             `surface` pairing on a second panel (design D2).
 *   comparison-accent-tint    NOT a shipped state: the leading alternative
 *                             ground (an accent tint matched in perceptual
 *                             strength to the shipped step), injected on the
 *                             selected row for the design round to judge on
 *                             pixels. Its hex is derived here, per theme, from
 *                             the palette source rather than invented.
 *
 * Every reading in `<out-dir>/readings-*.json` is read OUT OF THE PAGE at
 * capture time — computed background colours, classes, `aria-current`, geometry
 * and the CSS viewport — because a claim about what the user sees cannot be
 * checked against the source that may have failed to paint it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deltaE, r2 } from "../../../../scripts/color.mjs";
import { loadPalettes } from "../../../../scripts/palette-source.mjs";

const [PORT, OUT, ROUTE] = process.argv.slice(2);
const PREFIX = process.env.SIDEBAR_PREFIX ?? "frame";
const THEME = process.env.SIDEBAR_THEME ?? "localOperatorDark";
const SESSION = (ROUTE ?? "").match(/chat\/([0-9a-z]+)/)?.[1];
if (!PORT || !OUT || !SESSION) {
	console.error("usage: drive.mjs <cdp-port> <out-dir> <#/chat/session-id>");
	process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** `evaluate` that answers null instead of throwing, for the moments a reload
    is tearing the execution context down and an evaluation cannot land. */
const tryEval = async (expression) => {
	try {
		return await evaluate(expression);
	} catch {
		return null;
	}
};

await send("Page.enable");
await send("Runtime.enable");

/*
 * A RETURNING USER, which is the only state a multi-conversation sidebar exists
 * in. A profile with no onboarding flag opens the `Connect a provider` modal at
 * step 1 of 6 — a 560x804 dialog down the middle of the window that also puts
 * `aria-hidden` on the whole app behind it, so a frame taken in that state would
 * be a picture of onboarding with a sidebar somewhere at the edge. The flag is
 * the app's own persisted preference (`onboarding-store`, `onboarding-storage`),
 * written before the document's scripts run and then reloaded into, rather than
 * dismissing the modal by pressing Skip: a `Skip` press is a different state
 * again (the tour), and this set is not about either.
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

/** The app's own capture. Returns the file it wrote and the viewport it wrote it at. */
const capture = async (label) => {
	const result = await evaluate(
		`window.__loDevDriver.capture(${JSON.stringify(label)})`,
	);
	await wait(150);
	return result;
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

/**
 * One frame's readings, read from the page.
 *
 * `background` is the COMPUTED colour, so a class that lost a cascade fight
 * reads as the colour that actually painted — which is the whole failure mode
 * here: the hover variant beat the selection ground and no string in the source
 * said so.
 */
const DESCRIBE = `
  const css = (el) => el === null ? null : getComputedStyle(el);
  const describe = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      label: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48),
      background: css(el).backgroundColor,
      color: css(el).color,
      classes: typeof el.className === 'string' ? el.className : '',
      ariaCurrent: el.getAttribute('aria-current'),
      ariaPressed: el.getAttribute('aria-pressed'),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  };
`;

const PROBE = `(() => {${DESCRIBE}
  const nav = document.querySelector('nav[aria-label="Chats"]');
  const rows = [...document.querySelectorAll('[data-chat-row]')];
  const current = rows.find((r) => r.getAttribute('aria-current') === 'page') || null;
  const currentIndex = current === null ? null : rows.indexOf(current);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    hash: location.hash,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    panel: describe(nav),
    rowCount: rows.length,
    currentIndex,
    panelText: (nav ? nav.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 240),
    current: describe(current),
    rows: rows.map(describe),
  };
})()`;

/**
 * The entity row's own elements — the wrapper, the name button and the
 * disclosure control — because on THAT row the ground and the hover step live on
 * different elements, so only reading them separately can tell whether the
 * pointer is painting over the mark (round 1's MAJOR).
 */
const ENTITY_PROBE = (name) => `(() => {${DESCRIBE}
  const nav = document.querySelector('nav[aria-label="Chats"]');
  const wanted = 'New chat with ' + ${JSON.stringify(name)};
  const row = nav === null ? null : [...nav.querySelectorAll('[data-entity]')].find(
    (el) => (el.querySelector('[data-entity-name]')?.getAttribute('aria-label') || '') === wanted,
  );
  if (!row) return null;
  return {
    wrapper: describe(row.firstElementChild),
    name: describe(row.querySelector('[data-entity-name]')),
    disclosure: describe(row.querySelector('[data-disclosure]')),
    panel: describe(nav),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  };
})()`;

/** The settings rail and the section it marks current (design round 1, D2). */
const RAIL_PROBE = `(() => {${DESCRIBE}
  const rail = document.querySelector('nav[aria-label="Settings sections"]');
  return {
    rail: describe(rail),
    active: describe(rail === null ? null : rail.querySelector('[aria-current="page"]')),
    navs: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  };
})()`;

const readings = [];

/** Capture one frame and keep the page's readings from the moment it was taken. */
const record = async (state, frame) => {
	const probe = await evaluate(PROBE);
	readings.push({
		state,
		frame: frame.label,
		file: frame.path,
		pixels: frame.pixels,
		viewport: frame.viewport,
		board: {
			theme: probe.theme,
			hash: probe.hash,
			current: probe.current?.label ?? null,
			currentBackground: probe.current ? hex(probe.current.background) : null,
			currentClasses: probe.current?.classes ?? null,
			currentAria: probe.current?.ariaCurrent ?? null,
			panelBackground: probe.panel ? hex(probe.panel.background) : null,
		},
	});
	return probe;
};

/**
 * The panel ground the rows are drawn on, as the page computes it.
 *
 * A row that paints NOTHING reports `rgba(0, 0, 0, 0)` — an unselected row is
 * transparent over the panel, and calling that black would put a colour in the
 * readings that no pixel on screen has. Transparent answers null, and the caller
 * reads the panel ground for what the eye sees there.
 */
const hex = (rgb) => {
	const parts = (rgb.match(/[\d.]+/g) ?? []).map(Number);
	if (parts.length === 4 && parts[3] === 0) return null;
	const [r, g, b] = parts;
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

const goto = async (hash) => {
	await evaluate(`location.hash = ${JSON.stringify(hash)}`);
	for (let i = 0; i < 60; i += 1) {
		await wait(250);
		const ready = await evaluate(
			`(() => {
			   const rows = [...document.querySelectorAll('[data-chat-row]')];
			   return rows.some((r) => r.getAttribute('aria-current') === 'page');
			 })()`,
		);
		if (ready) return;
	}
	throw new Error(`no row is marked current on ${hash}`);
};

/* The theme through the app's own action, so the whole document — not just the
   attribute — is the palette this frame claims. */
const armed = await evaluate("Boolean(window.__loDevDriver)");
if (!armed) throw new Error("the dev driver is not armed in this launch");
const themeResult = await evaluate(
	`window.__loDevDriver.call("setTheme", ${JSON.stringify(THEME)})`,
);
if (themeResult.dataTheme !== THEME)
	throw new Error(
		`asked for ${THEME}, the document reports ${themeResult.dataTheme}`,
	);

/*
 * `Previous chats` is COLLAPSED by default — `heading("previous")` passes no
 * `initial`, and a fresh profile carries no stored `chat-sidebar-disclosures` —
 * so a seeded store's older conversations are off screen entirely and the
 * frames would be of an empty list. Pressing the heading is the user's own path
 * to them; there is no API for the disclosure state.
 */
/*
 * The rig waits for the heading rather than reading it once. The sidebar paints
 * before its catalogue answers, so on a loaded machine the first look lands on a
 * list with no rows in it at all — and a one-shot read there fails the run with
 * "no Previous chats heading in the sidebar", which is a statement about the
 * machine's load rather than about the app. Two passes of this set were lost to
 * exactly that before the loop went in.
 */
let heading = null;
for (let i = 0; i < 80; i += 1) {
	heading = await tryEval(`(() => {
	  const button = [...document.querySelectorAll('nav[aria-label="Chats"] button')]
	    .find((el) => el.textContent.trim().startsWith('Previous chats'));
	  if (!button) return null;
	  const r = button.getBoundingClientRect();
	  return { x: r.x + r.width / 2, y: r.y + r.height / 2, expanded: button.getAttribute('aria-expanded') };
	})()`);
	if (heading !== null) break;
	await wait(250);
}
if (heading === null) throw new Error("no Previous chats heading in the sidebar");
if (heading.expanded === "false") {
	await mouse("mouseMoved", heading.x, heading.y);
	await wait(150);
	await mouse("mousePressed", heading.x, heading.y);
	await mouse("mouseReleased", heading.x, heading.y);
	await wait(700);
	await mouse("mouseMoved", 4, 4);
	await wait(300);
}

await goto(`#/chat/${SESSION}`);
await wait(600);

const selected = await capture(`${PREFIX}-selected`);
const selectedProbe = await record("selected", selected);
if (selectedProbe.current === null)
	throw new Error("no row is marked current in the selected frame");
if (
	selectedProbe.currentIndex === 0 ||
	selectedProbe.currentIndex === selectedProbe.rowCount - 1
)
	throw new Error(
		`the selected row is at index ${selectedProbe.currentIndex} of ${selectedProbe.rowCount}; it needs siblings above and below`,
	);

/*
 * The real pointer, at the row's own centre: `:hover` is a browser heuristic on
 * a real mouse position and no scripted class can stand in for it.
 */
const centre = (rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2];
const [sx, sy] = centre(selectedProbe.current.rect);
await mouse("mouseMoved", sx, sy);
await wait(400);
const hovered = await record(
	"selected-hover",
	await capture(`${PREFIX}-selected-hover`),
);
await mouse("mouseMoved", 4, 4);
await wait(300);

/*
 * The pointer on a NEIGHBOUR, which is the state the report is really about:
 * selection and hover on screen at once. It is the reading that says the two
 * grounds are on OPPOSITE sides of the panel (recessed vs raised) rather than
 * one being a louder version of the other.
 */
const above = selectedProbe.rows[selectedProbe.currentIndex - 1];
if (above === undefined)
	throw new Error("no sibling above the selected row to hover");
await mouse("mouseMoved", above.rect.x + above.rect.width / 2, above.rect.y + above.rect.height / 2);
await wait(400);
const siblingHover = await record(
	"selected-sibling-hover",
	await capture(`${PREFIX}-selected-sibling-hover`),
);
await mouse("mouseMoved", 4, 4);
await wait(300);

/*
 * A row by its visible text. `startsWith` first, then a substring: a SESSION
 * row's `innerText` is led by the status slot's `sr-only` sentence rather than by
 * its title, so the title is nowhere near the start of the string the page
 * reports. The prefix pass keeps `New chat` from matching a row that merely
 * mentions it.
 */
const rowByLabel = (probe, label) =>
	probe.rows.find((row) => row.label.startsWith(label)) ??
	probe.rows.find((row) => row.label.includes(label)) ??
	null;

const pressRow = async (label) => {
	const probe = await evaluate(PROBE);
	const row = rowByLabel(probe, label);
	if (row === null) throw new Error(`no row labelled ${label}`);
	const [x, y] = centre(row.rect);
	await mouse("mouseMoved", x, y);
	await wait(120);
	await mouse("mousePressed", x, y);
	await mouse("mouseReleased", x, y);
	await wait(600);
	await mouse("mouseMoved", 4, 4);
	await wait(250);
};

/** The rect of the sidebar button whose ACCESSIBLE name is `label`. */
const rectFor = async (label) =>
	await evaluate(`(() => {
	  const el = [...document.querySelectorAll('nav[aria-label="Chats"] button')]
	    .find((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)});
	  if (!el) return null;
	  const r = el.getBoundingClientRect();
	  return { x: r.x, y: r.y, width: r.width, height: r.height };
	})()`);

/**
 * Press a control by its rect, then take the pointer OFF it. The move-away is
 * load-bearing: the press leaves the pointer where it pressed, so a frame
 * captured straight afterwards would be a frame of a HOVERED row claiming to be
 * the row at rest — which is the distinction this whole set is about.
 */
const pressRect = async (rect) => {
	const [x, y] = centre(rect);
	await mouse("mouseMoved", x, y);
	await wait(120);
	await mouse("mousePressed", x, y);
	await mouse("mouseReleased", x, y);
	await wait(600);
	await mouse("mouseMoved", 4, 4);
	await wait(250);
};

/** The marked row's whole text, which is where the trailing statement lives. */
const markedRowText = async () =>
	await evaluate(`(() => {
	  const row = document.querySelector('[data-chat-row][aria-current="page"]');
	  return row === null ? null : (row.innerText || '').replace(/\\s+/g, ' ').trim();
	})()`);

/*
 * below stage anything, because staging a draft is what moves the current-row
 * mark off the session row — the injected ground would then land on the wrong
 * row and the frame would be of a state this set does not claim.
 *
 * The alternative is the accent language the two navigation rails use for their
 * current row, made a real step on this panel: a tint of `accent` into
 * `surface` at the SAME perceptual strength the shipped ground has in this
 * theme, so the pair is judged on which reads as a selected row rather than on
 * which happens to be louder. The hex is derived from the palette source here
 * rather than invented, and injected as an inline background on the selected row
 * only.
 */
let tint = null;
if (process.env.COMPARISON === "1") {
	const palette = loadPalettes().find((entry) => entry.id === THEME)?.palette;
	const blend = (from, to, t) => {
		const channels = (value) =>
			[1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
		const [r1, g1, b1] = channels(from);
		const [r2, g2, b2] = channels(to);
		return `#${[r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]
			.map((c) =>
				Math.round(Math.max(0, Math.min(255, c)))
					.toString(16)
					.padStart(2, "0"),
			)
			.join("")}`;
	};
	const target = deltaE(palette.sunken, palette.surface);
	for (let t = 0.005; t <= 1.0001; t += 0.005) {
		const candidate = blend(palette.surface, palette.accent, t);
		if (deltaE(candidate, palette.surface) >= target) {
			tint = {
				hex: candidate,
				t: Number(t.toFixed(3)),
				deltaE: r2(deltaE(candidate, palette.surface)),
				shippedDeltaE: r2(target),
			};
			break;
		}
	}
	if (tint === null)
		throw new Error(`no accent tint reaches the shipped step in ${THEME}`);
	await evaluate(`(() => {
	  const rows = [...document.querySelectorAll('[data-chat-row]')];
	  const current = rows.find((r) => r.getAttribute('aria-current') === 'page');
	  current.style.backgroundColor = ${JSON.stringify(tint.hex)};
	})()`);
	await wait(300);
	await record("comparison-accent-tint", await capture("comparison-accent-tint"));
	await evaluate(`(() => {
	  const rows = [...document.querySelectorAll('[data-chat-row]')];
	  const current = rows.find((r) => r.getAttribute('aria-current') === 'page');
	  current.style.backgroundColor = '';
	})()`);
	await wait(200);
}

await pressRow("All chats");
const allChats = await record("all-chats", await capture(`${PREFIX}-all-chats`));
await pressRow("All chats");

await pressRow("New chat");
const newChat = await record("new-chat", await capture(`${PREFIX}-new-chat`));

/*
 * THE AGENT-BOUND CONVERSATION, and the two states it is the only source of:
 * a marked row whose trailing statement (`· architect`) and title truncation are
 * on the NEW ground, and the `pl-7` NESTED row under its entity — the one place a
 * child row's ground is on screen, and a state round 1's design pass could not
 * judge because the store had no bound session in it.
 */
await pressRow("Architect handoff");
const bound = await record("selected-bound", await capture(`${PREFIX}-selected-bound`));
const boundText = await markedRowText();

const disclosure = await rectFor("Expand architect chats");
if (disclosure === null)
	throw new Error("no `architect` entity row with a disclosure to expand");
await pressRect(disclosure);
const nested = await record("nested-current", await capture(`${PREFIX}-nested-current`));

/*
 * THE ENTITY ROW STAGING A TARGETED DRAFT — at rest, then under the pointer.
 * This is round 1's MAJOR photographed: the ground is on the wrapper and the
 * hover step on the name button inside it, so the second frame is the one that
 * says whether the pointer is painting over the mark.
 */
const entityName = await rectFor("New chat with architect");
if (entityName === null)
	throw new Error("no `architect` entity row to stage a draft from");
await pressRect(entityName);
const entityDraft = await evaluate(ENTITY_PROBE("architect"));
await record("entity-draft", await capture(`${PREFIX}-entity-draft`));
await mouse(
	"mouseMoved",
	entityName.x + entityName.width / 2,
	entityName.y + entityName.height / 2,
);
await wait(400);
const entityDraftHover = await evaluate(ENTITY_PROBE("architect"));
await record("entity-draft-hover", await capture(`${PREFIX}-entity-draft-hover`));
await mouse("mouseMoved", 4, 4);
await wait(250);

/*
 * THE SETTINGS RAIL (design round 1, D2): the same `surface` pairing on a second
 * panel, reached by hash because the route is the state. It waits for the rail's
 * own `aria-current` rather than the chat sidebar's, which is not on this screen
 * at all.
 */
await evaluate(`location.hash = "#/settings"`);
let rail = null;
for (let i = 0; i < 60; i += 1) {
	await wait(250);
	rail = await tryEval(RAIL_PROBE);
	if (rail?.active) break;
}
if (!rail?.active) {
	/*
	 * Say WHAT was on screen instead of only that the row was missing. The first
	 * version of this block reported "no current section in the settings rail"
	 * for a rail that had rendered with a different accessible name, and the next
	 * run had to be spent finding that out.
	 */
	const seen = await tryEval(`(() => ({
	  hash: location.hash,
	  navs: [...document.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label')),
	  active: [...document.querySelectorAll('[aria-current]')].map((el) => el.getAttribute('aria-current') + ':' + (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 24)),
	  text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
	}))()`);
	throw new Error(
		`no current section in the settings rail: ${JSON.stringify(seen)}`,
	);
}
/*
 * The state's NAME comes from the layout the PAGE reports, not from the size the
 * caller asked for: `(min-width: 1040px)` is the query the rail itself reads to
 * decide between labelled rows and icon-only ones, and a frame that filed itself
 * as labelled while the page drew icons would be a picture arguing for the wrong
 * state. Below that step the rail is a 48px column where the ground is the ONLY
 * signal the current row carries (round 2, design D6).
 */
const railLayout = await evaluate(
	`matchMedia("(min-width: 1040px)").matches ? "labelled" : "collapsed"`,
);
const railState =
	railLayout === "labelled" ? "settings-rail" : "settings-rail-collapsed";
await record(railState, await capture(`${PREFIX}-${railState}`));

/*
 * A second theme in the SAME boot when asked for, because the theme is one driver
 * call and this rail is the state the twelve-palette table's second-weakest step
 * belongs to (localOperatorLight, ΔE00 4.40 — round 2, design D5).
 */
const secondTheme = process.env.SIDEBAR_RAIL_SECOND_THEME;
/** The second theme's own rail reading, so its frame has numbers from its page. */
let railSecond = null;
if (secondTheme) {
	const themed = await evaluate(
		`window.__loDevDriver.call("setTheme", ${JSON.stringify(secondTheme)})`,
	);
	if (themed.dataTheme !== secondTheme)
		throw new Error(
			`asked for ${secondTheme}, the document reports ${themed.dataTheme}`,
		);
	await wait(600);
	let again = null;
	for (let i = 0; i < 40; i += 1) {
		await wait(250);
		again = await tryEval(RAIL_PROBE);
		if (again?.active) break;
	}
	if (!again?.active)
		throw new Error(
			`no current section in the settings rail after switching to ${secondTheme}`,
		);
	railSecond = await tryEval(RAIL_PROBE);
	await record(
		`${railState}-${secondTheme}`,
		/*
		 * The driver's frame label accepts lowercase letters, digits, dash and
		 * underscore only, so the theme goes in slugged and the README states which
		 * palette each file is; a rejected label costs a whole pass (it did, once).
		 */
		await capture(`${PREFIX}-${railState}-${secondTheme.toLowerCase()}`),
	);
}

const panelGround = hex(selectedProbe.panel.background);
/*
 * The rows directly above and below the selected one: unselected session rows
 * on the same panel, which is what "the current row is distinguishable FROM its
 * neighbours" is a claim about. They paint nothing (`background: null`), so the
 * eye sees the panel ground there — the reading says both, so neither can be
 * mistaken for a measurement of a colour that is not on screen.
 */
const neighbour = (offset) => {
	const row = selectedProbe.rows[selectedProbe.currentIndex + offset];
	if (row === undefined) return null;
	const background = hex(row.background);
	return {
		label: row.label,
		background: background ?? "none (the panel ground)",
		deltaE: r2(deltaE(background ?? panelGround, panelGround)),
	};
};
const allChatsRow = rowByLabel(allChats, "All chats");
/*
 * The four marks PRETTY-MUCH side by side, because they are the same role and a
 * reader is entitled to the geometry rather than the impression. `All chats`
 * paints 8px wider than the list rows: it clears the scroll gutter the list
 * reserves, and it is the implementer's call to leave that. The entity row's
 * ground is inset 4px because the agents list's own container carries `p-1`,
 * which is geometry this change did not create and did not touch.
 */
const box = (rect) =>
	rect
		? {
				x: r2(rect.x),
				width: r2(rect.width),
				right: r2(rect.x + rect.width),
			}
		: null;
const sibling = siblingHover.rows[selectedProbe.currentIndex - 1] ?? null;
/*
 * One entity row's grounds. `null` is a READING, not a failure: a row that
 * paints nothing reports a transparent computed background and the eye sees the
 * panel there — which on the before tree is what the name button does at rest,
 * because the ground was on the wrapper alone. `deltaE` is therefore computed
 * only when both colours exist rather than fed a null.
 */
const entitySide = (probe) => {
	if (probe === null) return null;
	const panel = hex(probe.panel.background);
	const wrapper = hex(probe.wrapper.background);
	const name = hex(probe.name.background);
	return {
		panel,
		wrapper,
		name,
		disclosure: hex(probe.disclosure.background),
		classes: probe.name.classes,
		deltaE: name === null || panel === null ? null : r2(deltaE(name, panel)),
	};
};
const report = {
	prefix: PREFIX,
	theme: THEME,
	session: SESSION,
	viewport: selectedProbe.viewport,
	panelGround,
	selected: {
		label: selectedProbe.current.label,
		index: selectedProbe.currentIndex,
		of: selectedProbe.rowCount,
		background: hex(selectedProbe.current.background),
		deltaE: r2(deltaE(hex(selectedProbe.current.background), panelGround)),
		ariaCurrent: selectedProbe.current.ariaCurrent,
		classes: selectedProbe.current.classes,
	},
	hoveredSelected: {
		background: hex(hovered.current.background),
		deltaEFromPanel: r2(deltaE(hex(hovered.current.background), panelGround)),
		deltaEFromSelected: r2(
			deltaE(hex(hovered.current.background), hex(selectedProbe.current.background)),
		),
		classes: hovered.current.classes,
	},
	neighbourAbove: neighbour(-1),
	neighbourBelow: neighbour(1),
	restRow: (() => {
		const row = selectedProbe.rows.find(
			(entry) =>
				entry !== selectedProbe.current &&
				entry.label !== "" &&
				!entry.label.startsWith("All chats") &&
				!entry.label.startsWith("New chat") &&
				hex(entry.background) === null,
		);
		return row === undefined
			? null
			: { label: row.label, background: "none (the panel ground)", deltaE: 0 };
	})(),
	allChats: {
		row: allChatsRow?.label ?? null,
		background: allChatsRow === undefined ? null : hex(allChatsRow.background),
		ariaPressed: allChatsRow?.ariaPressed ?? null,
		ariaCurrent: allChatsRow?.ariaCurrent ?? null,
	},
	newChat: {
		row: newChat.current?.label ?? null,
		background: newChat.current ? hex(newChat.current.background) : null,
		ariaCurrent: newChat.current?.ariaCurrent ?? null,
	},
	siblingHover: {
		label: sibling?.label ?? null,
		background: sibling ? hex(sibling.background) : null,
		deltaEFromPanel: sibling ? r2(deltaE(hex(sibling.background), panelGround)) : null,
		deltaEFromSelected: sibling
			? r2(deltaE(hex(sibling.background), hex(selectedProbe.current.background)))
			: null,
	},
	bound: {
		text: boundText,
		background: bound.current ? hex(bound.current.background) : null,
		deltaE: bound.current
			? r2(deltaE(hex(bound.current.background), panelGround))
			: null,
		classes: bound.current?.classes ?? null,
	},
	nested: {
		label: nested.current?.label ?? null,
		background: nested.current ? hex(nested.current.background) : null,
		deltaE: nested.current
			? r2(deltaE(hex(nested.current.background), panelGround))
			: null,
		classes: nested.current?.classes ?? null,
	},
	entityDraft: entitySide(entityDraft),
	entityDraftHover: entitySide(entityDraftHover),
	settingsRailSecond:
		railSecond === null
			? null
			: {
					theme: secondTheme ?? null,
					rail: hex(railSecond.rail.background),
					active: hex(railSecond.active.background),
					label: railSecond.active.label,
					deltaE: r2(
						deltaE(hex(railSecond.active.background), hex(railSecond.rail.background)),
					),
				},
	settingsRail: {
		rail: rail.rail ? hex(rail.rail.background) : null,
		active: rail.active ? hex(rail.active.background) : null,
		label: rail.active?.label ?? null,
		color: rail.active?.color ?? null,
		deltaE: rail.active
			? r2(deltaE(hex(rail.active.background), hex(rail.rail.background)))
			: null,
	},
	boxes: {
		selectedRow: box(selectedProbe.current.rect),
		newChatRow: newChat.current ? box(newChat.current.rect) : null,
		allChatsRow: allChatsRow ? box(allChatsRow.rect) : null,
		entityRow: entityDraft ? box(entityDraft.wrapper.rect) : null,
	},
	comparison: tint ? { ...tint, injectedOn: "the selected session row" } : null,
	states: readings.map((entry) => ({
		frame: entry.frame,
		current: entry.board.current,
		currentBackground: entry.board.currentBackground,
		panelBackground: entry.board.panelBackground,
	})),
};

writeFileSync(
	join(OUT, `readings-${PREFIX}-${THEME}.json`),
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log(`DRIVE ${JSON.stringify(report)}`);
process.exit(0);
