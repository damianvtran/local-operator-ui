/**
 * The per-recipient delivery annotation: which lines a sender (or a recipient's
 * owner) sees under a message, and what they must never see.
 *
 *     node --test scripts/team-bridge-delivery-annotation.test.mjs
 *
 * WHY. The hub's `delivery_states` vocabularies are closed today, but the
 * renderer parses them as strings, so the safety of this surface rests on the
 * model's narrowing: an unknown state says nothing, an unknown class drops the
 * parenthetical, a delivered entry says nothing. Those are asserted against the
 * SHIPPED model, bundled from source the way the app builds it, and the copy is
 * asserted against RENDERED markup of the shipped component with the English
 * catalogue, so a key that resolves to the wrong sentence fails here.
 *
 * Also pinned: the wire schema keeps a malformed annotation from failing the
 * message it sits under, and the tooltip is the same for every class (a
 * class-specific tooltip would leak more than the one coarse phrase).
 *
 * WHAT IT DOES NOT PROVE: that the hub sends these entries to the right viewer
 * (the hub's job and the end-to-end QA's), or that any pixel is right (the
 * Storybook frames' job).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// DOM first, the way scripts/team-bridge-owner-audit-render.test.mjs stands it
// up: Radix picks its layout-effect hook when its module LOADS, so a bundle
// compiled before \`document\` exists never opens a panel (measured).
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLButtonElement",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

// Same CJS-module bundle as scripts/team-bridge-owner-audit-render.test.mjs:
// react stays external so the component and the renderer share one React.
const bundle = await build({
	stdin: {
		contents: `
			export { teamBridgeDeliveryLines } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation-model";
			export { TeamBridgeDeliveryAnnotation } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation";
			export { teamBridgeMessageSchema } from "./src/shared/team-bridge-contract";
			export { ownerAuditToBridgeMessage } from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit-model";
			export { ownerAuditMessageSchema } from "./src/shared/team-bridge-owner-audit-contract";
			export { recipientLabel, participantLabel, unlistedMemberLabel } from "./src/renderer/src/features/team-bridge/team-bridge-model";
			export { setLocale } from "./src/renderer/src/shared/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-delivery-annotation-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const {
	teamBridgeDeliveryLines,
	TeamBridgeDeliveryAnnotation,
	teamBridgeMessageSchema,
	ownerAuditToBridgeMessage,
	ownerAuditMessageSchema,
	recipientLabel,
	participantLabel,
	unlistedMemberLabel,
	setLocale,
} = compiled.exports;
const createElement = React.createElement;
const MODERATION_LOCALES = ["en", "fr", "es", "zh-CN", "ru", "vi", "ur", "hi"];
const MODERATION_EM_DASH = /\u2014/u;
const RECIPIENT_LINE_KEY = /^ui\.teamBridge\.delivery\.(refused|held|pending)/;
const SPLICED_PARTS = /\{(agent|owner)\}/;
const INFO_LABEL = /aria-label="About message screening"/;
const UNREAD_FIELDS = /SECRET-REASON|harassment|0\.97/;
const INFO_REFUSED_CONSTANT = /t\("ui\.teamBridge\.delivery\.info_refused"\)/;
const INFO_HELD_CONSTANT = /t\("ui\.teamBridge\.delivery\.info_held"\)/;
const REFUSED_TIP_TEXT = /A refused message wasn't passed to the agent/;
const BUTTON_MARKUP = /<button[\s\S]*?<\/button>/;
const NOWRAP_RUN = /<span class="whitespace-nowrap">([\s\S]*?)<\/span><\/li>/;
const NOWRAP_ANY = /whitespace-nowrap/;
const BOUND_PERIOD = /^\. <button/;
const BOUND_CJK_FULL_STOP = /^。<button/;
const BOUND_DANDA = /^। <button/;
const BOUND_URDU_STOP = /^۔ <button/;
const BOUND_ELLIPSIS = /<span class="whitespace-nowrap">… <button/;
const BUTTON_TAIL = /<button[\s\S]*$/;
const HINDI_GRAPHEMES = new Intl.Segmenter("hi", { granularity: "grapheme" });

const entry = (over = {}) => ({
	endpoint_id: "bep_1",
	recipient_label: "Aida",
	recipient_owner_label: "Sam",
	state: "refused",
	...over,
});
// A human classification is positive fixture input, never inferred by the model.
const HUMAN_SOURCE = { origin: "human", sender: { kind: "human" } };
const render = (states, source = HUMAN_SOURCE) =>
	renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: { ...source, delivery_states: states },
		}),
	);
// The rendered sentence, entities decoded and tags stripped, one per <li>.
const lineTexts = (html) =>
	[...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) =>
		m[1]
			.replace(/<[^>]+>/g, "")
			.replace(/&#x27;/g, "'")
			.replace(/&amp;/g, "&")
			.trim(),
	);

test("absent, empty and delivered render nothing", () => {
	assert.deepEqual(teamBridgeDeliveryLines(undefined), []);
	assert.deepEqual(teamBridgeDeliveryLines([]), []);
	assert.deepEqual(
		teamBridgeDeliveryLines([entry({ state: "delivered" })]),
		[],
	);
	assert.equal(render(undefined), "");
	assert.equal(render([entry({ state: "delivered" })]), "");
});

test("an unknown state says nothing rather than guessing", () => {
	assert.deepEqual(teamBridgeDeliveryLines([entry({ state: "bounced" })]), []);
});

test("refused with each class names the agent, owner and the one phrase", () => {
	const phrases = {
		manipulation: "an attempt to manipulate the agent",
		personal_info: "a request for personal information",
		abusive: "abusive content",
		unsafe_content: "unsafe content or links",
		out_of_scope: "a request outside what this agent handles",
	};
	for (const [cls, phrase] of Object.entries(phrases)) {
		assert.deepEqual(
			lineTexts(render([entry({ refusal_class: cls })])),
			[
				`Not delivered to Aida (Sam): refused by their moderation (looked like ${phrase})`,
			],
			cls,
		);
	}
});

test("refused without, or with an unknown, class drops the parenthetical", () => {
	const generic = ["Not delivered to Aida (Sam). Refused by moderation."];
	assert.deepEqual(lineTexts(render([entry()])), generic);
	assert.deepEqual(
		lineTexts(render([entry({ refusal_class: "prompt_injection" })])),
		generic,
		"a raw screening category is not a class and must never print",
	);
});

test("held names its recipient; the owner reason is a complete second sentence", () => {
	assert.deepEqual(lineTexts(render([entry({ state: "held" })])), [
		"Waiting to be screened by Aida (Sam)…",
	]);
	const reasons = {
		screening_unavailable: "Screening is temporarily unavailable.",
		awaiting_review: "Awaiting review.",
	};
	for (const [cls, reason] of Object.entries(reasons)) {
		assert.deepEqual(
			lineTexts(render([entry({ state: "held", hold_class: cls })])),
			[`Waiting to be screened by Aida (Sam). ${reason}`],
			cls,
		);
	}
	assert.deepEqual(
		lineTexts(render([entry({ state: "held", hold_class: "provider_error" })])),
		["Waiting to be screened by Aida (Sam)…"],
		"a raw hold code is not a hold class",
	);
});

test("delivery_pending is its own line: screened, not waiting to be screened", () => {
	const html = render([
		entry({ state: "held", hold_class: "delivery_pending" }),
	]);
	assert.deepEqual(lineTexts(html), [
		"Screened; delivery to Aida (Sam) is pending",
	]);
	assert.doesNotMatch(html, INFO_LABEL, "neither tooltip describes it");
});

test("a blank label falls back to the shared placeholders", () => {
	assert.deepEqual(
		lineTexts(
			render([entry({ recipient_label: "  ", recipient_owner_label: "" })]),
		),
		["Not delivered to Unknown agent. Refused by moderation."],
	);
});

/*
 * THE OWNER EXACTLY ONCE (operator report, 2026-11-03: "Not delivered to Aida
 * (Ben Tran) (Ben Tran). Refused by moderation."). The recipient is resolved
 * through the same `storedAgentName` + `composeChiefLabel` the message rows
 * use, so each shape a stored agent label takes on the wire renders the row's
 * label. Asserted on the refused, held and pending lines, because all three
 * templates take the one composed `{recipient}`.
 */
