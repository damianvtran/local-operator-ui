#!/usr/bin/env node
/*
 * QA measurement harness for PR #1259's Library preview evidence.
 *
 * This is the run behind the "Measurements" table in the set's README: one
 * private headless Chrome for the whole run (the repository's `chrome-keychain`
 * switch applied, so it never reaches Keychain Services under a scratch
 * profile), each case navigating the real Storybook story, waiting for the hook
 * it is about, driving the gesture through CDP input (real pointer and key
 * events), and printing the values the browser resolved. The process group is
 * reaped by exact pid at the end.
 *
 * It is a RIG, not a test: the committed frames are the evidence and the
 * capture tuples' claims are what a sweep can fail on. This script exists so a
 * reviewer can re-read the computed values the design round is asked to judge.
 *
 *     pnpm exec storybook dev -p 6017 --ci --no-open
 *     node docs/evidence/library-tab/harness/measure-claims.mjs http://localhost:6017
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ORIGIN = process.argv[2] ?? "http://localhost:6017";
const profile = mkdtempSync(join(tmpdir(), "lo-qa-claims-"));
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${profile}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
	{ env: { ...process.env, TZ: "America/New_York" }, detached: true },
);
/*
 * REAP ON EVERY EXIT, not only on the happy path. An assertion that throws
 * used to leave this rig's Chrome running for hours (measured on the first
 * run: a missing description hook threw before the teardown block and left a
 * `lo-qa-claims-*` profile alive). The handlers are synchronous because
 * `exit` cannot await.
 */
const reap = () => {
	try {
		chrome.kill("SIGKILL");
	} catch {}
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {}
	try {
		rmSync(profile, { recursive: true, force: true });
	} catch {}
};
process.on("exit", reap);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		reap();
		process.exit(130);
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wsUrl = await new Promise((resolve, reject) => {
	let buf = "";
	const t = setTimeout(() => reject(new Error("no debug port")), 30000);
	chrome.stderr.on("data", (d) => {
		buf += d;
		const m = buf.match(/ws:\/\/[^\s]+/);
		if (m) {
			clearTimeout(t);
			resolve(m[0]);
		}
	});
});
const { host } = new URL(wsUrl);
const list = await fetch(`http://${host}/json`).then((r) => r.json());
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
	ws.addEventListener("open", res, { once: true });
	ws.addEventListener("error", rej, { once: true });
});
let next = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id && pending.has(msg.id)) {
		const { res, rej } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
	} else if (msg.method === "Runtime.consoleAPICalled") {
		const text = msg.params.args
			.map((a) => a.value ?? a.description ?? "")
			.join(" ");
		if (/(?:Uncaught )?\w*Error:|Unable to perform pointer interaction/.test(text))
			consoleErrors.push(text);
	}
});
const send = (method, params = {}) => {
	const id = ++next;
	ws.send(JSON.stringify({ id, method, params }));
	return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const evaluate = async (expression) => {
	const out = await send("Runtime.evaluate", { expression, returnByValue: true });
	if (out.exceptionDetails)
		throw new Error(
			`page expression threw: ${out.exceptionDetails.text} ${out.exceptionDetails.exception?.description ?? ""}`,
		);
	return out.result.value;
};
const until = async (expression, what, ms = 30000) => {
	const end = Date.now() + ms;
	let last;
	while (Date.now() < end) {
		last = await evaluate(expression);
		if (last) return last;
		await sleep(100);
	}
	throw new Error(`timed out waiting for ${what} (last=${JSON.stringify(last)})`);
};
const centre = async (selector) => {
	const box = await until(
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
		`the centre of ${selector}`,
	);
	return box;
};
const move = async (selector) => {
	const at = await centre(selector);
	await send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: at.x,
		y: at.y,
		button: "none",
		buttons: 0,
		clickCount: 0,
		modifiers: 0,
		pointerType: "mouse",
	});
	return at;
};
const click = async (selector) => {
	const at = await move(selector);
	await send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x: at.x,
		y: at.y,
		button: "left",
		buttons: 1,
		clickCount: 1,
		modifiers: 0,
		pointerType: "mouse",
	});
	await sleep(40);
	await send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: at.x,
		y: at.y,
		button: "left",
		buttons: 0,
		clickCount: 1,
		modifiers: 0,
		pointerType: "mouse",
	});
	await sleep(250);
};
const key = async (name, code, keyCode) => {
	for (const type of ["keyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type,
			key: name,
			code,
			windowsVirtualKeyCode: keyCode,
			nativeVirtualKeyCode: keyCode,
			modifiers: 0,
		});
	}
	await sleep(250);
};
const escape = () => key("Escape", "Escape", 27);
const arrowRight = () => key("ArrowRight", "ArrowRight", 39);

