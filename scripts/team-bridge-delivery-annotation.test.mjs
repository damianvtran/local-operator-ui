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
const render = (states) =>
	renderToStaticMarkup(
		createElement(TeamBridgeDeliveryAnnotation, {
			message: { delivery_states: states },
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
	const generic = ["Not delivered to Aida (Sam): refused by their moderation"];
	assert.deepEqual(lineTexts(render([entry()])), generic);
	assert.deepEqual(
		lineTexts(render([entry({ refusal_class: "prompt_injection" })])),
		generic,
		"a raw screening category is not a class and must never print",
	);
});

test("held names its recipient; the owner's reason follows a dash, never an ellipsis", () => {
	assert.deepEqual(lineTexts(render([entry({ state: "held" })])), [
		"Waiting to be screened by Aida (Sam)…",
	]);
	const reasons = {
		screening_unavailable: "screening is temporarily unavailable",
		awaiting_review: "awaiting review",
	};
	for (const [cls, reason] of Object.entries(reasons)) {
		assert.deepEqual(
			lineTexts(render([entry({ state: "held", hold_class: cls })])),
			[`Waiting to be screened by Aida (Sam) — ${reason}`],
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
	assert.deepEqual(lineTexts(html), ["Screened; delivery to Aida is pending"]);
	assert.doesNotMatch(html, INFO_LABEL, "neither tooltip describes it");
});

test("a blank label falls back to the shared placeholders", () => {
	assert.deepEqual(
		lineTexts(
			render([entry({ recipient_label: "  ", recipient_owner_label: "" })]),
		),
		[
			"Not delivered to Unknown agent (Unknown person): refused by their moderation",
		],
	);
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
					message: { delivery_states: [entry()] },
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
	assert.deepEqual(lineTexts(render(row.delivery_states)), [
		"Waiting to be screened by Aida (Sam) — awaiting review",
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
