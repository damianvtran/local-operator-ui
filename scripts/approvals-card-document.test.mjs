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
