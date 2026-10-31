/**
 * The picture's two doors into its one editor, asserted in Node.
 *
 * WHY THIS FILE EXISTS (agent review round 1, M1 and M2). Both findings are about
 * a promise made in one place and broken in another:
 *
 *  - M1: the pencil navigates to `/agents?…&edit=picture`, and the field that
 *    reads that parameter is mounted only inside the detail pane's EDIT branch -
 *    so a pane drawn in view mode had nothing to consume the instruction. The
 *    link's own comments promised a scroll, a focus and a dropped parameter, and
 *    delivered none of them.
 *  - M2: the same session row answered "can this device change this picture?"
 *    two ways - the chat sidebar withheld the pencil on a remote row and the chat
 *    header offered it unconditionally, with the href carrying a foreign agent id
 *    into this machine's `/agents` page.
 *
 * WHAT IS EXECUTED HERE, and what is read from source instead. The predicate
 * (`sessionPictureEditable`) and the pane's seeded edit mode are REAL renders:
 * `renderToStaticMarkup` drives the shipped components, so the assertions are on
 * the markup a reader would get - a mounted field with its anchor id, or none.
 * The page's own parameter read is asserted against its source, because the page
 * cannot be mounted without a desktop transport (`agent-class-toggle.test.mjs`
 * builds one for its own cases); the wiring it proves - the parameter read and
 * the prop it feeds - is the half that was missing, and the render below is what
 * proves the prop opens the editor.
 *
 * WHAT IS NOT HERE: nothing is painted, so this says nothing about how a frame
 * looks. Frames belong to the PR's rendered evidence; this file is the guard.
 */

import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export { AgentDetail } from "./src/renderer/src/features/agents/components/agent-detail";',
			'export { ChatSessionAvatarEdit } from "./src/renderer/src/features/chat/components/chat-session-avatar";',
			'export { sessionPictureEditable } from "./src/renderer/src/shared/agent-avatar/agent-avatar-meta";',
			'export { renderToStaticMarkup } from "react-dom/server";',
			'export { createElement } from "react";',
			'export { MemoryRouter } from "react-router-dom";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
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
	/*
	 * A REAL `require` FOR THE CJS HALF OF THE GRAPH, for the reason
	 * `agent-class-toggle.test.mjs` states: the component graph still reaches
	 * `@emotion/react` through the MUI theme modules, and that package's CJS build
	 * calls `require("react")` - which esbuild's ESM output refuses by default,
	 * raising the failure ASYNCHRONOUSLY and therefore after the cases that had
	 * already registered have passed.
	 */
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
	/*
	 * External so the renderer and the bundled hooks share ONE copy of each: a
	 * bundled second React carries a different context and the render would fail
	 * for a reason no assertion here is about.
	 */
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"react-router-dom",
		"@tanstack/react-query",
	],
	// The app's own project, so a `.tsx` file's stricter conversions are the ones
	// the shipped build applies rather than a looser default.
	tsconfig: "tsconfig.app.json",
});

/*
 * The bundle lands on disk for the length of the import, not in a `data:` URL: a
 * data: module cannot resolve the bare specifiers above, and the failure arrives
 * as an `ERR_UNSUPPORTED_RESOLVE_REQUEST` raised after the earlier cases ran. The
 * pid keeps two concurrent runs apart, and the unlink is immediate.
 */