const LINE_STATES = [
	["refused", {}, (r) => `Not delivered to ${r}. Refused by moderation.`],
	["held", { state: "held" }, (r) => `Waiting to be screened by ${r}…`],
	[
		"pending",
		{ state: "held", hold_class: "delivery_pending" },
		(r) => `Screened; delivery to ${r} is pending`,
	],
];
const RECIPIENT_SHAPES = [
	["a bare agent name gains its owner", "Aida", "Ben Tran", "Aida (Ben Tran)"],
	[
		"a label already carrying its owner keeps it once",
		"Aida (Ben Tran)",
		"Ben Tran",
		"Aida (Ben Tran)",
	],
	[
		"a composed label matched across case and spacing keeps it once",
		"Aida  (ben tran)",
		"Ben Tran",
		"Aida (Ben Tran)",
	],
	[
		"an agent labelled with its owner's name is the owner's chief of staff",
		"Ben Tran",
		"Ben Tran",
		"Ben Tran’s chief of staff",
	],
	[
		"a self-composed X (X) label is the owner's chief of staff",
		"Ben Tran (Ben Tran)",
		"Ben Tran",
		"Ben Tran’s chief of staff",
	],
	[
		"the hub's unnamed-agent label is not composed a second time",
		"Ben Tran's chief of staff",
		"Ben Tran",
		"Ben Tran’s chief of staff",
	],
	[
		"a blank agent label with a known owner is the owner's chief of staff",
		"  ",
		"Ben Tran",
		"Ben Tran’s chief of staff",
	],
	[
		"a blank owner keeps the stored label as is, without an empty parenthetical",
		"Aida (Ben Tran)",
		"",
		"Aida (Ben Tran)",
	],
	[
		"a label naming a different person in parentheses is the agent's own name",
		"Aida (Sales)",
		"Ben Tran",
		"Aida (Sales) (Ben Tran)",
	],
	["blank labels fall back to the shared copy", " ", "", "Unknown agent"],
];
for (const [name, label, owner, expected] of RECIPIENT_SHAPES) {
	for (const [kind, over, sentence] of LINE_STATES) {
		test(`recipient label, ${kind} line: ${name}`, () => {
			assert.deepEqual(
				lineTexts(
					render([
						entry({
							recipient_label: label,
							recipient_owner_label: owner,
							...over,
						}),
					]),
				),
				[sentence(expected)],
			);
		});
	}
}

