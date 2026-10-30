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
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Same CJS-module bundle as scripts/team-bridge-owner-audit-render.test.mjs:
// react stays external so the component and the renderer share one React.
const bundle = await build({
	stdin: {
		contents: `
			export { teamBridgeDeliveryLines } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation-model";
			export { TeamBridgeDeliveryAnnotation } from "./src/renderer/src/features/team-bridge/team-bridge-delivery-annotation";
			export { teamBridgeMessageSchema } from "./src/shared/team-bridge-contract";
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
} = compiled.exports;
const createElement = React.createElement;
const INFO_LABEL = /aria-label="About message screening"/;
const UNREAD_FIELDS = /SECRET-REASON|harassment|0\.97/;
const INFO_CONSTANT = /content=\{t\("ui\.teamBridge\.delivery\.info"\)\}/;

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
			.replace(/&amp;/g, "&"),
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

test("held is generic for the sender and carries the reason only when hold_class is present", () => {
	assert.deepEqual(lineTexts(render([entry({ state: "held" })])), [
		"Waiting to be screened…",
	]);
	const reasons = {
		screening_unavailable: "screening is temporarily unavailable",
		awaiting_review: "awaiting review",
		delivery_pending: "screened, delivery pending",
	};
	for (const [cls, reason] of Object.entries(reasons)) {
		assert.deepEqual(
			lineTexts(render([entry({ state: "held", hold_class: cls })])),
			[`Waiting to be screened… · ${reason}`],
			cls,
		);
	}
	assert.deepEqual(
		lineTexts(render([entry({ state: "held", hold_class: "provider_error" })])),
		["Waiting to be screened…"],
		"a raw hold code is not a hold class",
	);
});

test("multi-recipient: one line per non-delivered agent; identical holds collapse", () => {
	const lines = teamBridgeDeliveryLines([
		entry({ endpoint_id: "a", recipient_label: "Aida" }),
		entry({ endpoint_id: "b", recipient_label: "Bo", state: "delivered" }),
		entry({
			endpoint_id: "c",
			recipient_label: "Cy",
			refusal_class: "abusive",
		}),
		entry({ endpoint_id: "d", state: "held" }),
		entry({ endpoint_id: "e", state: "held" }),
	]);
	assert.deepEqual(
		lines.map((l) => l.key),
		["refused:a", "refused:c", "held:d"],
	);
});

test("the info control is identical for every class and its copy takes no class", () => {
	// Radix renders tooltip content only when open, so static markup proves the
	// trigger is class-independent; the source anchor proves the content is one
	// constant key with no parameters (a parameter is how a class would leak in).
	const componentSource = readFileSync(
		"src/renderer/src/features/team-bridge/team-bridge-delivery-annotation.tsx",
		"utf8",
	);
	assert.match(componentSource, INFO_CONSTANT);
	const tip = (states) =>
		renderToStaticMarkup(
			createElement(TeamBridgeDeliveryAnnotation, {
				message: { delivery_states: states },
			}),
		).replace(/<li>.*?<\/li>/g, "");
	const base = tip([entry()]);
	for (const cls of ["manipulation", "abusive", "out_of_scope"]) {
		assert.equal(tip([entry({ refusal_class: cls })]), base);
	}
	assert.match(base, INFO_LABEL);
});

test("the line reads only labels and the closed class; extra fields stay unread", () => {
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
