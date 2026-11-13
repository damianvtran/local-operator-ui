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
			export { teamBridgeDeliveryLines, teamBridgeDeliverySummary } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation-model";
			export { TeamBridgeDeliveryAnnotation, TeamBridgeDeliveryLines, teamBridgeDeliverySummaryText, teamBridgeDeliverySummaryRuns } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation";
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
	teamBridgeDeliverySummary,
	teamBridgeDeliverySummaryText,
	teamBridgeDeliverySummaryRuns,
	TeamBridgeDeliveryAnnotation,
	TeamBridgeDeliveryLines,
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
// Round-1 remediation assertions (#1832), hoisted for useTopLevelRegex.
const ROW_SCREENING =
	/Not delivered to Dot \(Ana\) yet\. It is being screened\./;
const ROW_HELD_FOR_REVIEW =
	/Not delivered to Eve \(Renee\) yet\. Held for Renee’s review\./;
const ROW_ANY_CLASS = /could not be screened|retrying/;
const ROW_RETRY = /It could not be screened; retrying automatically\./;
const ROW_PENDING = /Screened; delivery to Aida \(Sam\) is pending/;
const ROW_NOT_REVIEWED_SHORT = /nobody reviewed it within a day/;
const ROW_NOT_REVIEWED =
	/Not delivered to Aida \(Sam\): nobody reviewed it within a day\. It arrives only if its owner releases it; if it matters, send it again or ask them\./;
const YET_ELLIPSIS = /yet…/;
const DELIVERED_RUN_SHRINKS =
	/<span class="[^"]*shrink-\[999\][^"]*">Delivered to 12<\/span><span class="[^"]*">/;
const FULL_TITLE =
	/title="Delivered to 12 · 1 held for review · 2 not delivered"/;
const ANY_BUTTON = /<button/;
const ONE_REFUSED_TEXT = /Delivered to 5 · 1 not delivered/;
const MIN_H_6 = /\bmin-h-6\b/;
const NOT_REVIEWED_FOOTER =
	/A message not reviewed within a day arrives only if the recipient’s owner releases it\./;
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
// The per-recipient lines, as the summary's details popover renders them
// (since 2026-11-09 they no longer sit directly under the message).
const render = (states, source = HUMAN_SOURCE) =>
	renderToStaticMarkup(
		createElement(TeamBridgeDeliveryLines, {
			lines: teamBridgeDeliveryLines(states, source),
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
		"Not delivered to Aida (Sam) yet…",
	]);
	const reasons = {
		screening_unavailable: "It could not be screened; retrying automatically.",
		awaiting_review: "Held for Sam’s review.",
	};
	for (const [cls, reason] of Object.entries(reasons)) {
		assert.deepEqual(
			lineTexts(render([entry({ state: "held", hold_class: cls })])),
			[`Not delivered to Aida (Sam) yet. ${reason}`],
			cls,
		);
	}
	assert.deepEqual(
		lineTexts(render([entry({ state: "held", hold_class: "provider_error" })])),
		["Not delivered to Aida (Sam) yet…"],
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
	["held", { state: "held" }, (r) => `Not delivered to ${r} yet…`],
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
		// The render-time RTL isolation (src/i18n/bidi.ts, isolateValue) wraps a
		// Latin value in FSI…PDI inside an RTL sentence: that is the product
		// behaviour now, so the pin carries the isolates rather than bare text.
		ur: "\u2068Ben Tran\u2069 کے چیف آف اسٹاف تک نہیں پہنچا۔",
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
				createElement(TeamBridgeDeliveryLines, {
					lines: teamBridgeDeliveryLines([entry()], HUMAN_SOURCE),
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
		"Not delivered to Aida (Sam) yet. Held for Sam’s review.",
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
		"Not delivered to Cy (Sam) yet…",
	]);
	assert.deepEqual(
		lineTexts(render(states, { origin: "agent", sender: { kind: "agent" } })),
		[
			"Not delivered to Aida (Sam). Refused by moderation.",
			"Not delivered to Cy (Sam) yet…",
		],
	);
});