/*
 * `recipientLabel` DIRECTLY (review M1 on #1643): the delivery lines only ever
 * pass agents, so the human branch is reachable only here. Plain injected
 * forms keep these cases about the resolution rule, not about catalogue copy.
 */
const PLAIN_CHIEF = {
	named: (agent, person) => `${agent} <${person}>`,
	unnamed: (person) => `unnamed:${person}`,
};
const RECIPIENT_LABEL_CASES = [
	["agent, bare name", "agent", "Aida", "Ben Tran", "Aida <Ben Tran>"],
	[
		"agent, stored already composed",
		"agent",
		"Aida (Ben Tran)",
		"Ben Tran",
		"Aida <Ben Tran>",
	],
	[
		"agent, full-width composed (review m2)",
		"agent",
		"Aida（陈伟）",
		"陈伟",
		"Aida <陈伟>",
	],
	[
		"agent, full-width tail naming someone else is its own name",
		"agent",
		"Aida（销售）",
		"陈伟",
		"Aida（销售） <陈伟>",
	],
	[
		"agent, full-width name stored ASCII-composed (review m1-r2)",
		"agent",
		"Aida（v2）(Ben Tran)",
		"Ben Tran",
		"Aida（v2） <Ben Tran>",
	],
	[
		"agent, bracketed name stored composed (review m1-r2)",
		"agent",
		"Aida (v2) (Ben Tran)",
		"Ben Tran",
		"Aida (v2) <Ben Tran>",
	],
	[
		"agent, label equals the owner",
		"agent",
		"Ben Tran",
		"Ben Tran",
		"unnamed:Ben Tran",
	],
	[
		"agent, unnamed (blank label)",
		"agent",
		"  ",
		"Ben Tran",
		"unnamed:Ben Tran",
	],
	["agent, blank labels", "agent", "", " ", null],
	[
		"agent, blank owner and X (X) is X's unnamed agent",
		"agent",
		"Ben Tran (Ben Tran)",
		"",
		"unnamed:Ben Tran",
	],
	[
		"human, named alone, owner ignored",
		"human",
		"Ben Tran",
		"Sam Rivera",
		"Ben Tran",
	],
	["human, legacy placeholder", "human", "Member", "", null],
	["human, blank", "human", "   ", "Ben Tran", null],
];
for (const [name, kind, label, ownerLabel, expected] of RECIPIENT_LABEL_CASES) {
	test(`recipientLabel: ${name}`, () => {
		assert.equal(
			recipientLabel({ kind, label, ownerLabel }, PLAIN_CHIEF),
			expected,
		);
	});
}

/*
 * THE FROZEN OWNER-SUFFIX MATRIX (review M1-r3 on #1643, after two regex
 * regressions on the same function). Every row is asserted through BOTH the
 * delivery path (`recipientLabel`, rendered by the shipped line) and the
 * message-row path (`participantLabel`), with the English catalogue's own
 * compositions: `chief.label` "{agent} ({person})" and the in-sentence /
 * standalone unnamed "{person}’s chief of staff" (identical in English). A row
 * whose owner is "" is an owner the hub sends blank and the directory does not
 * list. `null` is the caller's "Unknown agent" placeholder.
 */
