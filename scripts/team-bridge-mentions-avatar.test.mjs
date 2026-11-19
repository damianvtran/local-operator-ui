import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";

/*
 * EVERY AGENT MENTION ROW WEARS THE AGENT MARK (design review round 5, D1 and
 * convergence R2-1/R2-2).
 *
 * The @-mention popover had TWO avatar styles: a directory-backed agent went
 * through `TeamBridgeAvatar` (accent glyph, corner notch), while a row with no
 * directory entry — a guest agent, or ANY agent before its roster answer lands,
 * because `mentionCandidates` offers the participant loop first — was a
 * hand-drawn 14 px muted Bot with no mark and a rounded corner. Two of three
 * agents in one section carried the mark that rounds 3 and 4 established as
 * THE agent signal, and the third contradicted the plate's own contract that no
 * surface can opt an agent out of the agent treatment.
 *
 * This test fails if any agent row renders without `data-agent-mark`, covering
 * both shapes that regressed: no directory entry at all, and the same row as
 * the roster-not-yet-loaded case (the participant path). A human row keeps its
 * initials and carries no mark, so a pass is not "everything is marked".
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const bundle = await build({
	stdin: {
		contents: `
export { MentionRowAvatar } from './src/renderer/src/features/team-bridge/mentions/mention-popover';
export { renderToStaticMarkup } from 'react-dom/server';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["react", "react-dom"],
	tsconfig: "tsconfig.app.json",
	write: false,
	logLevel: "silent",
});
const compiled = new Module(
	`${process.cwd()}/scripts/mentions-avatar-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/mentions-avatar-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

/** The owner's directory row, as `candidates.ts` attaches it to an agent row. */
const ownerRow = (overrides = {}) => ({
	account_id: "acc_bea",
	display_label: "Bea Moreau",
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	avatar_url: "/v1/accounts/acc_bea/avatar?v=0123456789abcdef",
	agent: { name: "Aida", enabled: true },
	...overrides,
});

const agentRowWithProfile = {
	kind: "agent",
	accountId: "acc_bea",
	label: "Aida (Bea Moreau)",
	profile: ownerRow(),
};

/** A guest agent: no directory entry at all. */
const guestAgentRow = {
	kind: "agent",
	accountId: "acc_guest",
	label: "Guest agent",
};

/** Roster-not-yet-loaded: the participant loop's row before the directory answers. */
const pendingAgentRow = {
	kind: "agent",
	accountId: "acc_kit",
	label: "Kit (Ben Tran)",
};

/** The human control on the same fixture. */
const humanRow = {
	kind: "human",
	accountId: "acc_bea",
	label: "Bea Moreau",
	profile: ownerRow(),
};

/*
 * The plate reads the private-avatar cache through React Query; a bare render
 * throws "No QueryClient set". Nothing here is ever fetched (an agent never asks
 * for bytes), so one client with retries off is the whole requirement.
 */
const queryClient = new m.QueryClient({
	defaultOptions: { queries: { retry: false } },
});

const html = (row) =>
	m.renderToStaticMarkup(
		React.createElement(
			m.QueryClientProvider,
			{ client: queryClient },
			React.createElement(m.MentionRowAvatar, { row }),
		),
	);

test("every agent mention row wears the agent mark, including with no directory entry", () => {
	const marked = html(agentRowWithProfile);
	assert.match(marked, /data-agent-mark/, "the directory-backed agent row");
	assert.match(marked, /text-accent/, "the directory-backed agent row's ink");
	for (const [label, row] of [
		["a guest agent (no directory entry)", guestAgentRow],
		["an agent before its roster lands", pendingAgentRow],
	]) {
		const out = html(row);
		assert.match(out, /data-agent-mark/, `${label} must carry the agent mark`);
		// The two tells of the removed branch: its own muted span and the 14 px
		// hand-drawn glyph. Both are absent from the plate.
		assert.doesNotMatch(
			out,
			/text-ink-muted/,
			`${label} must not use the muted style`,
		);
	}
});

test("an agent mention row never draws the owner's picture, and a human keeps its initial", () => {
	// The handed row really does name a versioned account avatar; the plate must
	// not turn that into an image for an agent.
	const agent = html(agentRowWithProfile);
	assert.doesNotMatch(
		agent,
		/<img/,
		"an agent row must render no image element",
	);
	assert.doesNotMatch(
		agent,
		/\/v1\/accounts\/acc_bea\/avatar/,
		"no account avatar URL",
	);

	const human = html(humanRow);
	assert.doesNotMatch(
		human,
		/data-agent-mark/,
		"a human row carries no agent mark",
	);
	assert.match(human, />B</, "a human row keeps its initial");

	const guest = html(guestAgentRow);
	assert.doesNotMatch(
		guest,
		/<img/,
		"a guest agent row renders no image element",
	);
});