// agent-server #377: a sender is served a recipient's refusal as the neutral
// `not_delivered`, with no class. It must still name WHICH recipient missed the
// message (review R1-1 on #377), exactly like a classless `refused`.
const NOT_DELIVERED_COUNTS = {
	delivered: 0,
	screening: 0,
	held: 0,
	notReviewed: 0,
	notDelivered: 1,
};
test("a single not_delivered entry names its recipient like a classless refusal", () => {
	const states = [entry({ state: "not_delivered" })];
	assert.deepEqual(lineTexts(render(states)), [
		"Not delivered to Aida (Sam). Refused by moderation.",
	]);
	// Even a class a future or faulty hub attaches stays unread: the sender's
	// contract carries none.
	assert.deepEqual(
		lineTexts(
			render([entry({ state: "not_delivered", refusal_class: "abusive" })]),
		),
		["Not delivered to Aida (Sam). Refused by moderation."],
	);
	const summary = teamBridgeDeliverySummary({
		...HUMAN_SOURCE,
		delivery_states: states,
	});
	assert.deepEqual(summary.counts, NOT_DELIVERED_COUNTS);
	assert.equal(summary.lines.length, 1);
});

test("a group with one not_delivered names only that recipient and counts it", () => {
	const states = [
		entry({ endpoint_id: "a", state: "delivered" }),
		entry({ endpoint_id: "b", recipient_label: "Bo", state: "not_delivered" }),
		entry({ endpoint_id: "c", recipient_label: "Cy", state: "delivered" }),
	];
	assert.deepEqual(lineTexts(render(states)), [
		"Not delivered to Bo (Sam). Refused by moderation.",
	]);
	const summary = teamBridgeDeliverySummary({
		...HUMAN_SOURCE,
		delivery_states: states,
		delivery_summary: { total: 3, delivered: 2, not_delivered: 1 },
	});
	assert.deepEqual(summary.counts, { ...NOT_DELIVERED_COUNTS, delivered: 2 });
	assert.deepEqual(
		summary.lines.map((line) => [line.kind, line.agent, line.refusalClass]),
		[["refused", "Bo", null]],
	);
	// Without the hub's summary the derived count agrees.
	assert.deepEqual(
		teamBridgeDeliverySummary({ ...HUMAN_SOURCE, delivery_states: states })
			.counts,
		{ ...NOT_DELIVERED_COUNTS, delivered: 2 },
	);
});

test("an owner's classed refusal and a hold render unchanged beside not_delivered", () => {
	const states = [
		entry({ endpoint_id: "a", refusal_class: "personal_info" }),
		entry({ endpoint_id: "b", recipient_label: "Bo", state: "held" }),
		entry({ endpoint_id: "c", recipient_label: "Cy", state: "not_delivered" }),
	];
	assert.deepEqual(lineTexts(render(states)), [
		"Not delivered to Aida (Sam): refused by their moderation (looked like a request for personal information)",
		"Not delivered to Bo (Sam) yet…",
		"Not delivered to Cy (Sam). Refused by moderation.",
	]);
	assert.deepEqual(
		teamBridgeDeliverySummary({ ...HUMAN_SOURCE, delivery_states: states })
			.counts,
		{ ...NOT_DELIVERED_COUNTS, screening: 1, notDelivered: 2 },
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
		// 14 lines plus `recipient_unnamed`, the in-sentence unnamed form
		// (#1643), plus the eight summary keys (2026-11-09), plus the two phase
		// lines (`held_screening`, `held_not_reviewed`) and the not-reviewed
		// footer, less the dropped `summary.pending` (#1832 round 1), plus the
		// four uncounted `summary.single.*` outstanding forms (2026-11-10; no
		// `single.delivered`, since #1858 a complete message renders no line).
		assert.equal(entries.length, 29, locale);
		for (const [key, value] of entries) {
			assert.doesNotMatch(value, MODERATION_EM_DASH, `${locale}:${key}`);
		}
	}
});

/*
 * THE COLLAPSED SUMMARY (operator report 2026-11-09): one line per message,
 * counts for every member, per-recipient detail only for a viewer the hub
 * already sent entries to.
 */
const counts = (over = {}) => ({
	delivered: 0,
	screening: 0,
	held: 0,
	notReviewed: 0,
	notDelivered: 0,
	...over,
});

