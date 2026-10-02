#!/usr/bin/env node
/**
 * THE GEOMETRY BEHIND THE `cap/` FRAMES (issue #765) — the numbers a still
 * cannot carry.
 *
 * WHY THIS EXISTS. The frames in `../` show the SYMPTOM; what a design review
 * has to state is the CAUSE, and the cause here is a row count. A screenshot
 * can be read as "the list looks long"; it cannot be read as "twelve rows are
 * drawn where the shipped cap draws eight, and the one boundary every later
 * element shares moved by exactly four 28px rows and not by a pixel more". The
 * row count and that boundary are what this harness reads, out of the live DOM
 * of the same story the frames are taken from.
 *
 * IT TAKES NO FRAME AND IT IS NOT A SECOND CAPTURE RIG. It reads
 * `getBoundingClientRect()` and `querySelectorAll().length` from the story the
 * capture sweep already serves, prints them as JSON, and exits; the frames
 * remain the capturer's alone. It drives its presses with `el.click()` rather
 * than through the CDP input pipeline ON PURPOSE - a real pointer is what the
 * capturer exists to prove, and this instrument is measuring geometry, where a
 * trusted click on a real `<button>` reaches the same React handler.
 *
 * HOW TO RUN IT. Serve a Storybook build of the tree under test, then:
 *
 *     node docs/evidence/chat-sidebar-agents/cap/harness/measure.mjs \
 *       http://127.0.0.1:<port> > cap-geometry.json
 *
 * It launches the SAME private headless Chrome the capturer launches (a scratch
 * `--user-data-dir` under the system temp dir, `--use-mock-keychain` applied
 * through `scripts/chrome-keychain.mjs`), reaps it by exact pid before it
 * returns, and leaves nothing running. A leaked profile is not possible: the
 * directory is named for this process and removed in the `finally` block.
 *
 * WHAT IT CANNOT SEE. It measures the ENTITIES region on the agents story and
 * nothing else, and it is a rendering of the story's fixture: the roster is the
 * story's twelve agents, not the reader's catalogue.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "../../../../../scripts/chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT_LINE = /ws:\/\/[^\s]*\/devtools\/browser\/[^\s]+/;
const ORIGIN = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!ORIGIN) {
	console.error("usage: measure.mjs http://127.0.0.1:<port>");
	process.exit(2);
}
const STORY =
	"/iframe.html?id=chat-sidebar-agents--long-roster&viewMode=story";

/** A minimal CDP client: `send(method, params)` against one page target. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const msg = JSON.parse(event.data);
			if (msg.id === undefined) return;
			const slot = this.pending.get(msg.id);
			if (!slot) return;
			this.pending.delete(msg.id);
			if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
			else slot.resolve(msg);
		});
	}
	send(method, params = {}) {
		const id = ++this.id;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}
	async evaluate(expression) {
		const { result } = await this.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails) {
			throw new Error(
				`page threw: ${result.exceptionDetails.exception?.description ?? "?"}`,
			);
		}
		return result.result.value;
	}
}

/**
 * THE READ, and it is deliberately one expression so every number in a state
 * comes from the same frame of the same document.
 *
 * `rows` counts the agents section's OWN row buttons (`[data-entity-name]`
 * inside the `<section>` that carries `data-chat-section="agents"`), which is
 * the number the cap decides. `teamsTop` / `chatsTop` are the two boundaries
 * BELOW the rows that any growth has to move, and `scroller` is the one
 * scroll box the whole panel is, so a grown section whose rows do not move the
 * boundaries would be an overlap rather than a growth.
 */
const READ = `(() => {
	const section = document.querySelector('[data-chat-section="agents"]')?.closest('section') ?? null;
	const foot = document.querySelector('[data-sidebar-section-more="agents"]');
	const rowNodes = section ? [...section.querySelectorAll('[data-entity-name]')] : [];
	const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
	const scroller = document.querySelector('[data-sidebar-region="scroller"]');
	const chats = document.querySelector('[data-sidebar-region="chats"]');
	const firstChat = document.querySelector('[data-sidebar-region="chats"] [data-tour-tag="chat-session-row"]');
	return {
		rows: rowNodes.length,
		rowNames: rowNodes.map((n) => (n.querySelector('span.truncate')?.textContent ?? '').trim()),
		lastRowBox: box(rowNodes[rowNodes.length - 1] ?? null),
		section: box(section),
		foot: foot ? { label: foot.textContent.trim(), bottom: box(foot).bottom } : null,
		teamsTop: box(document.querySelector('[data-chat-section="teams"]'))?.top ?? null,
		chatsTop: box(chats)?.top ?? null,
		firstChatTop: box(firstChat)?.top ?? null,
		scroller: scroller ? { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight } : null,
		headingExpanded: document.querySelector('[data-chat-section="agents"]')?.getAttribute('aria-expanded') ?? null,
		documentHeight: document.documentElement.getBoundingClientRect().height,
		/*
		 * WHERE THE KEYBOARD WENT AFTER THE PRESS. The section's own show-more foot
		 * UNMOUNTS when the cap it raised stops bounding the list, and a control that
		 * unmounts under the reader's focus returns them to the body unless something
		 * claims the focus first - the defect family the chats list's own tail press
		 * fixed (pressShowMore, round 1 U2). Whether this surface has the same hole is
		 * a question about the DOM, so it is read here rather than reasoned about: a
		 * BODY answer is the one that means nothing claimed it.
		 */
		active: (() => {
			const a = document.activeElement;
			if (!a) return null;
			return {
				tag: a.tagName,
				name: a.getAttribute?.('aria-label') ?? null,
				sectionKey: a.getAttribute?.('data-chat-section') ?? null,
				moreKey: a.getAttribute?.('data-sidebar-section-more') ?? null,
				entityName: a.hasAttribute?.('data-entity-name') ?? false,
			};
		})(),
	};
})()`;

