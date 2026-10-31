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
			'export { ChatSessionAvatar, ChatSessionAvatarEdit } from "./src/renderer/src/features/chat/components/chat-session-avatar";',
			'export { agentAvatarPath } from "./src/renderer/src/shared/agent-avatar/agent-avatar-meta";',
			'export { publish, release } from "./src/renderer/src/shared/lib/blob-url-cache";',
			'export { ChatHeader } from "./src/renderer/src/features/chat/components/chat-header";',
			'export { sessionAvatarTarget } from "./src/renderer/src/shared/agent-avatar/agent-avatar-meta";',
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
	ChatSessionAvatar,
	ChatSessionAvatarEdit,
	ChatHeader,
	sessionAvatarTarget,
	agentAvatarPath,
	publish,
	release,
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
	/*
	 * NOT EVEN AN INERT OVERLAY (agent review round 2, m-B). The link's unowned
	 * arm draws a positioned 16px span; over the row's non-positioned button it
	 * would take the press on the mark. A remote row mounts nothing at all, so the
	 * row button keeps the click.
	 */
	assert.equal(markup, "");
});

/* ------------------------------------------- one status sentence per row --- */

/*
 * THE STATUS IS SPOKEN EXACTLY ONCE PER PICTURED ROW (agent review round 2,
 * MAJOR-1). With the `beside` variant the avatar mounts `ChatSessionStatus`,
 * which carries its own `sr-only` sentence; the avatar used to add a second
 * sentence of its own and to use ANOTHER `ChatSessionStatus` as the cold-bytes
 * fallback, so a pictured row was read two times (warm) or three (cold, with
 * two check glyphs side by side). Counted on the rendered markup of the shipped
 * component, in the four states a row can be in.
 *
 * The bytes states are real: "resolved" publishes a URL under the key the hook
 * peeks in its first render; "cold" and "failed" both leave nothing under it,
 * which is exactly what the hook answers (`null`) before a fetch lands and
 * after a 404 or a rejected relay - the failed path of the live hook is
 * mounted in `agent-avatar-dom.test.mjs`.
 */
const STATUS_SENTENCE = "Complete, unread";
const statusRow = (over) => ({
	session_id: "fixture",
	status: { code: "complete", label: "Complete" },
	attention: { unseen: true },
	...row({}),
	...over,
});
const rowMarkup = (r) =>
	render(
		createElement(
			MemoryRouter,
			{ initialEntries: ["/"] },
			createElement(ChatSessionAvatar, { row: r, nowSeconds: 0 }),
		),
	);
const sentences = (markup) =>
	[...markup.matchAll(/<span class="sr-only">([^<]*)<\/span>/g)].map(
		(m) => m[1],
	);
const statusGlyphs = (markup) => markup.match(/lucide-check/g)?.length ?? 0;

test("a pictured row names its status once when the picture resolved", () => {
	const r = statusRow({ agent_id: "agent-warm" });
	const key = agentAvatarPath("agent-warm", r.avatar_sha256);
	publish(key, "blob:fixture-warm");
	try {
		const markup = rowMarkup(r);
		assert.match(markup, /data-agent-mark/);
		assert.deepEqual(sentences(markup), [STATUS_SENTENCE]);
		assert.equal(statusGlyphs(markup), 1);
	} finally {
		// `publish` files at zero references; one release drops the entry.
		release(key);
	}
});

test("a pictured row names its status once while the bytes are cold", () => {
	const markup = rowMarkup(statusRow({ agent_id: "agent-cold" }));
	assert.deepEqual(sentences(markup), [STATUS_SENTENCE]);
	// One status glyph, not the fallback's and the cell's side by side.
	assert.equal(statusGlyphs(markup), 1);
	// The plate that holds the picture's place is silent.
	assert.match(
		markup,
		/data-agent-mark="" aria-hidden="true"|aria-hidden="true"[^>]*data-agent-mark/,
	);
});

test("a pictured row names its status once when the bytes failed", () => {
	// A digest the hook cannot use is the same `null` a 404 or a rejected relay
	// ends in; the live failure is mounted in `agent-avatar-dom.test.mjs`.
	const markup = rowMarkup(
		statusRow({ agent_id: "agent-failed", avatar_sha256: "not-a-digest" }),
	);
	assert.deepEqual(sentences(markup), [STATUS_SENTENCE]);
	assert.equal(statusGlyphs(markup), 1);
});