test("summary counts derive from the viewer's entries when the hub sends no summary", () => {
	const states = [
		entry({ endpoint_id: "a", state: "delivered" }),
		entry({ endpoint_id: "b", state: "delivered" }),
		entry({ endpoint_id: "c" }),
		entry({ endpoint_id: "d", state: "held", hold_class: "awaiting_review" }),
		entry({
			endpoint_id: "e",
			state: "held",
			hold_class: "screening_unavailable",
		}),
		entry({ endpoint_id: "f", state: "held" }),
		entry({ endpoint_id: "g", state: "held", hold_class: "delivery_pending" }),
		entry({ endpoint_id: "h", state: "bounced" }),
		entry({ endpoint_id: "c" }),
	];
	const summary = teamBridgeDeliverySummary({
		...HUMAN_SOURCE,
		delivery_states: states,
	});
	assert.deepEqual(
		summary.counts,
		counts({
			delivered: 2,
			screening: 3,
			held: 1,
			notDelivered: 1,
		}),
		"an awaiting_review hold is held; every other unsettled hold is screening (the hub's buckets); unknown states and duplicates count nowhere",
	);
	assert.equal(summary.lines.length, 5);
});

test("a sender's phase picks the bucket, as the hub counts it", () => {
	const summary = teamBridgeDeliverySummary({
		...HUMAN_SOURCE,
		delivery_states: [
			entry({ endpoint_id: "a", state: "held", phase: "screening" }),
			entry({ endpoint_id: "b", state: "held", phase: "held" }),
			entry({ endpoint_id: "c", state: "held", phase: "not_reviewed" }),
			// An owner's stale review hold: the phase wins over the class.
			entry({
				endpoint_id: "d",
				state: "held",
				hold_class: "awaiting_review",
				phase: "not_reviewed",
			}),
			entry({ endpoint_id: "e", state: "held", phase: "future" }),
		],
	});
	assert.deepEqual(
		summary.counts,
		counts({ screening: 2, held: 1, notReviewed: 2 }),
		"an unknown phase claims the least: screening",
	);
});

test("the hub's neutral summary wins over the viewer's partial entries", () => {
	const summary = teamBridgeDeliverySummary({
		...HUMAN_SOURCE,
		delivery_states: [entry({ state: "held" })],
		delivery_summary: {
			delivered: 3,
			held: 1,
			not_reviewed: 1,
			not_delivered: 2,
		},
	});
	assert.deepEqual(
		summary.counts,
		counts({ delivered: 3, held: 1, notReviewed: 1, notDelivered: 2 }),
	);
	assert.equal(
		summary.lines.length,
		1,
		"the detail still comes from the entries",
	);
});

test("a non-sender gets counts and no lines; no data and complete delivery are silent", () => {
	const neutral = teamBridgeDeliverySummary({
		delivery_summary: { delivered: 1, screening: 2 },
	});
	assert.deepEqual(neutral.counts, counts({ delivered: 1, screening: 2 }));
	assert.deepEqual(neutral.lines, []);
	assert.equal(teamBridgeDeliverySummary({}), null);
	assert.equal(
		teamBridgeDeliverySummary({ delivery_summary: { total: 4, delivered: 4 } }),
		null,
		"every recipient delivered is complete: no line (operator 2026-11-10)",
	);
	assert.equal(
		teamBridgeDeliverySummary({
			delivery_summary: { total: 0, delivered: 0 },
		}),
		null,
		"a summary counting nobody (a human-only DM) shows nothing",
	);
	assert.equal(
		teamBridgeDeliverySummary({
			delivery_states: [entry({ state: "delivered" })],
		}),
		null,
		"without a hub summary, an all-delivered message stays quiet as before",
	);
});

test("the summary text keeps the order, omits zeros and pluralizes per locale", () => {
	assert.equal(
		teamBridgeDeliverySummaryText(
			counts({ delivered: 3, screening: 2, notDelivered: 2 }),
		),
		"Delivered to 3 · 2 being screened · 2 not delivered",
	);
	assert.equal(
		teamBridgeDeliverySummaryText(counts({ held: 1, notReviewed: 1 })),
		"1 held for review · 1 not reviewed",
	);
	try {
		setLocale("ru");
		assert.equal(
			teamBridgeDeliverySummaryText(counts({ delivered: 5, notDelivered: 1 })),
			"Доставлено: 5 · Не доставлено: 1",
		);
		setLocale("fr");
		assert.equal(
			teamBridgeDeliverySummaryText(counts({ notReviewed: 2 })),
			"2 non examinés",
		);
	} finally {
		setLocale("en");
	}
});

