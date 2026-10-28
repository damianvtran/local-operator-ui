import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE CARD DOCUMENT'S OWN RULES, driven through its real `main.ts`.
 *
 * WHAT THIS PROVES: that a decision cannot leave the document in a short window
 * after the request on screen changed under the user (U3), and that it works
 * again afterwards; that the primary and the scoped decisions are disabled for
 * the window and not for an ordinary first paint; that the two channels are the
 * only exits (the stub records every call); and that the Review-all / Back
 * controls hand keyboard focus on instead of dropping it to <body> (U11).
 *
 * WHAT IT CANNOT PROVE: layout. jsdom has no geometry, so the gloss reservation
 * (Q1) and every overdraw number are the native probe's rows
 * (`browser-approvals-s6b-probe.mjs`).
 */

const html = readFileSync(
	"src/renderer/browser-approvals-overlay.html",
	"utf8",
).replace(/<script[^>]*><\/script>/g, "");
const bundle = await build({
	entryPoints: ["src/renderer/src/approvals-overlay/main.ts"],
	bundle: true,
	format: "iife",
	platform: "browser",
	write: false,
	define: { "import.meta.env": "{}" },
	loader: { ".css": "empty" },
});
const code = bundle.outputFiles[0].text;

const open = [];
after(() => {
	for (const dom of open) dom.window.close();
});

const req = (id, extra = {}) => ({
	entryId: id,
	origin: `https://${id}.example`,
	requester: "An agent",
	expiresAt: Date.now() + 9 * 60_000,
	broadKey: null,
	...extra,
});
const modelOf = (seq, pending, extra = {}) => ({
	v: 1,
	seq,
	locale: "en",
	dir: "ltr",
	theme: "dark",
	palette: null,
	view: "request",
	focus: false,
	count: pending.length,
	busy: false,
	request: pending[0] ?? null,
	pending,
	error: null,
	...extra,
});

function mount() {
	const dom = new JSDOM(html, {
		runScripts: "outside-only",
		pretendToBeVisual: true,
		url: "file:///card/browser-approvals-overlay.html?theme=dark",
	});
	open.push(dom);
	const calls = [];
	dom.window.approvalsCard = {
		dismiss: (payload) => calls.push(["dismiss", { ...payload }]),
		decide: (payload) => calls.push(["decide", { ...payload }]),
	};
	dom.window.eval(code);
	const doc = dom.window.document;
	// Load the real stylesheet too: DOM hidden=true alone missed the authored
	// display:flex override. jsdom proves computed visibility, not native rects.
	const style = doc.createElement("style");
	style.textContent = readFileSync(
		"src/renderer/src/approvals-overlay/card.css",
		"utf8",
	);
	doc.head.appendChild(style);
	const push = (model) => dom.window.__approvalsCard.setModel(model);
	return { dom, doc, calls, push };
}
const click = (dom, node) =>
	node.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const decisionButtons = (doc) => [
	doc.getElementById("approvals-allow-once"),
	...doc.querySelectorAll("#approvals-secondary button"),
];

