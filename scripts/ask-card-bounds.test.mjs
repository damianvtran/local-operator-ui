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
 * 2. both repr quote forms decode, and lines 2/3 lift out only in position;
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
			'export { ASK_BODY_CAP, ASK_BODY_FLOOR, ASK_BODY_MAX_H, ASK_CARD_MAX_H, ASK_FADE_MASK, ASK_OPTIONS_MAX_H } from "./src/renderer/src/features/chat/components/asks/ask-bounds";',
			'export { ApprovalEscapeControls } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
			'export { titleTooltip, TITLE_TOOLTIP_MAX } from "./src/renderer/src/features/notifications/components/notification-detail";',
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
const { readFile } = await import("node:fs/promises");

/*
 * jsdom does no layout: every box is 0x0. The fade and the pane fit are
 * functions of scroll metrics and rects, so a test that needs them installs
 * per-element getters for the duration of one mount and restores them after.
 */
const withLayout = async (metrics, run) => {
	const proto = window.HTMLElement.prototype;
	const saved = {};
	for (const key of ["scrollHeight", "clientHeight"]) {
		saved[key] = Object.getOwnPropertyDescriptor(window.Element.prototype, key);
		Object.defineProperty(proto, key, {
			configurable: true,
			get() {
				return metrics(this)?.[key] ?? 0;
			},
		});
	}
	const rect = window.Element.prototype.getBoundingClientRect;
	proto.getBoundingClientRect = function () {
		const box = metrics(this)?.rect;
		return box
			? {
					x: 0,
					y: box.top,
					top: box.top,
					bottom: box.bottom,
					left: 0,
					right: 0,
					width: 0,
					height: box.bottom - box.top,
				}
			: rect.call(this);
	};
	try {
		await run();
	} finally {
		// Own properties on the subclass prototype: removing them re-exposes jsdom's.
		for (const key of Object.keys(saved)) Reflect.deleteProperty(proto, key);
		Reflect.deleteProperty(proto, "getBoundingClientRect");
	}
};

const LONG = `${"Proposed brief line that goes on and on. ".repeat(250)}END`;
assert.ok(LONG.length >= 10_000, "the fixture is the incident's size");

const PROPOSAL_TEXT = [
	"Apply proposal pp_7abf6b3116c87a99 to team 'minervadev'?",
	"Changes: instructions +42 −7 lines; description changed",
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

test("the contract's three lines parse; near-misses do not", () => {
	assert.deepEqual(M.parseProfileProposalCard(PROPOSAL_TEXT), {
		id: "pp_7abf6b3116c87a99",
		kind: "team",
		name: "minervadev",
		changes: "Changes: instructions +42 −7 lines; description changed",
		origin: "Origin: local.",
		// Line 3's "Review changes in Agents → X." is the button; it is dropped.
		body: "Apply proposal pp_7abf6b3116c87a99 to team 'minervadev'?",
	});
	for (const kind of ["agent", "team", "skill"])
		assert.equal(
			M.parseProfileProposalCard(`Apply proposal pp_0a to ${kind} 'x y'?`)
				?.kind,
			kind,
		);
	// Leading whitespace is tolerated (an ask question may start with a blank line).
	assert.equal(
		M.parseProfileProposalCard(`\n  Apply proposal pp_ab to agent 'r'?`)?.id,
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
		"Apply proposal pp_ab to team 'x\"?",
		"Apply proposal pp_ab to team ''?",
	])
		assert.equal(M.parseProfileProposalCard(miss), null, String(miss));
});

test("names: both Python-repr quote forms, escapes decoded (M1, R5)", () => {
	// repr picks double quotes for a name holding an apostrophe...
	assert.equal(
		M.parseProfileProposalCard(`Apply proposal pp_ab to agent "o'brien"?`)
			?.name,
		"o'brien",
	);
	// ...and single quotes with \' escaped when it holds both kinds.
	assert.equal(
		M.parseProfileProposalCard(
			`Apply proposal pp_ab to agent 'say "hi" o\\'k'?`,
		)?.name,
		`say "hi" o'k`,
	);
	// A backslash arrives doubled; the link must carry the one the user typed.
	assert.equal(
		M.parseProfileProposalCard(`Apply proposal pp_ab to skill 'a\\\\b'?`)?.name,
		"a\\b",
	);
	assert.equal(
		M.parseProfileProposalCard(`Apply proposal pp_ab to team "x\\"y"?`)?.name,
		'x"y',
	);
});