/*
 * ONE RECIPIENT IN TOTAL (operator request 2026-11-10): "Being screened", not
 * "1 being screened". The trigger is the hub's whole-message total, never one
 * bucket at 1, and the runs still concatenate to the accessible name. A 1:1
 * message that is delivered renders nothing at all (#1858), so there is no
 * uncounted "Delivered" form.
 */
const hubLine = (summary) => {
	const s = teamBridgeDeliverySummary({ delivery_summary: summary });
	return {
		text: teamBridgeDeliverySummaryText(s.counts, s.single),
		runs: teamBridgeDeliverySummaryRuns(s.counts, s.single),
	};
};

test("a single-recipient message drops the count; several recipients keep every count", () => {
	const cases = [
		[{ total: 1, screening: 1 }, "Being screened"],
		[{ total: 1, held: 1 }, "Held for review"],
		[{ total: 1, not_reviewed: 1 }, "Not reviewed"],
		[{ total: 1, not_delivered: 1 }, "Not delivered"],
		// Negative controls: one bucket at 1 among several recipients.
		[
			{ total: 3, delivered: 2, screening: 1 },
			"Delivered to 2 · 1 being screened",
		],
		[
			{ total: 2, delivered: 1, screening: 1 },
			"Delivered to 1 · 1 being screened",
		],
		[
			{ total: 2, held: 1, not_reviewed: 1 },
			"1 held for review · 1 not reviewed",
		],
	];
	for (const [summary, expected] of cases) {
		const { text, runs } = hubLine(summary);
		assert.equal(text, expected, JSON.stringify(summary));
		assert.equal(
			runs.delivered + runs.rest,
			expected,
			`runs ${JSON.stringify(summary)}`,
		);
	}
	assert.deepEqual(hubLine({ total: 1, screening: 1 }).runs, {
		delivered: "",
		rest: "Being screened",
	});
	try {
		setLocale("fr");
		assert.equal(hubLine({ total: 1, held: 1 }).text, "En attente d’examen");
		setLocale("ru");
		assert.equal(hubLine({ total: 1, screening: 1 }).text, "На проверке");
	} finally {
		setLocale("en");
	}
});

/*
 * Review F1/F2: only a hub summary whose `total` is 1 proves one recipient.
 * An older hub's derived counts cover only the viewer's own agents, and a
 * malformed bucket drops out of the parse, so both keep the count.
 */
test("derived or inconsistent counts keep their count even when they sum to 1", () => {
	// An owner of one of three recipient agents, older hub (no summary).
	const derived = teamBridgeDeliverySummary({
		delivery_states: [
			{
				endpoint_id: "bep_aida",
				recipient_label: "Aida",
				recipient_owner_label: "Ben Tran",
				state: "held",
				hold_class: "awaiting_review",
			},
		],
	});
	assert.equal(derived.single, false);
	assert.equal(
		teamBridgeDeliverySummaryText(derived.counts, derived.single),
		"1 held for review",
	);
	// A two-recipient message whose screening bucket was malformed and dropped.
	const parsed = teamBridgeMessageSchema.parse({
		id: "bcmsg_f2",
		conversation_id: "bconv_1",
		seq: 1,
		sender: { account_id: "acct_1", kind: "human", display_label: "Ben" },
		body: "hi",
		origin: "human",
		created_at: "2026-11-10T00:00:00Z",
		delivery_summary: { total: 2, delivered: 1, screening: -1 },
	});
	const partial = teamBridgeDeliverySummary(parsed);
	assert.equal(partial.single, false);
	assert.equal(
		teamBridgeDeliverySummaryText(partial.counts, partial.single),
		// The dropped bucket's recipient is folded into screening (#1858).
		"Delivered to 1 · 1 being screened",
	);
	// No `total` at all proves nothing either.
	const noTotal = teamBridgeDeliverySummary({
		delivery_summary: { screening: 1 },
	});
	assert.equal(noTotal.single, false);
	assert.equal(
		teamBridgeDeliverySummaryText(noTotal.counts, noTotal.single),
		"1 being screened",
	);
});