test("a row with no picture names its status once, as main did", () => {
	const markup = rowMarkup(statusRow({ avatar_sha256: undefined }));
	assert.deepEqual(sentences(markup), [STATUS_SENTENCE]);
	assert.equal(statusGlyphs(markup), 1);
	assert.doesNotMatch(markup, /data-session-mark="avatar"/);
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
	// Ownership comes out of the shared reader, which calls the one predicate.
	assert.match(content, /avatarTarget\(state\)\?\.owned/);
	assert.match(content, /sessionAvatarTarget\(\s*state\.sessions\.find/);
	const meta = await readFile(
		"src/renderer/src/shared/agent-avatar/agent-avatar-meta.ts",
		"utf8",
	);
	assert.match(meta, /sessionPictureEditable\(row\)/);

	const sidebar = await readFile(
		"src/renderer/src/features/chat/components/chat-session-avatar.tsx",
		"utf8",
	);
	// The one answer is bound once, and both the early return (a remote row mounts
	// nothing) and the link's `owned` read that binding.
	assert.match(sidebar, /const target = sessionAvatarTarget\(row\);/);
	assert.match(
		sidebar,
		/if \(!target\?\.owned \|\| !target\.agentName\) return null;/,
	);
	assert.match(sidebar, /owned=\{owned\}/);
	assert.doesNotMatch(sidebar, /^\s*owned=\{true\}/m);
});

/* ------------------------------------------- the header's placement (Q-1) --- */

/*
 * THE HEADER'S PENCIL ADDRESSES THE BOUND AGENT, NOT THE CHAT TITLE (QA round 1,
 * Q-1). `chat-page` hands the header the conversation's TITLE as `agentName` (it
 * is what the header shows), and the header used to feed that same string to the
 * editor link, so the href read `name=<conversation title>` and the Agents page
 * answered "could not be read". The mocks hid it because every fixture named the
 * conversation after its agent. These cases give the title and the agent
 * DIFFERENT names - the shape of nearly every real conversation - and render the
 * shipped `ChatHeader`, with the picture's bytes published under the key the
 * hook peeks so the mark (and so the door) draws on its first frame.
 */
const TITLE = "Hello from the mock provider";
const hrefOf = (markup) =>
	/href="#([^"]*edit=picture[^"]*)"/
		.exec(markup)?.[1]
		?.replaceAll("&amp;", "&");
const withBytes = (r, fn) => {
	const key = agentAvatarPath(r.agent_id, r.avatar_sha256);
	publish(key, "blob:fixture-header");
	try {
		return fn();
	} finally {
		release(key);
	}
};
const headerMarkup = (r) =>
	render(
		createElement(
			MemoryRouter,
			{ initialEntries: ["/"] },
			createElement(ChatHeader, {
				agentName: TITLE,
				// Exactly what `chat-content` derives from the row: one reader, shared
				// with the sidebar's pencil.
				agentAvatar: sessionAvatarTarget(r),
			}),
		),
	);

test("the header's pencil carries the bound agent's name, not the chat title", () => {
	const r = row({ binding: { agent: "Scout" } });
	const href = withBytes(r, () => hrefOf(headerMarkup(r)));
	assert.ok(href, "the header drew a pencil for an owned, pictured agent");
	const params = new URLSearchParams(href.split("?")[1]);
	assert.equal(params.get("name"), "Scout");
	assert.equal(params.get("agent"), "agent-1");
	assert.notEqual(params.get("name"), TITLE);
	// The title is still what the header SHOWS; only the link's address moved.
	assert.match(headerMarkup(r), new RegExp(TITLE));
});

test("the header and the sidebar row build the same href for one session", () => {
	const r = row({ binding: { agent: "Scout" } });
	const fromHeader = withBytes(r, () => hrefOf(headerMarkup(r)));
	const fromRow = hrefOf(sidebarMarkup({ binding: { agent: "Scout" } }));
	assert.ok(fromHeader && fromRow);
	assert.equal(fromHeader, fromRow);
});

test("no bound agent name, or a remote agent, draws no pencil in the header", () => {
	for (const over of [
		{ binding: {} },
		{ binding: undefined },
		{ locality: "remote" },
		{ agent_id: null },
	]) {
		const r = row({ binding: { agent: "Scout" }, ...over });
		const markup = withBytes(row({}), () => headerMarkup(r));
		assert.doesNotMatch(markup, /data-agent-avatar-edit/, JSON.stringify(over));
		assert.doesNotMatch(markup, /edit=picture/, JSON.stringify(over));
	}
});

test("the header takes its agent from the row's binding, never from the title", async () => {
	const content = await readFile(
		"src/renderer/src/features/chat/components/chat-content.tsx",
		"utf8",
	);
	// The wiring a render cannot reach (`chat-content` needs a desktop transport):
	// the header's avatar comes from the shared reader, and carries its name.
	assert.match(content, /sessionAvatarTarget\(/);
	assert.match(content, /agentName: avatarAgentName/);
	const header = await readFile(
		"src/renderer/src/features/chat/components/chat-header.tsx",
		"utf8",
	);
	assert.doesNotMatch(header, /<ChatHeaderAvatar[^>]*agentName=/);
});
