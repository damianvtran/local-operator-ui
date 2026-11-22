import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* Execute the shipping contract, grouping and renderer. Synthetic history only:
 * no transport/admission request, live session or host identity is exercised. */
const bundle = await build({
	stdin: {
		contents: `
			export { teamBridgeMessageSchema } from './src/shared/team-bridge-contract';
			export { threadItems, teamBridgeAgentSessionLabel, participantLabel } from './src/renderer/src/features/team-bridge/team-bridge-model';
			export { TeamBridgeSenderProvenance } from './src/renderer/src/features/team-bridge/team-bridge-sender-provenance';
			export { TeamBridgeMessageList } from './src/renderer/src/features/team-bridge/team-bridge-message-list';
			export { bundledCatalogues, bundledEnglish } from './src/i18n/keys.gen';
			export { setLocale } from './src/i18n/locale';
			export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	external: ["react", "react-dom", "react-dom/server"],
	tsconfig: "tsconfig.app.json",
	loader: { ".css": "empty" },
	write: false,
});
const compiled = new Module(
	`${process.cwd()}/scripts/sender-provenance-runtime.cjs`,
);
compiled.filename = compiled.id;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
const h = React.createElement;
const NOW = new Date("2026-11-22T10:00:00Z");
const message = (leaf, patch = {}) => ({
	id: "bcmsg_synthetic_1",
	conversation_id: "bcv_synthetic",
	seq: 1,
	sender: {
		account_id: "acct_synthetic_owner",
		kind: "agent",
		display_label: "Registered endpoint alias",
		...(leaf === undefined ? {} : { agent_session: leaf }),
	},
	body: "Synthetic message, not identity material",
	origin: "agent",
	created_at: NOW.toISOString(),
	...patch,
});
const parse = (leaf) => m.teamBridgeMessageSchema.parse(message(leaf));
const htmlFor = (row) =>
	renderToStaticMarkup(h(m.TeamBridgeSenderProvenance, { message: row }));

const malformed = [
	null,
	"manager",
	[],
	{},
	{ display_label: null },
	{ display_label: 7 },
	{ display_label: "" },
	{ display_label: "   " },
	{ display_label: "manager", session_id: "never-render-this" },
	{ display_label: "manager", version: 2 },
	...[
		"\nmanager",
		"manager\n",
		"manager\t",
		"manager\u0000",
		"manager\u202e",
	].map((display_label) => ({ display_label })),
	{ display_label: "a".repeat(65) },
	{ display_label: "界".repeat(22) },
];

test("closed optional leaf rejects malformed/unsupported metadata without losing the message", () => {
	for (const leaf of [undefined, ...malformed]) {
		const parsed = parse(leaf);
		assert.equal(parsed.body, message().body);
		assert.equal(parsed.sender.agent_session, undefined, JSON.stringify(leaf));
		assert.equal(m.teamBridgeAgentSessionLabel(parsed), null);
	}
});

test("host labels preserve proper names and enforce the host's 64 UTF-8 byte boundary", () => {
	for (const label of [
		"Release coordinator",
		"会话负责人",
		"مدیر",
		"a".repeat(64),
		`${"界".repeat(21)}a`,
	]) {
		assert.equal(
			parse({ display_label: label }).sender.agent_session.display_label,
			label,
		);
	}
	assert.equal(
		parse({ display_label: "  Release coordinator  " }).sender.agent_session
			.display_label,
		"Release coordinator",
	);
});

test("actual session is escaped plain text, not endpoint alias, body, title or an identifier", () => {
	const label = '<img src=x onerror="alert(1)">';
	const html = htmlFor(parse({ display_label: label }));
	const document = new JSDOM(html).window.document;
	assert.equal(document.querySelector("span").textContent, label);
	assert.equal(document.querySelector("span").title, label);
	assert.equal(document.querySelectorAll("img,button,a,svg").length, 0);
	assert.equal(html.includes("Registered endpoint alias"), false);
	assert.equal(html.includes("Synthetic message"), false);
});

test("human/app/unknown senders ignore agent metadata and exact-body top-level leaf is not history provenance", () => {
	for (const kind of ["human", "integration", "unknown"]) {
		const row = message({ display_label: "Not a human name" });
		row.sender.kind = kind;
		assert.equal(htmlFor(row), "");
		assert.equal(m.teamBridgeAgentSessionLabel(row), null);
	}
	const row = message(undefined, {
		agent_session: { display_label: "Not history provenance" },
	});
	assert.equal(m.teamBridgeAgentSessionLabel(row), null);
	assert.equal(htmlFor(row).includes("Not history provenance"), false);
});

test("fallback copy exists in source and every supported/shipped locale; host names are not translated", () => {
	const manifest = JSON.parse(readFileSync("i18n/languages.json", "utf8"));
	const expected = manifest.languages
		.filter((row) => ["source", "supported"].includes(row.status))
		.map((row) => row.code)
		.sort();
	const shipped = Object.keys(m.bundledCatalogues).sort();
	assert.deepEqual(shipped, expected);
	const key = "ui.teamBridge.sender.unknown_agent";
	for (const locale of expected) {
		const catalogue =
			locale === "en" ? m.bundledEnglish : m.bundledCatalogues[locale];
		assert.equal(typeof catalogue[key], "string", locale);
		m.setLocale(locale);
		assert.equal(
			new JSDOM(htmlFor(message())).window.document.querySelector("span")
				.textContent,
			catalogue[key],
		);
		assert.equal(
			new JSDOM(
				htmlFor(parse({ display_label: "Release coordinator" })),
			).window.document.querySelector("span").textContent,
			"Release coordinator",
		);
	}
	m.setLocale("en");
});

test("same owner/different session restarts header; same session continues; human metadata does not split runs", () => {
	const first = parse({ display_label: "Release coordinator" });
	const second = (leaf) => ({
		...parse(leaf),
		id: "bcmsg_synthetic_2",
		seq: 2,
		created_at: "2026-11-22T10:01:00Z",
	});
	const continues = (a, b) =>
		m.threadItems([a, b], NOW).filter((item) => item.type === "message")[1]
			.continuation;
	assert.equal(
		continues(first, second({ display_label: "QA coordinator" })),
		false,
	);
	assert.equal(
		continues(first, second({ display_label: "Release coordinator" })),
		true,
	);
	assert.equal(continues(first, second(undefined)), false);
	assert.equal(
		continues(message(), second({ display_label: "\ninvalid" })),
		true,
	);
	const human = (row) => ({ ...row, sender: { ...row.sender, kind: "human" } });
	assert.equal(
		continues(human(first), human(second({ display_label: "Other" }))),
		true,
	);
});

test("sender display does not change withheld body or introduce a body-fetch affordance", () => {
	const row = m.teamBridgeMessageSchema.parse(
		message({ display_label: "Release coordinator" }, { body: null }),
	);
	assert.equal(row.body, null);
	const doc = new JSDOM(renderList([row])).window.document;
	assert.equal(
		doc.querySelector("[data-sender-provenance]").textContent,
		"Release coordinator",
	);
	assert.equal(
		doc.body.textContent.includes("Synthetic message, not identity material"),
		false,
	);
	assert.equal(
		doc.querySelectorAll(
			"[data-sender-provenance] a, [data-sender-provenance] button",
		).length,
		0,
	);
});

const owner = {
	account_id: "acct_synthetic_owner",
	display_label: "Ada Okafor",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	agent: { name: "Registered endpoint alias" },
};
const chiefCopy = {
	named: (agent, person) => `${agent} (${person})`,
	unnamed: (person) => `${person}'s chief of staff`,
};
const renderList = (messages, people = [owner]) =>
	renderToStaticMarkup(
		h(
			m.QueryClientProvider,
			{ client: new m.QueryClient() },
			h(m.TeamBridgeMessageList, {
				messages,
				labelFor: (sender) => m.participantLabel(sender, people, chiefCopy),
				profileFor: (sender) =>
					people.find((person) => person.account_id === sender.account_id),
				arrivalsEnabled: false,
				tenantId: "tnt_synthetic",
			}),
		),
	);

test("real message rows put trusted human owner before actual session, never chief-of-staff alias", () => {
	const a = parse({ display_label: "Release coordinator" });
	const b = {
		...parse({ display_label: "QA coordinator" }),
		id: "bcmsg_synthetic_2",
		seq: 2,
		created_at: "2026-11-22T10:01:00Z",
	};
	const html = renderList([a, b]);
	const doc = new JSDOM(html).window.document;
	const leaves = [...doc.querySelectorAll("[data-sender-provenance]")];
	assert.deepEqual(
		leaves.map((leaf) => leaf.textContent),
		["Release coordinator", "QA coordinator"],
	);
	for (const leaf of leaves)
		assert.equal(
			leaf.previousElementSibling.textContent.includes("Ada Okafor"),
			true,
		);
	assert.equal(html.includes("Registered endpoint alias"), false);
	assert.equal(html.includes("chief of staff"), false);
});

test("legacy/invalid rows stay owner-bound; unknown owner does not promote alias; human header unchanged", () => {
	for (const leaf of [
		undefined,
		{ display_label: "" },
		{ display_label: "bad", unsupported: true },
	]) {
		const html = renderList([parse(leaf)]);
		assert.equal(html.includes("Ada Okafor"), true);
		assert.equal(html.includes("Unknown agent"), true);
		assert.equal(html.includes("Registered endpoint alias"), false);
	}
	const unknown = renderList(
		[message({ display_label: "Release coordinator" })],
		[],
	);
	assert.equal(unknown.includes("Unknown person"), true);
	assert.equal(unknown.includes("Registered endpoint alias"), false);
	const human = message({ display_label: "Ignored leaf" });
	human.sender.kind = "human";
	const humanHtml = renderList([human]);
	assert.equal(humanHtml.includes("Ada Okafor"), true);
	assert.equal(humanHtml.includes("data-sender-provenance"), false);
});