const SINGLE_VISIBLE = />Held for review</;
const SINGLE_COUNTED = /1 held for review/;
const SINGLE_TITLE = /title="Held for review"/;
test("a 1:1 message renders the uncounted line as its visible text and title", () => {
	const html = renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: {
				delivery_summary: { total: 1, held: 1 },
				origin: "human",
			},
		}),
	);
	assert.match(html, SINGLE_VISIBLE);
	assert.doesNotMatch(html, SINGLE_COUNTED);
	assert.match(html, SINGLE_TITLE);
});

/*
 * #1858 x #1840: a delivered 1:1 message is complete, so it renders no line,
 * neither "Delivered" nor "Delivered to 1". This is why `single.delivered`
 * was dropped rather than shipped as dead copy.
 */
test("a fully delivered 1:1 message renders nothing", () => {
	assert.equal(
		teamBridgeDeliverySummary({ delivery_summary: { total: 1, delivered: 1 } }),
		null,
	);
	const html = renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: {
				delivery_summary: { total: 1, delivered: 1 },
				origin: "human",
			},
		}),
	);
	assert.equal(html, "");
});

test("the server summary schema keeps counts only and drops bad values per field", () => {
	const parsed = teamBridgeMessageSchema.parse({
		id: "bcmsg_s",
		conversation_id: "bconv_1",
		seq: 1,
		sender: { account_id: "acct_1", kind: "human", display_label: "Ben" },
		body: "hi",
		origin: "human",
		created_at: "2026-11-09T00:00:00Z",
		delivery_summary: {
			total: 3,
			delivered: 2,
			held: -1,
			not_delivered: "x",
			pending: 1,
			recipients: ["Aida"],
		},
	});
	assert.deepEqual(
		parsed.delivery_summary,
		{
			total: 3,
			delivered: 2,
			held: undefined,
			not_delivered: undefined,
		},
		"no `pending` bucket in the contract: an older hub's key is stripped",
	);
	assert.equal(
		teamBridgeMessageSchema.parse({
			id: "bcmsg_s",
			conversation_id: "bconv_1",
			seq: 1,
			sender: { account_id: "acct_1", kind: "human", display_label: "Ben" },
			body: "hi",
			origin: "human",
			created_at: "2026-11-09T00:00:00Z",
			delivery_summary: "bad",
		}).delivery_summary,
		undefined,
		"a malformed summary costs the summary, never the message",
	);
});

test("a non-sender sees the neutral line: counts, no names, nothing to open", () => {
	const html = renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: { delivery_summary: { delivered: 3, held: 1 } },
		}),
	);
	assert.match(html, /Delivered to 3 · 1 held for review/);
	assert.doesNotMatch(html, /<button/);
	assert.doesNotMatch(html, /Aida|Sam/);
	assert.equal(
		renderToStaticMarkup(
			createElement(TeamBridgeDeliveryAnnotation, { message: {} }),
		),
		"",
	);
});

const mountSender = async (root) =>
	act(async () =>
		root.render(
			createElement(TeamBridgeDeliveryAnnotation, {
				message: {
					...HUMAN_SOURCE,
					delivery_states: [
						entry({ endpoint_id: "a", state: "delivered" }),
						entry({ endpoint_id: "b" }),
					],
				},
			}),
		),
	);
const SENDER_SUMMARY_TEXT = /Delivered to 1 · 1 not delivered/;
const DETAIL_TEXT = /Not delivered to Aida \(Sam\)\. Refused by moderation\./;

