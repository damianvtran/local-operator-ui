import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build, stop } from "esbuild";

/*
 * BOUNDED ASK CARDS, AND PROPOSAL ASKS THAT LINK TO THEIR REVIEW.
 *
 * WHY THIS FILE EXISTS. A team-brief proposal arrived as an approval whose text
 * was the whole brief; the inline card grew to the text, filled the pane, and hid
 * its own answer pair and the composer. The fix is structural - the question body
 * is a capped scroll region and the controls are its SIBLINGS - and structure is
 * exactly what a later edit can silently undo (move the options back inside the
 * body, drop the cap) while every pixel of a short-question story stays the same.
 * So this asserts the structure on the SHIPPED components with a 10k-character
 * question, on the inline dock and on the Asks panel (which the drawer and the
 * notifications detail pane both embed), plus the proposal contract:
 *
 * 1. the contract's first line parses, and near-misses do not;
 * 2. the structured `profile_proposal` wins when valid and is ignored when not;
 * 3. the review link is `/agents?kind=&name=&proposal=` and the press navigates
 *    in-app to it (a real MemoryRouter, read back from the location);
 * 4. the answer controls still answer from a proposal card.
 *
 * jsdom does no layout, so the cap is asserted as the class the primitive applies
 * and the containment as DOM ancestry; the rendered frames are design review's.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/profile-proposal-ask";',
			'export { ASK_BODY_MAX_H, ASK_CARD_MAX_H, ASK_OPTIONS_MAX_H } from "./src/renderer/src/features/chat/components/asks/ask-bounds";',
			'export { QuestionDock } from "./src/renderer/src/features/chat/components/trace/question-dock";',
			'export { AskPanel } from "./src/renderer/src/features/chat/components/asks/ask-panel";',
			'export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	/* One React and one router context between the bundle and this file. */
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react-router-dom",
		"@tanstack/react-query",
	],
	// Same memory reasoning as notifications-detail-asks-card.test.mjs: minified
	// UTF-8 keeps the shard's peak down when several files build at once.
	minify: true,
	charset: "utf8",
	tsconfig: "tsconfig.web.json",
});
const bundlePath = new URL(
	`./_ask-card-bounds-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
await stop();

await import("@tanstack/react-query");
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
const NoopObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
};
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	localStorage: window.localStorage,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: NoopObserver,
	IntersectionObserver: NoopObserver,
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const key of [
	"Element",
	"Node",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"DOMParser",
])
	if (key in window) shims[key] = window[key];
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
window.CSS ??= { escape: (value) => value };
after(() => {
	for (const [key, descriptor] of originals)
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	window.close();
});

const M = await import(bundlePath.href);
await unlink(bundlePath);
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter, Route, Routes, useLocation } = await import(
	"react-router-dom"
);

const LONG = `${"Proposed brief line that goes on and on. ".repeat(250)}END`;
assert.ok(LONG.length >= 10_000, "the fixture is the incident's size");

const PROPOSAL_TEXT = [
	"Apply proposal pp_7abf6b3116c87a99 to team 'minervadev'?",
	"instructions: +42 −7 lines",
	"Origin: local. Review changes in Agents → minervadev.",
].join("\n");

/** Mount under a router whose location is read back after a press. */
const mount = async (element) => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const seen = { path: "/" };
	const Probe = () => {
		const location = useLocation();
		seen.path = `${location.pathname}${location.search}`;
		return null;
	};
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: ["/"] },
				h(Probe),
				h(Routes, null, h(Route, { path: "*", element })),
			),
		);
	});
	return {
		host,
		seen,
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
};

const classesOf = (node) => String(node.getAttribute("class") ?? "");

test("the contract's first line parses; near-misses do not", () => {
	assert.deepEqual(M.parseProfileProposalText(PROPOSAL_TEXT), {
		id: "pp_7abf6b3116c87a99",
		kind: "team",
		name: "minervadev",
	});
	for (const kind of ["agent", "team", "skill"])
		assert.equal(
			M.parseProfileProposalText(`Apply proposal pp_0a to ${kind} 'x y'?`)
				?.kind,
			kind,
		);
	// Leading whitespace is tolerated (an ask question may start with a blank line).
	assert.equal(
		M.parseProfileProposalText(`\n  Apply proposal pp_ab to agent 'r'?`)?.id,
		"pp_ab",
	);
	for (const miss of [
		null,
		"",
		"Should I Apply proposal pp_ab to team 'x'?",
		"Apply proposal pp_XYZ to team 'x'?",
		"Apply proposal pp_ab to org 'x'?",
		"Apply proposal pp_ab to team x?",
		"Apply proposal pp_ab to team 'x'",
	])
		assert.equal(M.parseProfileProposalText(miss), null, String(miss));
});

test("the structured field wins when valid and falls back to text when not", () => {
	const structured = {
		id: "pp_1234",
		kind: "agent",
		name: "reviewer",
		fields: [{ label: "instructions", added: 3, removed: 1 }, { nope: 1 }],
	};
	assert.deepEqual(M.profileProposalOf(structured, PROPOSAL_TEXT), {
		id: "pp_1234",
		kind: "agent",
		name: "reviewer",
		fields: [{ label: "instructions", added: 3, removed: 1 }],
	});
	for (const bad of [
		{ id: "x", kind: "team", name: "a" },
		{ id: "pp_ab", kind: "org", name: "a" },
		{ id: "pp_ab", kind: "team", name: "" },
		"pp_ab",
		null,
	])
		assert.equal(
			M.profileProposalOf(bad, PROPOSAL_TEXT)?.id,
			"pp_7abf6b3116c87a99",
			JSON.stringify(bad),
		);
	assert.equal(M.profileProposalOf(undefined, "plain question"), null);
});

test("the review path is the Agents proposal URL, encoded", () => {
	assert.equal(
		M.profileProposalReviewPath({
			id: "pp_7abf6b3116c87a99",
			kind: "team",
			name: "minervadev",
		}),
		"/agents?kind=team&name=minervadev&proposal=pp_7abf6b3116c87a99",
	);
	const path = M.profileProposalReviewPath({
		id: "pp_ab",
		kind: "skill",
		name: "a & b",
	});
	const params = new URLSearchParams(path.split("?")[1]);
	assert.equal(params.get("name"), "a & b");
	assert.equal(params.get("proposal"), "pp_ab");
});

const gate = (over) => ({
	request_id: "r-1",
	kind: "ask",
	title: "",
	detail: "",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

test("inline dock: a 10k question scrolls in a capped body; options stay outside it", async () => {
	const pressed = [];
	const view = await mount(
		h(M.QuestionDock, {
			gate: gate({
				title: LONG,
				options: [{ label: "Ship it" }, { label: "Hold" }],
			}),
			onAnswer: (label) => pressed.push(label),
		}),
	);
	const card = view.host.querySelector("section");
	assert.ok(classesOf(card).includes(M.ASK_CARD_MAX_H), "card is capped");
	const body = view.host.querySelector("[data-lo-ask-scroll]");
	assert.ok(body, "the body is the bounded scroll region");
	assert.ok(classesOf(body).includes(M.ASK_BODY_MAX_H));
	assert.ok(classesOf(body).includes("overflow-y-auto"));
	assert.ok(body.textContent.includes("END"), "the whole text is kept");
	const option = [...view.host.querySelectorAll("button")].find((b) =>
		b.textContent.includes("Ship it"),
	);
	assert.ok(option, "the option is rendered");
	assert.equal(body.contains(option), false, "options are not inside the body");
	await act(async () => option.click());
	assert.deepEqual(pressed, ["Ship it"]);
	await view.unmount();
});

test("inline dock: a proposal approval links to its review and still answers", async () => {
	const pressed = [];
	const view = await mount(
		h(M.QuestionDock, {
			gate: gate({
				kind: "approval",
				title: "account profile save",
				detail: `${PROPOSAL_TEXT}\n${LONG}`,
			}),
			onAnswer: (label) => pressed.push(label),
		}),
	);
	const notice = view.host.querySelector("[data-lo-ask-proposal]");
	assert.equal(
		notice?.getAttribute("data-lo-ask-proposal"),
		"pp_7abf6b3116c87a99",
	);
	const body = view.host.querySelector("[data-lo-ask-scroll]");
	assert.equal(
		body.contains(notice),
		false,
		"the link is pinned, not scrolled",
	);
	const review = view.host.querySelector("[data-lo-ask-proposal-review]");
	await act(async () => review.click());
	assert.equal(
		view.seen.path,
		"/agents?kind=team&name=minervadev&proposal=pp_7abf6b3116c87a99",
	);
	await view.unmount();

	// A fresh mount: the press above navigated the route away from the card.
	const again = await mount(
		h(M.QuestionDock, {
			gate: gate({
				kind: "approval",
				title: "account profile save",
				detail: PROPOSAL_TEXT,
			}),
			onAnswer: (label) => pressed.push(label),
		}),
	);
	const approve = again.host.querySelector("[data-ask-option]");
	assert.ok(approve, "the approval pair is still on the card");
	assert.equal(
		again.host.querySelector("[data-lo-ask-scroll]").contains(approve),
		false,
	);
	await act(async () => approve.click());
	assert.equal(pressed.length, 1, "one press, one answer");
	await again.unmount();
});

test("Asks panel: long question and long options are bounded; Other stays outside the option scroll", async () => {
	const options = Array.from({ length: 40 }, (_, i) => ({
		label: `Option ${i + 1}`,
	}));
	const ask = {
		ask_id: "a-long",
		session_id: "s-1",
		created_at: Date.now() - 60_000,
		expires_at: Date.now() + 3_600_000,
		timeout_s: 3600,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [{ id: "q1", question: `${PROPOSAL_TEXT}\n${LONG}`, options }],
	};
	const view = await mount(
		h(M.AskPanel, {
			view: M.askQueueView({
				asks: [ask],
				asks_open: 1,
				asks_truncated: false,
			}),
			nowMs: Date.now(),
			outcomes: {},
			drafts: {},
			onDraftChange: () => undefined,
			onAnswer: () => undefined,
			onDecline: () => undefined,
		}),
	);
	const question = view.host.querySelector('[data-lo-ask-question="q1"]');
	assert.ok(question, "the open question is drawn");
	const body = question.querySelector("[data-lo-ask-scroll]");
	assert.ok(body && classesOf(body).includes(M.ASK_BODY_MAX_H));
	assert.ok(body.textContent.includes("END"));
	const list = question.querySelector("[data-lo-ask-options-scroll]");
	assert.ok(list && classesOf(list).includes(M.ASK_OPTIONS_MAX_H));
	assert.equal(list.querySelectorAll("[data-ask-option]").length, 40);
	const other = question.querySelector("[data-ask-option-other]");
	assert.ok(other, "the Other row is drawn");
	assert.equal(
		list.contains(other),
		false,
		"Other is outside the option scroll",
	);
	assert.equal(body.contains(other), false);
	assert.equal(body.contains(list), false);
	const notice = question.querySelector("[data-lo-ask-proposal]");
	assert.ok(notice, "a proposal question in the panel links too");
	assert.equal(body.contains(notice), false);
	await act(async () =>
		notice.querySelector("[data-lo-ask-proposal-review]").click(),
	);
	assert.equal(
		view.seen.path,
		"/agents?kind=team&name=minervadev&proposal=pp_7abf6b3116c87a99",
	);
	await view.unmount();
});