const EN_CHIEF = {
	named: (agent, person) => `${agent} (${person})`,
	unnamed: (person) => `${person}’s chief of staff`,
};
const UNKNOWN_AGENT = "Unknown agent";
const FROZEN_MATRIX = [
	["Aida", "Ben Tran", "Aida (Ben Tran)"],
	["Aida (Ben Tran)", "Ben Tran", "Aida (Ben Tran)"],
	["Aida（Ben Tran）", "Ben Tran", "Aida (Ben Tran)"],
	["Aida（v2）(Ben Tran)", "Ben Tran", "Aida（v2） (Ben Tran)"],
	["Aida (v2) (Ben Tran)", "Ben Tran", "Aida (v2) (Ben Tran)"],
	// The English catalogue composes ASCII brackets; zh-CN would compose
	// "Aida（销售）（陈伟）" from its own `chief.label`.
	["Aida（销售）（陈伟）", "陈伟", "Aida（销售） (陈伟)"],
	["Aida (Ana (she/her))", "Ana (she/her)", "Aida (Ana (she/her))"],
	[
		"Aida (Damian Tran (Minerva))",
		"Damian Tran (Minerva)",
		"Aida (Damian Tran (Minerva))",
	],
	["Aida (Ben Tran (Sales))", "Ben Tran (Sales)", "Aida (Ben Tran (Sales))"],
	["Ben Tran", "Ben Tran", "Ben Tran’s chief of staff"],
	["Ben Tran (Ben Tran)", "Ben Tran", "Ben Tran’s chief of staff"],
	["Ana (she/her) (Ana (she/her))", "", "Ana (she/her)’s chief of staff"],
	["Aida (v2)", "Ben Tran", "Aida (v2) (Ben Tran)"],
	["", "", UNKNOWN_AGENT],
];
const rowLabel = (stored, owner) => {
	const people =
		owner === ""
			? []
			: [
					{
						account_id: "acct_owner",
						display_label: owner,
						role: "member",
						bridge_enabled: true,
						bridge_state: "active",
						// A blank directory agent name sends the row to the stored
						// label, the path this matrix pins.
						agent: { endpoint_id: "bep_owner", name: "", state: "active" },
					},
				];
	return (
		participantLabel(
			{ account_id: "acct_owner", kind: "agent", display_label: stored },
			people,
			EN_CHIEF,
		) ?? UNKNOWN_AGENT
	);
};
for (const [stored, owner, expected] of FROZEN_MATRIX) {
	const name = `${JSON.stringify(stored)} owned by ${JSON.stringify(owner)}`;
	test(`frozen matrix, delivery line: ${name}`, () => {
		assert.equal(
			recipientLabel(
				{ kind: "agent", label: stored, ownerLabel: owner },
				EN_CHIEF,
			) ?? UNKNOWN_AGENT,
			expected,
		);
		assert.deepEqual(
			lineTexts(
				render([
					entry({ recipient_label: stored, recipient_owner_label: owner }),
				]),
			),
			[`Not delivered to ${expected}. Refused by moderation.`],
		);
	});
	test(`frozen matrix, message row: ${name}`, () => {
		assert.equal(rowLabel(stored, owner), expected);
	});
}

test("main's row label for an owner with a bracketed org suffix is preserved", () => {
	// The regression against main that M1-r3 found: main's storedAgentName
	// stripped "(Damian Tran (Minerva))" and the row read the owner once.
	assert.equal(
		rowLabel("Aida (Damian Tran (Minerva))", "Damian Tran (Minerva)"),
		"Aida (Damian Tran (Minerva))",
	);
});

test("an unlisted self-composed agent with a bracketed name is that person's chief of staff", () => {
	const unlisted = (display_label) =>
		unlistedMemberLabel({ kind: "agent", display_label }, EN_CHIEF);
	assert.equal(
		unlisted("Ben Tran (Sales) (Ben Tran (Sales))"),
		"Ben Tran (Sales)’s chief of staff",
	);
	assert.equal(
		unlisted("Ana (she/her) (Ana (she/her))"),
		"Ana (she/her)’s chief of staff",
	);
	// A bracket inside a name is not a composition.
	assert.equal(unlisted("Ana (she/her)"), "Ana (she/her)");
});

/*
 * UNBALANCED BRACKETS (QA O1 on #1643), defined rather than incidental. With
 * the owner KNOWN, only a label ending in exactly that owner's group is
 * split; anything else is the agent's name verbatim and the owner is
 * composed once after it, never dropped. With the owner UNKNOWN, an
 * unbalanced group is never "X (X)", so the label reads verbatim.
 */