const PRESS = (selector) => `(() => {
	const el = document.querySelector(${JSON.stringify(selector)});
	if (!el) return { pressed: false, reason: 'selector matched nothing' };
	/* Focus FIRST, then activate: this is the keyboard reader's press (Enter on a
	 * focused control), which is the case the focus question is about. A bare
	 * el.click() moves no focus at all and would answer nothing. */
	el.focus();
	/* THE CONTROL FOR THIS INSTRUMENT: read back whether the focus actually landed
	 * before the activation. Without it a BODY reading after the press could be
	 * this harness never having focused anything, which would turn a real defect
	 * into a false one (or hide it). */
	const focused = document.activeElement === el;
	el.click();
	return { pressed: true, focused };
})()`;

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the story to be the state it claims, rather than for a fixed lag:
 * the play's own readiness is eight pins and `builder` leading, and this waits
 * for a stable entity row count on top of that.
 */
const waitSettled = async (cdp, timeoutMs = 90_000) => {
	const started = Date.now();
	let previous = null;
	let stable = 0;
	let last = null;
	while (Date.now() - started < timeoutMs) {
		const read = await cdp.evaluate(READ);
		last = read;
		if (read.rows > 0 && read.rows === previous) stable += 1;
		else stable = 0;
		previous = read.rows;
		if (stable >= 3) return read;
		await settle(120);
	}
	throw new Error(
		`the story never drew a stable entity section (last read: ${JSON.stringify(last)})`,
	);
};

const root = join(dirname(fileURLToPath(import.meta.url)));
const profile = join(tmpdir(), `lop-cap-geometry-${process.pid}`);
mkdirSync(profile, { recursive: true });
let chrome = null;
try {
	chrome = spawn(
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
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (data) => {
			buf += data.toString();
			const hit = buf.match(DEBUG_PORT_LINE);
			if (hit) {
				clearTimeout(timer);
				resolve(hit[0]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const targets = await fetch(`http://${host}/json`).then((r) => r.json());
	const page = targets.find((t) => t.type === "page");
	const ws = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	/*
	 * NAVIGATE, AND RETRY THE BOOT. The served Storybook occasionally comes up with
	 * an empty preview - measured on this host, roughly one attempt in three under
	 * fleet load, with the chunk fetches served from a busy disk - and an empty
	 * preview is indistinguishable from a story that drew nothing. A single
	 * navigation therefore fails the run on a fact about the host rather than about
	 * the tree, so the read is retried as a whole (three navigations, 25s each) and
	 * the LAST failure is the one reported.
	 */
	const out = { origin: ORIGIN, story: STORY, states: {} };
	let booted = false;
	let failure = null;
	for (let attempt = 0; attempt < 3 && !booted; attempt++) {
		await cdp.send("Page.navigate", { url: `${ORIGIN}${STORY}` });
		await settle(1500);
		try {
			out.states.resting = await waitSettled(cdp, 25_000);
			out.navigationAttempts = attempt + 1;
			booted = true;
		} catch (error) {
			failure = error;
		}
	}
	if (!booted) throw failure;


	/* The press the entry `cap/grown` makes, and read the state it lands in. */
	out.pressFoot = await cdp.evaluate(
		PRESS('[data-sidebar-section-more="agents"]'),
	);
	await settle(500);
	out.states.grown = await cdp.evaluate(READ);

	/* The pair of presses the entry `cap/reopened` makes: close, then open. */
	out.pressClose = await cdp.evaluate(
		PRESS('[data-sidebar-region="entities"] [data-chat-section="agents"]'),
	);
	await settle(500);
	out.states.collapsed = await cdp.evaluate(READ);
	out.pressOpen = await cdp.evaluate(
		PRESS('[data-sidebar-region="entities"] [data-chat-section="agents"]'),
	);
	await settle(500);
	out.states.reopened = await cdp.evaluate(READ);

	const { resting, grown, collapsed, reopened } = out.states;
	out.deltas = {
		"rows(grown) - rows(resting)": grown.rows - resting.rows,
		"rows(reopened) - rows(resting)": reopened.rows - resting.rows,
		"teamsTop(grown) - teamsTop(resting)": grown.teamsTop - resting.teamsTop,
		"teamsTop(reopened) - teamsTop(resting)":
			reopened.teamsTop - resting.teamsTop,
		"sectionHeight(grown) - sectionHeight(resting)":
			grown.section.height - resting.section.height,
		"sectionHeight(reopened) - sectionHeight(resting)":
			reopened.section.height - resting.section.height,
		"collapsed section height": collapsed.section?.height ?? null,
		"collapsed rows": collapsed.rows,
		"collapsed heading aria-expanded": collapsed.headingExpanded,
	};
	console.log(JSON.stringify(out, null, 1));
} finally {
	if (chrome?.pid) {
		try {
			process.kill(-chrome.pid, "SIGTERM");
		} catch {}
		try {
			chrome.kill("SIGKILL");
		} catch {}
	}
	/* Wait for the profile to be released before removing it, and never leave
	 * the directory behind: this machine's temp dir is shared with ~25 sessions. */
	await settle(500);
	if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
	/* Read back, so a leaked profile is a failure rather than a hope. */
	void readFileSync;
}
