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
		assert.equal(entries.length, 13, locale);
		for (const [key, value] of entries) {
			assert.doesNotMatch(value, MODERATION_EM_DASH, `${locale}:${key}`);
		}
	}
});