const UNBALANCED_MATRIX = [
	// Not ending in the owner's group: the stored text verbatim, owner once.
	["Aida (Ben", "Ben", "Aida (Ben (Ben)"],
	["Aida (Ben) (x", "Ben", "Aida (Ben) (x (Ben)"],
	["Aida (Ben Tran))", "Ben Tran", "Aida (Ben Tran)) (Ben Tran)"],
	// Ending in the owner's group: the head verbatim, unbalanced or not.
	["Aida ((Ben Tran)", "Ben Tran", "Aida ( (Ben Tran)"],
	// An owner whose own name is unbalanced is matched by comparison.
	["Aida (Ben (Sales)", "Ben (Sales", "Aida (Ben (Sales)"],
	["Aida (Ben) (x)", "Ben) (x", "Aida (Ben) (x)"],
	["Aida (Aida (Ben)", "Aida (Ben", "Aida (Aida (Ben)"],
	// Owner unknown: an unbalanced group is never a self-composition.
	["Aida (Ben", "", "Aida (Ben"],
	["Ben (Ben", "", "Ben (Ben"],
	["Ben ((Ben)", "", "Ben ((Ben)"],
];
for (const [stored, owner, expected] of UNBALANCED_MATRIX) {
	const name = `${JSON.stringify(stored)} owned by ${JSON.stringify(owner)}`;
	test(`unbalanced brackets, delivery line and row agree: ${name}`, () => {
		assert.equal(
			recipientLabel(
				{ kind: "agent", label: stored, ownerLabel: owner },
				EN_CHIEF,
			),
			expected,
		);
		assert.equal(rowLabel(stored, owner), expected);
	});
}

test("an over-long label is read verbatim, not scanned (m1-r4 on #1643)", () => {
	// 257 characters: one past the scanners' bound. The same shape at 256 is
	// still recognised, so the bound is exact and not a blanket refusal.
	const atBound = `${"A".repeat(256 - " (Ben)".length)} (Ben)`;
	const overBound = `A${atBound}`;
	assert.equal(atBound.length, 256);
	assert.equal(
		recipientLabel(
			{ kind: "agent", label: atBound, ownerLabel: "Ben" },
			EN_CHIEF,
		),
		atBound,
	);
	assert.equal(
		recipientLabel(
			{ kind: "agent", label: overBound, ownerLabel: "Ben" },
			EN_CHIEF,
		),
		`${overBound} (Ben)`,
	);
	const selfComposed = `${"B".repeat(130)} (${"B".repeat(130)})`;
	assert.equal(
		unlistedMemberLabel(
			{ kind: "agent", display_label: selfComposed },
			EN_CHIEF,
		),
		selfComposed,
	);
	/*
	 * The cost the bound exists for: a pathological 10,000-character label of
	 * nested brackets took ~0.6 s per call before it. Generous ceiling so a
	 * slow CI host does not flake; unbounded it is three orders above this.
	 */
	const nested = `${"(".repeat(5000)}x${")".repeat(5000)}`;
	const started = performance.now();
	recipientLabel(
		{ kind: "agent", label: `${nested} (Ben)`, ownerLabel: "Ben" },
		EN_CHIEF,
	);
	unlistedMemberLabel({ kind: "agent", display_label: nested }, EN_CHIEF);
	assert.ok(performance.now() - started < 50);
});

test("the info glyph is bound to the sentence's last character, never alone (D2 on #1643)", () => {
	const nowrap = (html) => html.match(NOWRAP_RUN)?.[1];
	// The bound run is the final grapheme, a space and the button, so a wrap
	// takes the last word with the glyph rather than stranding the glyph.
	const refused = render([entry()]);
	const run = nowrap(refused);
	assert.ok(run, refused);
	assert.match(run, BOUND_PERIOD);
	assert.match(run, INFO_LABEL);
	assert.match(render([entry({ state: "held" })]), BOUND_ELLIPSIS);
	// The sentence itself is unchanged by the split.
	assert.deepEqual(lineTexts(refused), [
		"Not delivered to Aida (Sam). Refused by moderation.",
	]);
	// Only the last grapheme is bound: a long unspaced name keeps its
	// emergency breaks (`overflow-wrap:anywhere`) outside the nowrap run.
	const long = "A".repeat(120);
	const held = render([
		entry({ state: "held", recipient_label: long, recipient_owner_label: "" }),
	]);
	assert.equal(nowrap(held)?.includes(long), false);
	// A combining mark is never cut off its base (hi ends in "।", ur in "۔";
	// a Devanagari vowel sign before the danda must stay with its consonant).
	try {
		setLocale("hi");
		const hindi = render([entry({ state: "held" })]);
		const bound = nowrap(hindi) ?? "";
		const text = bound.replace(BUTTON_TAIL, "").trimEnd();
		assert.equal([...HINDI_GRAPHEMES.segment(text)].length, 1, text);
	} finally {
		setLocale("en");
	}
	// The pending line has no glyph and so nothing to bind.
	assert.doesNotMatch(
		render([entry({ state: "held", hold_class: "delivery_pending" })]),
		NOWRAP_ANY,
	);
});