const open = async (id, theme = "localOperatorDark") => {
	await send("Emulation.setDeviceMetricsOverride", {
		width: 640,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${id}&viewMode=story&args=theme:${theme}`,
	});
	await sleep(1200);
};

const results = [];
const record = (name, data) => {
	results.push({ case: name, ...data });
	console.log(`\n== ${name} ==\n${JSON.stringify(data, null, 2)}`);
};

await send("Page.enable");
await send("Runtime.enable");

/* A. Rest: typography, gutter, no labels, pill tags. */
for (const theme of ["localOperatorDark", "localOperatorLight"]) {
	await open("library-tab--preview-inline-populated", theme);
	await until(
		`document.querySelector('[data-inline-edit="name"]') !== null`,
		"the name row",
	);
	const rest = await evaluate(`(() => {
		const row = document.querySelector('[data-inline-edit="name"]');
		const text = row.querySelector("span.truncate");
		const control = row.querySelector("[data-inline-edit-control]");
		const t = text.getBoundingClientRect();
		const c = control.getBoundingClientRect();
		const cs = getComputedStyle(text);
		const cc = getComputedStyle(control);
		const tags = document.querySelector("[data-inline-tags]");
		const chips = [...tags.querySelectorAll("span")].map((s) => s.textContent.trim()).filter(Boolean);
		return {
			theme: document.documentElement.dataset.theme,
			nameFontSize: cs.fontSize,
			nameFontWeight: cs.fontWeight,
			nameColor: cs.color,
			gutterWidth: Math.round(c.width),
			gutterOpacity: cc.opacity,
			gap: Math.round(c.left - t.right),
			textOverflow: cs.textOverflow,
			labels: [...row.closest("header").querySelectorAll("label")].map((l) => l.textContent.trim()),
			tagChipText: chips,
			tagRowBorder: getComputedStyle(tags).borderTopWidth,
			headerHeight: Math.round(row.closest("header").getBoundingClientRect().height),
		};
	})()`);
	record(`A rest ${theme}`, rest);
}

/* B. Hover: the pencil becomes painted, the geometry does not move. */
await open("library-tab--preview-inline-name-hover");
await until(`document.querySelector('[data-inline-edit="name"]') !== null`, "the name row");
const restGeometry = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const text = row.querySelector("span.truncate");
	const control = row.querySelector("[data-inline-edit-control]");
	const t = text.getBoundingClientRect(); const c = control.getBoundingClientRect();
	return { opacity: getComputedStyle(control).opacity, textRight: t.right, gutterLeft: c.left, width: c.width };
})()`);
await move('[data-inline-edit="name"]');
await until(`document.querySelector('[data-inline-edit="name"]')?.matches(":hover") === true`, "the row to match :hover");
await sleep(500);
const hovered = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const text = row.querySelector("span.truncate");
	const control = row.querySelector("[data-inline-edit-control]");
	const t = text.getBoundingClientRect(); const c = control.getBoundingClientRect();
	return { opacity: getComputedStyle(control).opacity, textRight: t.right, gutterLeft: c.left, width: c.width, gap: c.left - t.right };
})()`);
record("B hover name row", { rest: restGeometry, hovered });

/* C. Long name at rest, on hover and while editing. */
await open("library-tab--preview-inline-long-name");
await until(`document.querySelector('[data-inline-edit="name"]') !== null`, "the long-name row");
const longRest = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const text = row.querySelector("span.truncate");
	const control = row.querySelector("[data-inline-edit-control]");
	const t = text.getBoundingClientRect(); const c = control.getBoundingClientRect();
	return {
		value: text.textContent,
		clientWidth: text.clientWidth, scrollWidth: text.scrollWidth,
		textOverflow: getComputedStyle(text).textOverflow,
		textRight: t.right, gutterLeft: c.left, gap: Math.round(c.left - t.right),
		gutterWidth: Math.round(c.width), opacity: getComputedStyle(control).opacity,
	};
})()`);
record("C1 long name rest", longRest);
await move('[data-inline-edit="name"]');
await until(`document.querySelector('[data-inline-edit="name"]')?.matches(":hover") === true`, ":hover");
await sleep(500);
const longHover = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const text = row.querySelector("span.truncate");
	const control = row.querySelector("[data-inline-edit-control]");
	const t = text.getBoundingClientRect(); const c = control.getBoundingClientRect();
	return { textOverflow: getComputedStyle(text).textOverflow, clientWidth: text.clientWidth, scrollWidth: text.scrollWidth, textRight: t.right, gutterLeft: c.left, gap: Math.round(c.left - t.right), gutterWidth: Math.round(c.width), opacity: getComputedStyle(control).opacity };
})()`);
record("C2 long name hover", longHover);
await click('[data-inline-edit="name"] [data-inline-edit-control]');
await until(`document.querySelector('[data-inline-edit="name"] [data-inline-edit-input]') !== null`, "the long-name editor");
const longEdit = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const input = row.querySelector("[data-inline-edit-input]");
	const control = row.querySelector("[data-inline-edit-control]");
	const i = input.getBoundingClientRect(); const c = control.getBoundingClientRect();
	const cs = getComputedStyle(input);
	return {
		valueLength: input.value.length,
		value: input.value,
		selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
		inputClientWidth: input.clientWidth, inputScrollWidth: input.scrollWidth, inputScrollLeft: input.scrollLeft,
		inputTextOverflow: cs.textOverflow,
		inputRight: i.right, gutterLeft: c.left, gap: Math.round(c.left - i.right),
		gutterWidth: Math.round(c.width), controlOpacity: getComputedStyle(control).opacity,
		controlLabel: control.getAttribute("aria-label"),
		rowWidth: Math.round(row.getBoundingClientRect().width),
	};
})()`);
record("C3 long name editing", longEdit);
await escape();
await until(`document.querySelector('[data-inline-edit="name"] [data-inline-edit-input]') === null`, "the editor to close");
const afterEscapeLong = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const text = row.querySelector("span.truncate");
	return { text: text.textContent, controlLabel: row.querySelector("[data-inline-edit-control]").getAttribute("aria-label"), opacity: getComputedStyle(row.querySelector("[data-inline-edit-control]")).opacity };
})()`);
record("C4 long name after Escape", afterEscapeLong);
/* D. The short name editor: opens focused and selected, borderless. */
await open("library-tab--preview-inline-name-editing");
await until(`document.querySelector('[data-inline-edit="name"] [data-inline-edit-input]') !== null`, "the name editor");
const nameEdit = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	const input = row.querySelector("[data-inline-edit-input]");
	const control = row.querySelector("[data-inline-edit-control]");
	const cs = getComputedStyle(input);
	return {
		value: input.value,
		focused: document.activeElement === input,
		selectionStart: input.selectionStart,
		selectionEnd: input.selectionEnd,
		borderTopWidth: cs.borderTopWidth,
		background: cs.backgroundColor,
		controlLabel: control.getAttribute("aria-label"),
		controlOpacity: getComputedStyle(control).opacity,
		controlGlyph: control.querySelector("svg")?.getAttribute("class"),
	};
})()`);
record("D name editing", nameEdit);
await send("Input.insertText", { text: "changed" });
await escape();
await until(`document.querySelector('[data-inline-edit="name"] [data-inline-edit-input]') === null`, "the editor to close after Escape");
const nameEscaped = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="name"]');
	return {
		text: row.querySelector("span.truncate")?.textContent,
		controlLabel: row.querySelector("[data-inline-edit-control]")?.getAttribute("aria-label"),
	};
})()`);
record("D name after Escape", nameEscaped);

/* E. Description editing: multiline, borderless. */
await open("library-tab--preview-inline-description-editing");
await until(`document.querySelector('[data-inline-edit="description"] [data-inline-edit-input]') !== null`, "the description editor");
const descriptionEdit = await evaluate(`(() => {
	const row = document.querySelector('[data-inline-edit="description"]');
	const input = row.querySelector("[data-inline-edit-input]");
	const control = row.querySelector("[data-inline-edit-control]");
	const cs = getComputedStyle(input);
	return {
		tagName: input.tagName,
		value: input.value,
		focused: document.activeElement === input,
		borderTopWidth: cs.borderTopWidth,
		background: cs.backgroundColor,
		controlLabel: control.getAttribute("aria-label"),
	};
})()`);
record("E description editing", descriptionEdit);

/* F. The empty tag row: the add control is the state. */
await open("library-tab--preview-inline-empty-tags");
await until(`document.querySelector("[data-inline-tags]") !== null`, "the tag row");
const emptyTags = await evaluate(`(() => {
	const row = document.querySelector("[data-inline-tags]");
	const buttons = [...row.querySelectorAll("button")].map((b) => ({ text: b.textContent.trim(), label: b.getAttribute("aria-label") }));
	const input = row.querySelector("input");
	const cs = getComputedStyle(row);
	return {
		text: row.innerText.trim(),
		buttons,
		hasInput: Boolean(input),
		inputPlaceholder: input?.getAttribute("placeholder") ?? null,
		borderTopWidth: cs.borderTopWidth,
		borderBottomWidth: cs.borderBottomWidth,
		background: cs.backgroundColor,
		height: Math.round(row.getBoundingClientRect().height),
	};
})()`);
record("F empty tags", emptyTags);

/* G. The lightbox: open, arrows, strip, route, close, focus. */
await open("library-tab--media-lightbox-solo");
const soloPath = await evaluate("location.pathname");
await until(`document.querySelector('[data-library-media-trigger="image"]') !== null`, "the picture trigger");
await click('[data-library-media-trigger="image"]');
await until(`document.querySelector("[data-library-lightbox]") !== null`, "the solo lightbox");
const solo = await evaluate(`({
	overlay: Boolean(document.querySelector("[data-library-lightbox]")),
	strip: Boolean(document.querySelector("[data-library-lightbox-strip]")),
	prev: Boolean(document.querySelector("[data-image-viewer-prev]")),
	next: Boolean(document.querySelector("[data-image-viewer-next]")),
	close: Boolean(document.querySelector('[aria-label="Close asset"]')),
	path: location.pathname,
	label: document.querySelector("[data-library-lightbox]")?.getAttribute("aria-label") ?? null,
	role: document.querySelector("[data-library-lightbox]")?.getAttribute("role") ?? null,
	title: document.querySelector("[data-library-lightbox]")?.querySelector("h2")?.textContent ?? null,
})`);
record("G1 solo lightbox open", { before: soloPath, ...solo });
await click('[aria-label="Close asset"]');
await until(`document.querySelector("[data-library-lightbox]") === null`, "the solo lightbox to close");
const soloClosed = await evaluate(`({
	overlay: Boolean(document.querySelector("[data-library-lightbox]")),
	path: location.pathname,
	focusTag: document.activeElement?.tagName ?? null,
	focusIsTrigger: document.activeElement === document.querySelector('[data-library-media-trigger="image"]'),
})`);
record("G2 solo lightbox after X", soloClosed);

await open("library-tab--media-lightbox");
const selectionBefore = await until(
	`document.querySelector("[data-library-preview]")?.getAttribute("data-library-preview") ?? null`,
	"the preview's selected asset",
);
await until(
	`document.querySelector('[data-library-lightbox-strip] [aria-current="true"]')?.getAttribute("data-library-lightbox-tile") === "la_0000000000000053"`,
	"the story's play to settle on its third slide",
);
await sleep(300);
const tile = () => evaluate(`document.querySelector('[data-library-lightbox-strip] [aria-current="true"]')?.getAttribute("data-library-lightbox-tile") ?? null`);
const selection = () => evaluate(`document.querySelector("[data-library-preview]")?.getAttribute("data-library-preview") ?? null`);
const beforeTiles = await tile();
await click("[data-image-viewer-next]");
await sleep(250);
const afterNext = await tile();
const selectionAfterNext = await selection();
await click("[data-image-viewer-prev]");
await sleep(250);
const afterPrev = await tile();
const second = await evaluate(`document.querySelectorAll("[data-library-lightbox-tile]")[1]?.getAttribute("data-library-lightbox-tile") ?? null`);
await click(`[data-library-lightbox-tile="${second}"]`);
await sleep(400);
const afterStrip = await tile();
const selectionAfterStrip = await selection();
const group = await evaluate(`({
	stripTiles: document.querySelectorAll("[data-library-lightbox-tile]").length,
	path: location.pathname,
	current: document.querySelector('[data-library-lightbox-strip] [aria-current="true"]')?.getAttribute("data-library-lightbox-tile"),
	img: document.querySelector("[data-library-lightbox] img")?.getAttribute("src")?.slice(0, 30),
})`);
await click('[aria-label="Close asset"]');
await until(`document.querySelector("[data-library-lightbox]") === null`, "the lightbox to close");
const afterClose = await evaluate(`({
	overlay: Boolean(document.querySelector("[data-library-lightbox]")),
	path: location.pathname,
	focusIsTrigger: document.activeElement === document.querySelector('[data-library-media-trigger="image"]'),
})`);
record("G3 group lightbox", {
	selectionBefore,
	selectionAfterNext,
	selectionAfterStrip,
	slideOnOpen: beforeTiles,
	afterNext,
	afterPrev,
	afterStrip,
	...group,
	afterClose,
});

await open("library-tab--media-lightbox-dismiss");
await until(`document.querySelector('[data-library-media-trigger="image"]') !== null`, "the dismiss story's preview");
await sleep(500);
const dismissPlay = await evaluate(`({
	overlay: Boolean(document.querySelector("[data-library-lightbox]")),
	path: location.pathname,
	focusIsTrigger: document.activeElement === document.querySelector('[data-library-media-trigger="image"]'),
})`);
record("G4 dismiss (play's Escape)", dismissPlay);

await open("library-tab--media-lightbox-video");
await until(`document.querySelector("[data-library-lightbox] [data-lightbox-video]") !== null`, "the video lightbox");
const video = await evaluate(`(() => {
	const v = document.querySelector("[data-library-lightbox] [data-lightbox-video]");
	return {
		tag: v.tagName,
		src: (v.currentSrc || v.src || "").slice(0, 40),
		duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
		readyState: v.readyState,
		strip: Boolean(document.querySelector("[data-library-lightbox-strip]")),
		path: location.pathname,
	};
})()`);
record("G5 video lightbox", video);
await click('[aria-label="Close asset"]');
await until(`document.querySelector("[data-library-lightbox]") === null`, "the video lightbox to close");
const videoClosed = await evaluate(`({
	overlay: Boolean(document.querySelector("[data-library-lightbox]")),
	focusIsTrigger: document.activeElement === document.querySelector('[data-library-media-trigger="video"]'),
})`);
record("G6 video lightbox after X", videoClosed);

if (consoleErrors.length) console.log("PLAY ERRORS:", consoleErrors.join("\n"));
try {
	chrome.kill("SIGKILL");
} catch {}
try {
	process.kill(-chrome.pid, "SIGKILL");
} catch {}
rmSync(profile, { recursive: true, force: true });