test("the sender's line opens its details on a press, pins, and closes on Escape", async () => {
	const root = createRoot(document.getElementById("root"));
	try {
		await mountSender(root);
		const button = document.querySelector("button");
		assert.equal(
			button.getAttribute("type"),
			"button",
			"Enter/Space activate it natively",
		);
		assert.match(button.textContent, SENDER_SUMMARY_TEXT);
		assert.doesNotMatch(document.body.textContent, DETAIL_TEXT);
		await act(async () => {
			button.focus();
			button.dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.match(document.body.textContent, DETAIL_TEXT);
		assert.equal(button.getAttribute("aria-expanded"), "true");
		const panel = document.querySelector('[aria-label="Delivery details"]');
		assert.ok(panel, "the panel carries its accessible name");
		assert.equal(
			document.activeElement,
			panel,
			"a press focuses the panel, not a glyph",
		);
		await act(async () => {
			panel.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		assert.doesNotMatch(document.body.textContent, DETAIL_TEXT);
		assert.equal(
			document.activeElement,
			button,
			"the panel took focus, so closing returns it to the trigger (U1 keeps this)",
		);
	} finally {
		await act(async () => root.unmount());
	}
});

test("hover opens the details without taking focus, and leaving closes them", async () => {
	const root = createRoot(document.getElementById("root"));
	const Pointer = dom.window.PointerEvent ?? dom.window.MouseEvent;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	try {
		await mountSender(root);
		const button = document.querySelector("button");
		await act(async () => {
			button.dispatchEvent(new Pointer("pointerover", { bubbles: true }));
			await wait(400);
		});
		assert.match(document.body.textContent, DETAIL_TEXT);
		assert.notEqual(
			document.activeElement,
			document.querySelector('[aria-label="Delivery details"]'),
		);
		await act(async () => {
			button.dispatchEvent(
				new Pointer("pointerout", {
					bubbles: true,
					relatedTarget: document.body,
				}),
			);
			await wait(300);
		});
		assert.doesNotMatch(document.body.textContent, DETAIL_TEXT);
	} finally {
		await act(async () => root.unmount());
	}
});

/*
 * CROSS-PR CONTRACT FIXTURES (2026-11-09). Built from the agreed contract and
 * agent-server #352's in-progress remediation (`BridgeConversationDeliverySummaryView`:
 * total/delivered/screening/held/not_reviewed/not_delivered; `phase` on every
 * held entry). Replace with a verbatim captured response once #352's
 * remediation commit lands (review R1).
 */
const CONTRACT_SENDER_MESSAGE = {
	id: "bcmsg_contract",
	conversation_id: "bconv_1",
	seq: 7,
	sender: { account_id: "acct_ben", kind: "human", display_label: "Ben" },
	body: "Can someone pull the Q3 numbers?",
	origin: "human",
	created_at: "2026-11-09T10:00:00Z",
	delivery_summary: {
		total: 7,
		delivered: 3,
		screening: 1,
		held: 1,
		not_reviewed: 0,
		not_delivered: 2,
	},
	delivery_states: [
		{
			endpoint_id: "bep_a",
			recipient_label: "Aida",
			recipient_owner_label: "Sam",
			state: "delivered",
		},
		{
			endpoint_id: "bep_b",
			recipient_label: "Bo",
			recipient_owner_label: "Kim",
			state: "delivered",
		},
		{
			endpoint_id: "bep_c",
			recipient_label: "Cy",
			recipient_owner_label: "Lee",
			state: "delivered",
		},
		{
			endpoint_id: "bep_d",
			recipient_label: "Dot",
			recipient_owner_label: "Ana",
			state: "held",
			phase: "screening",
		},
		{
			endpoint_id: "bep_e",
			recipient_label: "Eve",
			recipient_owner_label: "Renee",
			state: "held",
			phase: "held",
		},
		{
			endpoint_id: "bep_f",
			recipient_label: "Fay",
			recipient_owner_label: "Max",
			state: "refused",
		},
		{
			endpoint_id: "bep_g",
			recipient_label: "Gil",
			recipient_owner_label: "Ola",
			state: "refused",
		},
	],
};

test("contract fixture: buckets sum to total, and the sender's rows match the line (R1/D1/U3)", () => {
	const parsed = teamBridgeMessageSchema.parse(CONTRACT_SENDER_MESSAGE);
	const s = parsed.delivery_summary;
	assert.equal(
		s.delivered + s.screening + s.held + s.not_reviewed + s.not_delivered,
		s.total,
	);
	const summary = teamBridgeDeliverySummary(parsed);
	assert.deepEqual(
		summary.counts,
		counts({ delivered: 3, screening: 1, held: 1, notDelivered: 2 }),
	);
	const derived = teamBridgeDeliverySummary({
		...parsed,
		delivery_summary: undefined,
	});
	assert.deepEqual(
		derived.counts,
		summary.counts,
		"the sender's own rows count exactly what the hub's line says",
	);
	assert.equal(
		teamBridgeDeliverySummaryText(summary.counts),
		"Delivered to 3 · 1 being screened · 1 held for review · 2 not delivered",
	);
	const rows = lineTexts(
		renderToStaticMarkup(
			createElement(TeamBridgeDeliveryLines, { lines: summary.lines }),
		),
	).join("\n");
	assert.match(rows, ROW_SCREENING);
	assert.match(rows, ROW_HELD_FOR_REVIEW);
	assert.doesNotMatch(rows, ROW_ANY_CLASS, "no class reaches the sender");
});

test("an owner's class copy wins over a fresh phase; a stale phase wins over the class", () => {
	const owner = (over) =>
		lineTexts(render([entry({ state: "held", ...over })])).join("\n");
	assert.match(
		owner({ hold_class: "screening_unavailable", phase: "screening" }),
		ROW_RETRY,
	);
	assert.match(
		owner({ hold_class: "delivery_pending", phase: "screening" }),
		ROW_PENDING,
	);
	assert.match(
		owner({ hold_class: "delivery_pending", phase: "not_reviewed" }),
		ROW_NOT_REVIEWED_SHORT,
	);
});

test("not reviewed says what happened and what to do, never 'yet…' (U2)", () => {
	const html = lineTexts(
		render([entry({ state: "held", phase: "not_reviewed" })]),
	).join("\n");
	assert.match(html, ROW_NOT_REVIEWED);
	assert.doesNotMatch(html, YET_ELLIPSIS);
});

test("the line truncates 'Delivered to N' first, and its runs are the full text (D5)", () => {
	const c = counts({ delivered: 12, held: 1, notDelivered: 2 });
	const runs = teamBridgeDeliverySummaryRuns(c);
	assert.deepEqual(runs, {
		delivered: "Delivered to 12",
		rest: " · 1 held for review · 2 not delivered",
	});
	assert.equal(runs.delivered + runs.rest, teamBridgeDeliverySummaryText(c));
	// Two recipients, so the counted form; a lone recipient's uncounted run is
	// covered by the single-recipient test above.
	assert.deepEqual(teamBridgeDeliverySummaryRuns(counts({ held: 2 })), {
		delivered: "",
		rest: "2 held for review",
	});
	const html = renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: {
				delivery_summary: {
					total: 15,
					delivered: 12,
					held: 1,
					not_delivered: 2,
				},
			},
		}),
	);
	assert.match(
		html,
		DELIVERED_RUN_SHRINKS,
		"the delivered run is the one that shrinks first",
	);
	assert.match(html, FULL_TITLE);
});

test("all delivered renders nothing, for members and the sender alike (operator 2026-11-10)", () => {
	for (const message of [
		{ delivery_summary: { total: 3, delivered: 3 } },
		{
			...HUMAN_SOURCE,
			delivery_summary: { total: 1, delivered: 1 },
			delivery_states: [entry({ state: "delivered" })],
		},
	]) {
		const html = renderToStaticMarkup(
			createElement(TeamBridgeDeliveryAnnotation, { message }),
		);
		assert.equal(html, "");
	}
});

/*
 * WHAT "COMPLETE" MEANS (operator 2026-11-10: "Don't hide a still-pending
 * state"). The line disappears only when every recipient the hub counts is
 * delivered; anything else keeps it up, and a `total` the buckets do not
 * account for is a pending recipient, never a hidden one.
 */
test("complete: every bucket but delivered is zero and delivered matches total", () => {
	assert.equal(
		teamBridgeDeliverySummary({ delivery_summary: { total: 7, delivered: 7 } }),
		null,
	);
	assert.equal(
		teamBridgeDeliverySummary({ delivery_summary: { delivered: 6 } }),
		null,
		"an older hub with no total is judged on its buckets",
	);
	assert.equal(
		teamBridgeDeliverySummary({
			delivery_summary: {
				total: 6,
				delivered: 6,
				screening: 0,
				held: 0,
				not_reviewed: 0,
				not_delivered: 0,
			},
		}),
		null,
		"explicit zero buckets are still complete",
	);
});

test("a total above the bucket sum counts the shortfall as being screened", () => {
	const summary = teamBridgeDeliverySummary({
		delivery_summary: { total: 6, delivered: 5 },
	});
	assert.deepEqual(summary.counts, counts({ delivered: 5, screening: 1 }));
	assert.equal(
		teamBridgeDeliverySummaryText(summary.counts),
		"Delivered to 5 · 1 being screened",
	);
	assert.deepEqual(
		teamBridgeDeliverySummary({
			delivery_summary: { total: 7, delivered: 4, screening: 1, held: 1 },
		}).counts,
		counts({ delivered: 4, screening: 2, held: 1 }),
		"the shortfall adds to the hub's own screening count",
	);
	assert.deepEqual(
		teamBridgeDeliverySummary({ delivery_summary: { total: 2 } }).counts,
		counts({ screening: 2 }),
		"a total with no verdicts yet is all in progress",
	);
});

test("any outstanding bucket keeps the line, for every member", () => {
	for (const [bucket, key] of [
		["screening", "screening"],
		["held", "held"],
		["not_reviewed", "notReviewed"],
		["not_delivered", "notDelivered"],
	]) {
		const summary = teamBridgeDeliverySummary({
			delivery_summary: { total: 6, delivered: 5, [bucket]: 1 },
		});
		assert.deepEqual(
			summary?.counts,
			counts({ delivered: 5, [key]: 1 }),
			`${bucket} is outstanding`,
		);
		assert.deepEqual(summary.lines, [], "a non-sender still gets counts only");
	}
	const refusedHtml = renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: {
				delivery_summary: { total: 6, delivered: 5, not_delivered: 1 },
			},
		}),
	);
	assert.match(refusedHtml, ONE_REFUSED_TEXT);
	assert.doesNotMatch(refusedHtml, ANY_BUTTON);
});