test("a CJK full stop ends flush against the glyph, and only CJK does (D2 on #1666)", () => {
	const nowrap = (html) => html.match(NOWRAP_RUN)?.[1];
	/*
	 * `。` carries its own trailing side bearing inside the em box, so the
	 * joining space the Latin sentence needs doubled the gap between the
	 * sentence and the glyph. Both readings are asserted: zh-CN loses the
	 * space, and the two other sentence-final marks that are NOT CJK (the
	 * Devanagari danda and the Urdu full stop) keep it - a rule that dropped
	 * the space for every non-Latin script would break those two.
	 */
	try {
		setLocale("zh-CN");
		const zh = nowrap(render([entry()])) ?? "";
		assert.match(zh, BOUND_CJK_FULL_STOP, zh);
		setLocale("hi");
		const hi = nowrap(render([entry()])) ?? "";
		assert.match(hi, BOUND_DANDA, hi);
		setLocale("ur");
		const ur = nowrap(render([entry()])) ?? "";
		assert.match(ur, BOUND_URDU_STOP, ur);
	} finally {
		setLocale("en");
	}
});

test("an unnamed recipient takes the delivery-scoped in-sentence form, not the rail label", () => {
	// i18n audit C1-C4 on #1643: the rail's standalone `chief.unnamed` is the
	// wrong case/article mid-sentence in hi, ur, fr and es.
	const unnamed = [
		entry({ recipient_label: "Ben Tran", recipient_owner_label: "Ben Tran" }),
	];
	const expected = {
		hi: "Ben Tran के चीफ़ ऑफ़ स्टाफ़ तक नहीं पहुँचा।",
		ur: "Ben Tran کے چیف آف اسٹاف تک نہیں پہنچا۔",
		fr: "Non remis à la cheffe de cabinet (Ben Tran).",
		// es is built around "para" so no "a el" contraction arises (C5 on #1643).
		es: "Mensaje para el jefe de gabinete de Ben Tran no entregado.",
		vi: "Không được chuyển tới chánh văn phòng của Ben Tran",
	};
	try {
		for (const [locale, prefix] of Object.entries(expected)) {
			setLocale(locale);
			const [line] = lineTexts(render(unnamed));
			assert.ok(line.startsWith(prefix), `${locale}: ${line}`);
		}
	} finally {
		setLocale("en");
	}
});

test("no delivery template splices an owner beside the recipient, in any locale", () => {
	for (const locale of MODERATION_LOCALES) {
		const catalogue = JSON.parse(
			readFileSync(`src/i18n/catalogues/${locale}/ui.teamBridge.json`, "utf8"),
		);
		for (const [key, value] of Object.entries(catalogue)) {
			if (!RECIPIENT_LINE_KEY.test(key)) continue;
			assert.doesNotMatch(value, SPLICED_PARTS, `${locale} ${key}`);
			assert.equal(
				value.split("{recipient}").length - 1,
				1,
				`${locale} ${key} names its recipient exactly once`,
			);
		}
	}
});

test("multi-recipient: one line per agent; merging happens only within a recipient", () => {
	const lines = teamBridgeDeliveryLines([
		entry({ endpoint_id: "a", recipient_label: "Aida" }),
		entry({ endpoint_id: "b", recipient_label: "Bo", state: "delivered" }),
		entry({
			endpoint_id: "c",
			recipient_label: "Cy",
			refusal_class: "abusive",
		}),
		entry({ endpoint_id: "d", recipient_label: "Dee", state: "held" }),
		entry({ endpoint_id: "e", recipient_label: "Eve", state: "held" }),
		entry({ endpoint_id: "a", recipient_label: "Aida" }),
	]);
	assert.deepEqual(
		lines.map((l) => l.key),
		["refused:a", "refused:c", "held:d", "held:e"],
	);
});

test("two fixed tooltip texts: one for refusals, one for holds, neither takes a class", () => {
	// Radix renders tooltip content only when open, so the source anchors prove
	// each text is one constant key with no parameters (a parameter is how a
	// class would leak in), and the markup proves the trigger never varies.
	const componentSource = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-delivery-annotation.tsx",
		"utf8",
	);
	assert.match(componentSource, INFO_REFUSED_CONSTANT);
	assert.match(componentSource, INFO_HELD_CONSTANT);
	const trigger = (states) => render(states).match(BUTTON_MARKUP)?.[0] ?? "";
	const base = trigger([entry()]);
	assert.match(base, INFO_LABEL);
	for (const cls of ["manipulation", "abusive", "out_of_scope"]) {
		assert.equal(trigger([entry({ refusal_class: cls })]), base);
	}
	assert.equal(
		trigger([entry({ state: "held", hold_class: "awaiting_review" })]),
		trigger([entry({ state: "held" })]),
	);
});