test("lines 2/3 are lifted only in position; an older runtime's dump stays in the body", () => {
	// Older runtime: line 1 then the whole brief. Nothing is stripped.
	const dump = [
		"Apply proposal pp_ab to team 'minervadev'?",
		"Changes: this line is brief prose, not line 2",
	].join("\n");
	const legacy = M.parseProfileProposalCard(
		`Apply proposal pp_ab to team 'minervadev'?\nBefore:\n${LONG}\n${dump}`,
	);
	assert.equal(legacy?.changes, null);
	assert.equal(legacy?.origin, null);
	assert.ok(
		legacy?.body.includes(LONG),
		"the dump is kept for the bounded body",
	);
	// A clipped line 3 (core `_clip`, 200 chars) is kept verbatim, not half-stripped.
	const clipped = M.parseProfileProposalCard(
		"Apply proposal pp_ab to team 'x'?\nChanges: instructions changed\nOrigin: agent. Review changes in Agents → xxxxxxxx…",
	);
	assert.equal(clipped?.changes, "Changes: instructions changed");
	assert.equal(clipped?.origin, null);
	assert.match(clipped?.body ?? "", /Review changes in Agents → x+…$/);
	// Line 2 absent, line 3 present.
	const noChanges = M.parseProfileProposalCard(
		"Apply proposal pp_ab to agent 'r'?\nOrigin: user. Review changes in Agents → r.",
	);
	assert.equal(noChanges?.changes, null);
	assert.equal(noChanges?.origin, "Origin: user.");
	assert.equal(noChanges?.body, "Apply proposal pp_ab to agent 'r'?");
	assert.equal(M.profileProposalOf(null, "plain question"), null);
	assert.equal(
		M.profileProposalOf("plain", PROPOSAL_TEXT)?.id,
		"pp_7abf6b3116c87a99",
	);
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

test("D2: a proposal approval draws line 1 at body size, then Changes and Origin as their own lines; the target is named once", async () => {
	const view = await mount(
		h(M.QuestionDock, {
			gate: gate({
				kind: "approval",
				title: "account profile save",
				detail: PROPOSAL_TEXT,
			}),
		}),
	);
	const body = view.host.querySelector("[data-lo-ask-scroll]");
	assert.ok(classesOf(body).includes("text-body"));
	assert.equal(classesOf(body).includes("text-heading"), false);
	assert.match(body.textContent, /Apply proposal pp_7abf6b3116c87a99 to team/);
	assert.equal(body.textContent.includes("Changes:"), false);
	assert.equal(body.textContent.includes("Origin:"), false);
	const changes = view.host.querySelector("[data-lo-ask-proposal-changes]");
	assert.equal(
		changes?.textContent,
		"Changes: instructions +42 −7 lines; description changed",
	);
	assert.ok(classesOf(changes).includes("line-clamp-2"), "≤2 lines (R2)");
	const origin = view.host.querySelector("[data-lo-ask-proposal-origin]");
	assert.equal(origin?.textContent, "Origin: local.");
	assert.notEqual(changes, origin, "separate lines, not one run");
	const text = view.host.textContent;
	assert.equal(text.includes("Review changes in Agents →"), false);
	assert.equal(
		text.split("minervadev").length - 1,
		1,
		"the team is named once",
	);
	await view.unmount();
});

test("D1: the dock shrinks with the chat column; the body keeps a three-line floor", async () => {
	const view = await mount(
		h(M.QuestionDock, {
			gate: gate({ title: LONG, options: [{ label: "Ship it" }] }),
		}),
	);
	const root = view.host.querySelector('[data-lo-question-dock="expanded"]');
	for (const cls of ["flex", "flex-col", "min-h-0"])
		assert.ok(classesOf(root).split(/\s+/).includes(cls), `dock root ${cls}`);
	const card = view.host.querySelector("section");
	assert.ok(
		classesOf(card).split(/\s+/).includes("min-h-0"),
		"card may shrink",
	);
	assert.ok(classesOf(card).includes("overflow-y-auto"), "card scrolls last");
	const body = view.host.querySelector("[data-lo-ask-scroll]");
	assert.ok(classesOf(body).includes(M.ASK_BODY_FLOOR), "three-line floor");
	assert.equal(
		classesOf(body).split(/\s+/).includes("min-h-0"),
		false,
		"min-h-0 would let flex collapse the body to nothing (R1)",
	);
	assert.match(M.ASK_BODY_FLOOR, /min\(3lh,var\(--lo-ask-content-h/);
	await view.unmount();

	// The column side lives in chat-content.tsx, which is too large to mount
	// here; its contract is the wrapper's class list, read from the source.
	const source = await readFile(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	const at = source.indexOf("<QuestionDock");
	const wrapper = source.slice(source.lastIndexOf("className={cn(", at), at);
	assert.match(wrapper, /"flex max-h-\[50%\] min-h-0 w-full flex-col pt-2"/);
	assert.equal(
		/shrink-0/.test(wrapper.replace(/\/\*[\s\S]*?\*\//g, "")),
		false,
	);
	// The composer it yields to stays `shrink-0`.
	const composer = await readFile(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.ok(composer.includes("`shrink-0` alone"));
});

test("D1(c): the idle status slot drops its reserve only with compactIdle", async () => {
	const render = async (props) => {
		const v = await mount(
			h(M.ApprovalEscapeControls, {
				onSetSession: () => undefined,
				onSetAll: () => undefined,
				...props,
			}),
		);
		const cls = classesOf(
			v.host.querySelector("[data-approval-escape-status]"),
		);
		await v.unmount();
		return cls;
	};
	assert.ok((await render({})).includes("min-h-[2lh]"), "default keeps it");
	assert.equal(
		(await render({ compactIdle: true })).includes("min-h-[2lh]"),
		false,
	);
	assert.ok(
		(await render({ compactIdle: true, busy: true })).includes("min-h-[2lh]"),
		"in flight: reserved",
	);
	assert.ok(
		(
			await render({
				compactIdle: true,
				status: { kind: "refused", detail: "no" },
			})
		).includes("min-h-[2lh]"),
		"a result: reserved",
	);
});

test("D5: an overflowing body fades at the bottom until it is scrolled to the end", async () => {
	let scrolled = 0;
	await withLayout(
		(el) =>
			el.hasAttribute?.("data-lo-ask-scroll")
				? { scrollHeight: 900, clientHeight: 200 }
				: null,
		async () => {
			const view = await mount(
				h(M.QuestionDock, { gate: gate({ title: LONG, options: [] }) }),
			);
			const body = view.host.querySelector("[data-lo-ask-scroll]");
			assert.equal(body.getAttribute("data-lo-ask-scroll"), "overflow");
			assert.ok(body.hasAttribute("data-lo-ask-fade"));
			assert.ok(classesOf(body).includes(M.ASK_FADE_MASK));
			Object.defineProperty(body, "scrollTop", {
				configurable: true,
				get: () => scrolled,
			});
			scrolled = 700;
			await act(async () => body.dispatchEvent(new window.Event("scroll")));
			assert.equal(body.hasAttribute("data-lo-ask-fade"), false, "at the end");
			assert.equal(classesOf(body).includes(M.ASK_FADE_MASK), false);
			await view.unmount();
		},
	);
	// A body that fits draws no fade.
	const fits = await mount(
		h(M.QuestionDock, { gate: gate({ title: "Short?" }) }),
	);
	assert.equal(
		fits.host
			.querySelector("[data-lo-ask-scroll]")
			.hasAttribute("data-lo-ask-fade"),
		false,
	);
	await fits.unmount();
});

test("D3: a bounding pane sizes its FIRST ask body to the room left under the header", async () => {
	const ask = (id) => ({
		ask_id: id,
		session_id: "s-1",
		created_at: Date.now() - 60_000,
		expires_at: Date.now() + 3_600_000,
		timeout_s: 3600,
		urgent: false,
		status: "open",
		delivered: false,
		questions: [{ id: `q-${id}`, question: LONG, options: [{ label: "Yes" }] }],
	});
	await withLayout(
		(el) => {
			if (el.hasAttribute?.("data-lo-ask-bound"))
				return { clientHeight: 576, rect: { top: 0, bottom: 576 } };
			if (el.hasAttribute?.("data-lo-ask-scroll"))
				return {
					scrollHeight: 4000,
					clientHeight: 230,
					rect: { top: 290, bottom: 520 },
				};
			if (el.hasAttribute?.("data-lo-ask-row"))
				return { rect: { top: 250, bottom: 670 } };
			return null;
		},
		async () => {
			const view = await mount(
				h(
					"section",
					{ "data-lo-ask-bound": "" },
					h(M.AskPanel, {
						view: M.askQueueView({
							asks: [ask("a1"), ask("a2")],
							asks_open: 2,
							asks_truncated: false,
						}),
						nowMs: Date.now(),
						outcomes: {},
						drafts: {},
						onDraftChange: () => undefined,
						onAnswer: () => undefined,
						onDecline: () => undefined,
					}),
				),
			);
			const bodies = view.host.querySelectorAll("[data-lo-ask-scroll]");
			assert.ok(bodies.length >= 2);
			// 576 pane - 290 body top - (670 - 520) controls below = 136 px.
			assert.equal(bodies[0].style.maxHeight, `min(${M.ASK_BODY_CAP}, 136px)`);
			assert.equal(bodies[1].style.maxHeight, "", "later bodies keep the cap");
			await view.unmount();
		},
	);
	// No bounding pane (the inline dock, the side panel): no inline fit at all.
	const free = await mount(h(M.QuestionDock, { gate: gate({ title: LONG }) }));
	assert.equal(
		free.host.querySelector("[data-lo-ask-scroll]").style.maxHeight,
		"",
	);
	await free.unmount();
});

test("R3: the notification title tooltip is truncated to 300 characters", () => {
	assert.equal(M.TITLE_TOOLTIP_MAX, 300);
	assert.equal(M.titleTooltip("short"), "short");
	const long = M.titleTooltip(LONG);
	assert.ok(long.length <= 301 && long.length > 290);
	assert.ok(long.endsWith("…"));
	assert.ok(LONG.startsWith(long.slice(0, 300).trimEnd()));
});