test("without a hub summary the derived counts are unchanged", () => {
	assert.equal(
		teamBridgeDeliverySummary({
			...HUMAN_SOURCE,
			delivery_states: [
				entry({ state: "delivered" }),
				entry({ endpoint_id: "bep_two", state: "delivered" }),
			],
		}),
		null,
	);
	assert.deepEqual(
		teamBridgeDeliverySummary({
			...HUMAN_SOURCE,
			delivery_states: [
				entry({ state: "delivered" }),
				entry({ endpoint_id: "bep_two", state: "refused" }),
			],
		}).counts,
		counts({ delivered: 1, notDelivered: 1 }),
	);
});

test("the sender's trigger has a 24px tap target (U5)", async () => {
	const root = createRoot(document.getElementById("root"));
	try {
		await mountSender(root);
		assert.match(document.querySelector("button").className, MIN_H_6);
	} finally {
		await act(async () => root.unmount());
	}
});

test("a stale count the rows cannot name gets the not-reviewed footer (U2)", async () => {
	const root = createRoot(document.getElementById("root"));
	try {
		await act(async () =>
			root.render(
				createElement(TeamBridgeDeliveryAnnotation, {
					message: {
						...HUMAN_SOURCE,
						delivery_summary: { total: 2, delivered: 1, not_reviewed: 1 },
						// An older hub: an entry without a phase.
						delivery_states: [entry({ state: "held" })],
					},
				}),
			),
		);
		await act(async () => {
			document.querySelector("button").dispatchEvent(
				new dom.window.MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		assert.match(document.body.textContent, NOT_REVIEWED_FOOTER);
	} finally {
		await act(async () => root.unmount());
	}
});

test("composer focus survives a hover open/close and an Escape typed in it (U1)", async () => {
	const root = createRoot(document.getElementById("root"));
	const composer = document.createElement("textarea");
	document.body.appendChild(composer);
	const Pointer = dom.window.PointerEvent ?? dom.window.MouseEvent;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	try {
		await mountSender(root);
		const button = document.querySelector("button");
		composer.focus();
		await act(async () => {
			button.dispatchEvent(new Pointer("pointerover", { bubbles: true }));
			await wait(400);
		});
		assert.match(document.body.textContent, DETAIL_TEXT);
		await act(async () => {
			button.dispatchEvent(
				new Pointer("pointerout", {
					bubbles: true,
					relatedTarget: document.body,
				}),
			);
			await wait(300);
		});
		assert.doesNotMatch(document.body.textContent, DETAIL_TEXT);
		assert.equal(document.activeElement, composer, "leave must not move focus");
		// Hover open again, then Escape typed in the composer closes it in place.
		await act(async () => {
			button.dispatchEvent(new Pointer("pointerover", { bubbles: true }));
			await wait(400);
		});
		assert.match(document.body.textContent, DETAIL_TEXT);
		await act(async () => {
			composer.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
				}),
			);
		});
		assert.doesNotMatch(document.body.textContent, DETAIL_TEXT);
		assert.equal(
			document.activeElement,
			composer,
			"Escape must not move focus",
		);
	} finally {
		await act(async () => root.unmount());
		composer.remove();
	}
});