test("a press opens the panel instead of closing it (D3)", async () => {
	// Real DOM, real Radix: pointerdown, focus, click, pointerup as a mouse
	// press delivers them. Measured negative control: with the click/pointerdown
	// handlers removed, the panel text never appears and this fails.
	const root = createRoot(document.getElementById("root"));
	try {
		await act(async () =>
			root.render(
				createElement(TeamBridgeDeliveryAnnotation, {
					message: { ...HUMAN_SOURCE, delivery_states: [entry()] },
				}),
			),
		);
		const button = document.querySelector("button");
		const Pointer = dom.window.PointerEvent ?? dom.window.MouseEvent;
		await act(async () => {
			button.dispatchEvent(
				new Pointer("pointerdown", { bubbles: true, cancelable: true }),
			);
			button.focus();
			button.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			document.dispatchEvent(new Pointer("pointerup", { bubbles: true }));
		});
		assert.match(document.body.textContent, REFUSED_TIP_TEXT);
	} finally {
		await act(async () => root.unmount());
	}
});

test("extra fields are stripped at the schema and never rendered", () => {
	const parsed = teamBridgeMessageSchema.parse({
		id: "bcmsg_1",
		conversation_id: "bconv_1",
		seq: 1,
		sender: { account_id: "acct_1", kind: "human", display_label: "Sam" },
		body: "hi",
		origin: "human",
		created_at: "2026-10-30T00:00:00Z",
		delivery_states: [entry({ score: 0.97, reason: "SECRET-REASON" })],
	});
	assert.deepEqual(Object.keys(parsed.delivery_states[0]).sort(), [
		"endpoint_id",
		"recipient_label",
		"recipient_owner_label",
		"state",
	]);
	const html = render([
		entry({
			refusal_class: "abusive",
			score: 0.97,
			reason: "SECRET-REASON",
			category: "harassment",
		}),
	]);
	assert.doesNotMatch(html, UNREAD_FIELDS);
});

test("a malformed annotation costs the annotation, never the message", () => {
	const base = {
		id: "bcmsg_1",
		conversation_id: "bconv_1",
		seq: 1,
		sender: { account_id: "acct_1", kind: "human", display_label: "Sam" },
		body: "hi",
		origin: "human",
		created_at: "2026-10-30T00:00:00Z",
	};
	const bad = teamBridgeMessageSchema.safeParse({
		...base,
		delivery_states: [{ state: 7 }],
	});
	assert.equal(bad.success, true);
	assert.equal(bad.data.delivery_states, undefined);
	const good = teamBridgeMessageSchema.parse({
		...base,
		delivery_states: [entry()],
	});
	assert.equal(good.delivery_states.length, 1);
	assert.equal(teamBridgeMessageSchema.parse(base).delivery_states, undefined);
});

test("the owner-audit view carries the audited agent's delivery state to the row", () => {
	const wire = {
		id: "bcmsg_2",
		conversation_id: "bconv_1",
		seq: 2,
		sender: { account_id: "acct_2", kind: "human", display_label: "Ben" },
		body: "hi",
		origin: "human",
		created_at: "2026-10-30T00:00:00Z",
	};
	const held = entry({ state: "held", hold_class: "awaiting_review" });
	const row = ownerAuditToBridgeMessage(
		ownerAuditMessageSchema.parse({ ...wire, delivery_states: [held] }),
	);
	assert.deepEqual(row.delivery_states, [held]);
	assert.deepEqual(lineTexts(render(row.delivery_states, row)), [
		"Waiting to be screened by Aida (Sam). Awaiting review.",
	]);
	assert.equal(
		ownerAuditToBridgeMessage(ownerAuditMessageSchema.parse(wire))
			.delivery_states,
		undefined,
	);
	assert.equal(
		ownerAuditMessageSchema.parse({ ...wire, delivery_states: "bad" })
			.delivery_states,
		undefined,
		"a malformed annotation costs the annotation, never the audit row",
	);
});