const bundlePath = new URL(
	`./_agent-picture-edit-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	AgentDetail,
	ChatSessionAvatarEdit,
	sessionPictureEditable,
	renderToStaticMarkup,
	createElement,
	MemoryRouter,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * A CLIENT OF ITS OWN PER RENDER. The picture components read the agents query
 * client (`useAgentAvatarMap`), and the pane mounts the field's own `AgentMark`,
 * so a mount without one throws inside the render rather than exercising the
 * branch under test. Retries are off so a failing query cannot hold the render
 * open in a test that is not about the query.
 */
const render = (node) =>
	renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{
				client: new QueryClient({
					defaultOptions: { queries: { retry: false, gcTime: 0 } },
				}),
			},
			node,
		),
	);

/* ------------------------------------------------------- the ownership answer --- */

/*
 * ONE ANSWER FOR BOTH PLACEMENTS (M2). The predicate is what the sidebar's pencil
 * and the header's mark both read, so these cases are the rule itself rather than
 * one surface's reading of it.
 */
const row = (over) => ({
	session_id: "fixture",
	binding: { agent: "Scout" },
	agent_id: "agent-1",
	avatar_sha256: "a".repeat(64),
	...over,
});

test("a local row's picture is editable, a remote row's is not", () => {
	assert.equal(sessionPictureEditable(row({ locality: "local" })), true);
	assert.equal(sessionPictureEditable(row({ locality: "remote" })), false);
});

test("a plain page's row (no locality) is editable", () => {
	/*
	 * `locality` rides only a listing that asked for peers, so absence is "no
	 * claim" - and those rows came from this machine's own catalogue. Reading
	 * absence as "not local" would take the pencil off every ordinary
	 * conversation.
	 */
	assert.equal(sessionPictureEditable(row({})), true);
	assert.equal(sessionPictureEditable(row({ locality: undefined })), true);
});

test("a row that names no agent has nothing to edit", () => {
	assert.equal(sessionPictureEditable(row({ agent_id: null })), false);
	assert.equal(sessionPictureEditable(row({ agent_id: undefined })), false);
	assert.equal(sessionPictureEditable(undefined), false);
	assert.equal(sessionPictureEditable(null), false);
});

/* --------------------------------------------------- the sidebar's placement --- */

/*
 * THE SIDEBAR DRAWS THE ANCHOR, and the wrapper is the one implementation of "no
 * pencil": an unowned row keeps the bare picture (here, the invisible hit box the
 * row's overlay is) with no link, no pencil and no tab stop.
 */
const sidebarMarkup = (over) =>
	render(
		createElement(
			MemoryRouter,
			{ initialEntries: ["/"] },
			createElement(ChatSessionAvatarEdit, { row: row(over) }),
		),
	);

test("a local conversation row still draws the pencil's door", () => {
	const markup = sidebarMarkup({ locality: "local" });
	assert.match(markup, /data-agent-avatar-edit/);
	assert.match(markup, /edit=picture/);
});

test("a remote conversation's row draws no door at all", () => {
	const markup = sidebarMarkup({ locality: "remote" });
	assert.doesNotMatch(markup, /data-agent-avatar-edit/);
	assert.doesNotMatch(markup, /edit=picture/);
	assert.doesNotMatch(markup, /<a /);
});

/* ----------------------------------------------------- the pane's edit mode --- */

/*
 * THE PARAMETER OPENS THE EDITOR (M1). The pane is told, as a SEED, that the URL
 * asked for the picture - and the field is then really in the markup, with the
 * anchor id its own scroll/focus effect looks for. Without the seed the same
 * profile renders its read-only view, which is the dead end the review found.
 */
const profile = {
	name: "scout",
	kind: "role",
	source: "custom",
	agent_id: "agent-1",
	description: "Finds things.",
	instructions: "Look.",
	tools: null,
	effort: null,
	delegate: false,
	definition_revision: "rev-1",
};

const paneMarkup = (openPictureEditor) =>
	render(
		createElement(
			MemoryRouter,
			{
				initialEntries: [
					"/agents?kind=agent&name=scout&agent=agent-1&edit=picture",
				],
			},
			createElement(AgentDetail, {
				profile,
				displayedName: "Scout",
				classNotice: null,
				onClassNotice: () => undefined,
				teams: [],
				effortTiers: [],
				askEnabled: false,
				onSaved: () => undefined,
				onDuplicate: () => undefined,
				onOpenTeam: () => undefined,
				onAskAgent: () => undefined,
				openPictureEditor,
			}),
		),
	);

test("?edit=picture opens the pane in edit mode, with the picture field mounted", () => {
	const markup = paneMarkup(true);
	assert.match(markup, /id="agent-picture"/);
	// The editor's own door: the file input the field renders.
	assert.match(markup, /type="file"/);
});

test("the same profile without the seed renders its read-only view", () => {
	const markup = paneMarkup(false);
	assert.match(markup, /data-agent-detail|ui\.agents\.detail|Edit/i);
	assert.doesNotMatch(markup, /id="agent-picture"/);
});

/* ------------------------------------------------- the page's parameter read --- */

/*
 * READ FROM SOURCE, and the reason is stated in the header: the page needs a
 * desktop transport to mount, and the claim here is a wiring claim - the
 * parameter is read and handed to the pane - not a rendering one. The render
 * above is what proves the prop does the work.
 */
test("the Agents page reads the parameter and seeds the pane with it", async () => {
	const page = await readFile(
		"src/renderer/src/features/agents/components/agents-page.tsx",
		"utf8",
	);
	assert.match(page, /params\.get\("edit"\) === "picture"/);
	assert.match(page, /openPictureEditor=\{pictureEditRequested\}/);
	// The link's parameter name and the reader's may not drift.
	const link = await readFile(
		"src/renderer/src/shared/agent-avatar/agent-avatar-edit-link.tsx",
		"utf8",
	);
	assert.match(link, /edit: "picture"/);
});

/*
 * BOTH PLACEMENTS READ THE ONE ANSWER (M2), and this is the half a render cannot
 * reach: the header's ownership is decided in `chat-content.tsx`, which needs a
 * desktop transport to mount. The two assertions that matter are that neither
 * placement keeps a literal of its own, and that the header's answer comes from
 * the shared predicate rather than from a constant.
 */
test("neither placement decides ownership for itself", async () => {
	const content = await readFile(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	assert.match(content, /owned: agentAvatarOwned/);
	// The property line, not the prose about it: the comment above the block
	// quotes the literal it replaced, and a bare /owned: true/ matches that too.
	assert.doesNotMatch(content, /^\s*owned: true,/m);
	assert.match(content, /agentAvatarOwned = useCanonicalSessionsStore/);
	assert.match(content, /sessionPictureEditable\(\s*state\.sessions\.find/);

	const sidebar = await readFile(
		"src/renderer/src/features/chat/components/chat-session-avatar.tsx",
		"utf8",
	);
	assert.match(sidebar, /owned=\{sessionPictureEditable\(row\)\}/);
	assert.doesNotMatch(sidebar, /^\s*owned=\{true\}/m);
});