test("a first paint is answerable at once, and a click decides through the one channel", () => {
	const { dom, doc, calls, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	assert.ok(decisionButtons(doc).every((button) => !button.disabled));
	click(dom, doc.getElementById("approvals-allow-once"));
	assert.deepEqual(calls, [
		["decide", { seq: 1, entryId: "a", decision: "once" }],
	]);
});

test("U3: when the shown request is replaced under the user, decisions are inert, then live again", async () => {
	const { dom, doc, calls, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	// The agent withdraws `a`; main pushes `b` as the controller's request.
	push(modelOf(2, [req("b")]));
	assert.equal(
		doc.getElementById("approvals-origin").textContent,
		"https://b.example",
	);
	assert.ok(
		decisionButtons(doc).every((button) => button.disabled),
		"every decision is disabled right after the swap",
	);
	// A click that was already in flight toward the old request, on the primary
	// and on a scoped decision (programmatic clicks bypass `disabled`, as a late
	// pointer event can).
	click(dom, doc.getElementById("approvals-allow-once"));
	click(dom, doc.querySelectorAll("#approvals-secondary button")[1]);
	assert.deepEqual(calls, [], "nothing reached decide inside the window");
	await sleep(820);
	assert.ok(
		decisionButtons(doc).every((button) => !button.disabled),
		"the window ends by itself, with no new push",
	);
	click(dom, doc.getElementById("approvals-allow-once"));
	assert.deepEqual(calls, [
		["decide", { seq: 2, entryId: "b", decision: "once" }],
	]);
});

test("U3: choosing a row in Review all is the user's own selection and is not held inert", () => {
	const { dom, doc, calls, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	click(dom, doc.getElementById("approvals-review"));
	const rows = doc.querySelectorAll("#approvals-rows button");
	click(dom, rows[1]);
	assert.equal(
		doc.getElementById("approvals-origin").textContent,
		"https://b.example",
	);
	click(dom, doc.getElementById("approvals-allow-once"));
	assert.equal(calls.length, 1);
	assert.equal(calls[0][1].entryId, "b");
});

test("U3: a card that was hidden and returns is a first paint, not a swap", () => {
	const { doc, push } = mount();
	push(modelOf(1, [req("a")]));
	push(modelOf(2, [], { request: null, count: 0 }));
	push(modelOf(3, [req("c")]));
	assert.ok(decisionButtons(doc).every((button) => !button.disabled));
});

test("U11: Review all and Back hand keyboard focus on instead of dropping it to body", () => {
	const { dom, doc, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	const review = doc.getElementById("approvals-review");
	review.focus();
	click(dom, review);
	assert.equal(doc.activeElement?.id, "approvals-back");
	click(dom, doc.getElementById("approvals-back"));
	assert.equal(doc.activeElement?.id, "approvals-review");
});

test("only the two card verbs exist in the document's world", () => {
	const { dom } = mount();
	assert.deepEqual(Object.keys(dom.window.approvalsCard).sort(), [
		"decide",
		"dismiss",
	]);
});

test("D-2: a very long requester label is clipped in the headline and kept whole in the tooltip", () => {
	const { doc, push } = mount();
	const long = "x".repeat(98);
	push(modelOf(1, [req("a", { requester: long })]));
	const node = doc.getElementById("approvals-requester");
	assert.ok([...node.textContent].length <= 48, "the headline is bounded");
	assert.ok(node.textContent.endsWith("\u2026"));
	assert.equal(node.title, long);
	push(modelOf(2, [req("a", { requester: "Short title" })]));
	assert.equal(node.textContent, "Short title");
	assert.equal(node.title, "");
});

// R2-1: an explicit focus model is consumed once, not replayed by the arming
// timer. Exercise the actual Review-all action while that timer is outstanding.
test("R2-1: ending the inert window preserves focus in Review all", async () => {
	const { dom, doc, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	push(modelOf(2, [req("b")]));
	push(modelOf(3, [req("b")], { focus: true }));
	assert.equal(doc.activeElement.id, "approvals-card");
	click(dom, doc.getElementById("approvals-review"));
	assert.equal(doc.activeElement.id, "approvals-back");
	await sleep(820);
	assert.equal(
		doc.activeElement.id,
		"approvals-back",
		"timer cannot replay model.focus",
	);
});

test("Q2-1: footer is outside the scrollable body and the host can pull intrinsic measurement", () => {
	const { dom, doc, push } = mount();
	push(modelOf(1, [req("a")]));
	assert.equal(
		doc.querySelector(".card-footer").parentElement.id,
		"approvals-card",
	);
	assert.equal(doc.querySelector(".card-body .card-footer"), null);
	assert.equal(typeof dom.window.__approvalsCard.measure, "function");
	dom.window.__approvalsCard.measure();
	assert.equal(doc.getElementById("approvals-gloss").style.minHeight, "");
});

test("R2-1: re-arming does not replace a focused Review-all row", async () => {
	const { dom, doc, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	push(modelOf(2, [req("b")], { focus: true }));
	click(dom, doc.getElementById("approvals-review"));
	const row = doc.querySelector("#approvals-rows button");
	row.focus();
	await sleep(820);
	assert.ok(
		doc.activeElement === row,
		"the timer leaves the focused row intact",
	);
});

const participatesInLayout = (dom, node) => {
	for (let current = node; current; current = current.parentElement) {
		if (dom.window.getComputedStyle(current).display === "none") return false;
	}
	return true;
};
const key = (dom, node, value, shiftKey = false) => {
	const event = new dom.window.KeyboardEvent("keydown", {
		key: value,
		shiftKey,
		bubbles: true,
		cancelable: true,
	});
	node.dispatchEvent(event);
	return event;
};

test("R3-1: real document and CSS hide request decisions in Review all, then restore them on Back", () => {
	const { dom, doc, push } = mount();
	push(modelOf(1, [req("a"), req("b")]));
	const request = doc.getElementById("approvals-request");
	assert.equal(dom.window.getComputedStyle(request).display, "flex");
	click(dom, doc.getElementById("approvals-review"));
	assert.equal(request.hidden, true);
	assert.equal(
		dom.window.getComputedStyle(request).display,
		"none",
		"authored flex rule must not override hidden",
	);
	assert.ok(
		decisionButtons(doc).every((button) => !participatesInLayout(dom, button)),
		"no request decision participates in the visible/tabbable tree",
	);
	assert.ok(participatesInLayout(dom, doc.getElementById("approvals-list")));
	click(dom, doc.getElementById("approvals-back"));
	assert.equal(request.hidden, false);
	assert.equal(dom.window.getComputedStyle(request).display, "flex");
	assert.ok(
		decisionButtons(doc).every((button) => participatesInLayout(dom, button)),
	);
	assert.equal(
		dom.window.getComputedStyle(doc.getElementById("approvals-list")).display,
		"none",
	);
});

test("R3-2: overflowing scope explanation is named, associated, reachable and scrollable without replacing its text", () => {
	const { dom, doc, push, calls } = mount();
	push(modelOf(1, [req("a", { broadKey: "example.test" })]));
	const gloss = doc.getElementById("approvals-gloss");
	// Layout inputs are synthetic in this source-only test. Actual translated
	// pixel heights, native Tab and wheel-to-end are independent native QA gates.
	Object.defineProperties(gloss, {
		clientHeight: { configurable: true, get: () => 25 },
		scrollHeight: { configurable: true, get: () => 46 },
	});
	const buttons = decisionButtons(doc);
	const domain = buttons[3];
	domain.focus();
	const text = gloss.textContent;
	assert.equal(gloss.tabIndex, 0);
	assert.equal(gloss.getAttribute("role"), "region");
	assert.equal(gloss.getAttribute("aria-label"), domain.textContent);
	assert.ok(
		buttons.every(
			(button) => button.getAttribute("aria-describedby") === "approvals-gloss",
		),
	);
	assert.equal(gloss.dataset.overflow, "true");
	assert.ok(
		dom.window.getComputedStyle(gloss).outline.includes("solid"),
		"overflow has a visible border cue",
	);
	buttons[1].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
	assert.notEqual(
		gloss.textContent,
		text,
		"pointer hover can preview another scope",
	);
	assert.equal(key(dom, domain, "Tab").defaultPrevented, true);
	assert.ok(doc.activeElement === gloss);
	assert.equal(
		gloss.textContent,
		text,
		"keyboard entry restores its own scope, not the last pointer hover",
	);
	buttons[1].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
	assert.equal(
		gloss.textContent,
		text,
		"entering/reading the gloss preserves the selected scope",
	);
	key(dom, gloss, "End");
	assert.equal(
		gloss.scrollTop + gloss.clientHeight,
		gloss.scrollHeight,
		"keyboard reaches the FULL explanation's end",
	);
	key(dom, gloss, "Home");
	assert.equal(gloss.scrollTop, 0);
	key(dom, gloss, "PageDown");
	assert.equal(gloss.scrollTop, 21);
	key(dom, gloss, "Home");
	key(dom, gloss, "ArrowDown");
	assert.equal(gloss.scrollTop, 16);
	key(dom, gloss, "Tab", true);
	assert.ok(
		doc.activeElement === domain,
		"reverse Tab returns to chosen scope",
	);
	key(dom, domain, "Tab");
	key(dom, gloss, "Tab");
	assert.ok(
		doc.activeElement === buttons[4],
		"forward Tab continues to next decision, not the first one",
	);
	assert.deepEqual(calls, [], "reading consequences never decides");
	Object.defineProperty(gloss, "clientHeight", {
		configurable: true,
		get: () => 60,
	});
	buttons[1].focus();
	assert.equal(gloss.tabIndex, -1, "short explanations add no stop");
	assert.equal(gloss.dataset.overflow, "false");
	assert.equal(key(dom, buttons[1], "Tab").defaultPrevented, false);
});