// S1 (QA round, 2026-11-02): the audit wire defaults a missing origin to "" and
// the mapper used to coerce any unrecognised origin to the sender's kind, so a
// human SENDER with no/unknown origin disclosed the class. Asserted through the
// real parse -> map -> model -> SSR path, the way the hub's bytes arrive.
test("owner-audit rows with missing, empty or future origin stay generic", () => {
	const wire = {
		id: "bcmsg_3",
		conversation_id: "bconv_1",
		seq: 3,
		sender: { account_id: "acct_2", kind: "human", display_label: "Ben" },
		body: "hi",
		created_at: "2026-10-30T00:00:00Z",
		delivery_states: [entry({ refusal_class: "abusive" })],
	};
	const row = (over) =>
		ownerAuditToBridgeMessage(
			ownerAuditMessageSchema.parse({ ...wire, ...over }),
		);
	const human = row({ origin: "human" });
	assert.equal(
		teamBridgeDeliveryLines(human.delivery_states, human)[0].refusalClass,
		"abusive",
		"a genuine human row keeps the permitted coarse class",
	);
	for (const [label, over] of [
		["missing", {}],
		["empty", { origin: "" }],
		["future", { origin: "relay" }],
		// R3: origin is an exact, case-sensitive vocabulary; a differently cased
		// value is unrecognised, not a person or an agent.
		["cased human", { origin: "Human" }],
		["cased agent", { origin: "AGENT" }],
	]) {
		const message = row(over);
		assert.equal(
			teamBridgeDeliveryLines(message.delivery_states, message)[0].refusalClass,
			null,
			`${label} origin: model`,
		);
		assert.deepEqual(
			lineTexts(render(message.delivery_states, message)),
			["Not delivered to Aida (Sam). Refused by moderation."],
			`${label} origin: rendered`,
		);
	}
});

test("coarse refusal classes require positively known human origin and sender", () => {
	const supplied = [entry({ refusal_class: "abusive" })];
	assert.equal(
		teamBridgeDeliveryLines(supplied, HUMAN_SOURCE)[0].refusalClass,
		"abusive",
	);
	const sources = [
		{},
		{ origin: "agent", sender: { kind: "agent" } },
		{ origin: "system", sender: { kind: "human" } },
		{ origin: "future", sender: { kind: "human" } },
		{ sender: { kind: "human" } },
		{ origin: "human" },
		{ origin: "human", sender: { kind: "agent" } },
		{ origin: "human", sender: { kind: "future" } },
		{ origin: "human", sender: { kind: "human", audit_unknown_kind: true } },
	];
	for (const source of sources) {
		assert.equal(
			teamBridgeDeliveryLines(supplied, source)[0].refusalClass,
			null,
		);
		assert.deepEqual(lineTexts(render(supplied, source)), [
			"Not delivered to Aida (Sam). Refused by moderation.",
		]);
	}
	assert.equal(teamBridgeDeliveryLines(supplied)[0].refusalClass, null);
});

test("an agent refusal exposes no class through text or the info control", () => {
	const source = { origin: "agent", sender: { kind: "agent" } };
	const generic = render([entry()], source);
	for (const refusal_class of [
		"manipulation",
		"personal_info",
		"abusive",
		"unsafe_content",
		"out_of_scope",
	]) {
		assert.equal(render([entry({ refusal_class })], source), generic);
	}
	assert.match(generic, INFO_LABEL);
});

test("mixed partial delivery names only each affected recipient", () => {
	const states = [
		entry({ endpoint_id: "a", refusal_class: "abusive" }),
		entry({ endpoint_id: "b", recipient_label: "Bo", state: "delivered" }),
		entry({ endpoint_id: "c", recipient_label: "Cy", state: "held" }),
		entry({ endpoint_id: "a", refusal_class: "abusive" }),
	];
	assert.deepEqual(lineTexts(render(states)), [
		"Not delivered to Aida (Sam): refused by their moderation (looked like abusive content)",
		"Waiting to be screened by Cy (Sam)…",
	]);
	assert.deepEqual(
		lineTexts(render(states, { origin: "agent", sender: { kind: "agent" } })),
		[
			"Not delivered to Aida (Sam). Refused by moderation.",
			"Waiting to be screened by Cy (Sam)…",
		],
	);
});

test("all moderation copy in every shipped locale has no em dash", () => {
	for (const locale of MODERATION_LOCALES) {
		const catalogue = JSON.parse(
			readFileSync(`src/i18n/catalogues/${locale}/ui.teamBridge.json`, "utf8"),
		);
		const entries = Object.entries(catalogue).filter(([key]) =>
			key.startsWith("ui.teamBridge.delivery."),
		);
		// 13 lines plus `recipient_unnamed`, the in-sentence unnamed form (#1643).
		assert.equal(entries.length, 14, locale);
		for (const [key, value] of entries) {
			assert.doesNotMatch(value, MODERATION_EM_DASH, `${locale}:${key}`);
		}
	}
});
