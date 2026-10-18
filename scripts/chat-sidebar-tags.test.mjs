import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const root = process.cwd();
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};
globalThis.window = {
	api: {
		desktop: {
			request: async () => {
				throw new Error("Unarmed desktop transport");
			},
		},
	},
};
const bundle = await build({
	stdin: {
		contents: `
export * from "./src/renderer/src/features/chat/chat-tag-groups";
export * from "./src/renderer/src/features/chat/chat-tag-draft";
export {parseSidebarView, DEFAULT_SIDEBAR_VIEW} from "./src/renderer/src/features/chat/chat-sidebar-view";
export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";
export {useUiPreferencesStore} from "./src/renderer/src/shared/store/ui-preferences-store";
export {useSessionTagsStore} from "./src/renderer/src/shared/store/session-tags-store";
export {useCanonicalSessionsStore} from "./src/renderer/src/shared/store/canonical-sessions-store";
`,
		resolveDir: root,
	},
	alias: {
		"@features": `${root}/src/renderer/src/features`,
		"@shared": `${root}/src/renderer/src/shared`,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "transcript-echo-fixture",
			setup(builder) {
				// Not a transcript test. Keep the real canonical store and desktopResult;
				// only its unrelated mounted-transcript callbacks are inert.
				builder.onResolve(
					{ filter: /@shared\/hooks\/use-canonical-session/ },
					() => ({ path: "echo", namespace: "tag-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "tag-fixture" }, () => ({
					contents: `
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "unseen";
export const paintPendingSend = () => undefined;
export const settlePendingSend = () => undefined;
export const hasPendingSend = () => false;
export const movePendingSendIdentity = () => undefined;
export const replacePendingSendText = () => undefined;
export const discardPendingSends = () => undefined;
`,
					loader: "js",
				}));
			},
		},
	],
});
const {
	groupChatsByTag,
	deletedTagNameReused,
	draftPrimary,
	parseSidebarView,
	DEFAULT_SIDEBAR_VIEW,
	desktopEndpoint,
	desktopRequestSchema,
	useUiPreferencesStore: preferences,
	useSessionTagsStore: tags,
	useCanonicalSessionsStore: canonical,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const categories = [
	{ id: "b", name: "Project", order: 1, conversations: 1 },
	{ id: "a", name: "Review", order: 0, conversations: 2 },
	{ id: "empty", name: "Empty", order: 2, conversations: 0 },
];
const row = (id, primary, ids = primary ? [primary] : []) => ({
	session_id: id,
	tags: ids.map((key) => ({ id: key, name: key })),
	primary,
});

test("opt-in grouping is primary-only, ordered, stable, once per section", () => {
	const rows = [
		row("1", "b", ["a", "b"]),
		row("2", "a"),
		row("3", null),
		row("4", "a"),
	];
	const groups = groupChatsByTag(rows, categories, true);
	assert.deepEqual(
		groups.map((group) => [
			group.id,
			group.rows.map((item) => item.session_id),
		]),
		[
			["a", ["2", "4"]],
			["b", ["1"]],
			["untagged", ["3"]],
		],
	);
	assert.equal(groups.flatMap((group) => group.rows).length, rows.length);
	assert.equal(groupChatsByTag(rows, categories, false), null);
	assert.equal(groupChatsByTag(rows, [], true), null);
	assert.equal(groupChatsByTag([row("x", null)], categories, true), null);
	assert.equal(groupChatsByTag([row("x", "deleted")], categories, true), null);
});
test("grouping is suspended outside Time sections and while searching", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.match(
		source,
		/tagsAvailable &&[\s\S]*?view.tagsEnabled &&[\s\S]*?view.groupBy === "section" &&[\s\S]*?!query\.trim\(\)/,
	);
});
test("parser accepts only boolean tagsEnabled and retains it across mode changes", () => {
	assert.equal(DEFAULT_SIDEBAR_VIEW.tagsEnabled, false);
	for (const value of [undefined, null, "true", 1, {}])
		assert.equal(parseSidebarView({ tagsEnabled: value }).tagsEnabled, false);
	assert.equal(
		parseSidebarView({ tagsEnabled: true, groupBy: "agent" }).tagsEnabled,
		true,
	);
	assert.equal(parseSidebarView({ tagsEnabled: false }).tagsEnabled, false);
});
test("draft primary follows assignment age order, not registry order", () => {
	assert.equal(draftPrimary(["b", "a"], "a"), "a");
	assert.equal(draftPrimary(["b", "a"], "deleted"), "b");
	assert.equal(draftPrimary([], "a"), null);
});
test("contract validates exact desired-state routes and rejects stray fields", () => {
	for (const [request, endpoint] of [
		[{ op: "tags.list" }, { path: "/v1/desktop/tags", method: "GET" }],
		[
			{
				op: "tags.replace",
				tags: [{ id: "a", name: "Review" }, { name: "New" }],
			},
			{
				path: "/v1/desktop/tags",
				method: "PUT",
				body: { tags: [{ id: "a", name: "Review" }, { name: "New" }] },
			},
		],
		[
			{
				op: "sessions.tags",
				sessionId: "aaaaaaaaaaaa",
				tags: ["a"],
				primary: "a",
			},
			{
				path: "/v1/desktop/sessions/aaaaaaaaaaaa/tags",
				method: "PUT",
				body: { tags: ["a"], primary: "a" },
			},
		],
	])
		assert.deepEqual(
			desktopEndpoint(desktopRequestSchema.parse(request)),
			endpoint,
		);
	assert.equal(
		desktopRequestSchema.safeParse({ op: "tags.list", unexpected: true })
			.success,
		false,
	);
});
test("assignment patches canonical tags then rolls back a refused real desktop.request", async () => {
	canonical.setState({ sessions: [row("aaaaaaaaaaaa", "a")] });
	tags.setState({ categories });
	let reject;
	const requests = [];
	window.api.desktop.request = (request) => {
		requests.push(request);
		return new Promise((_resolve, fail) => {
			reject = fail;
		});
	};
	const operation = tags
		.getState()
		.assignSessionTags("aaaaaaaaaaaa", ["b"], "b");
	assert.equal(canonical.getState().sessions[0].primary, "b");
	assert.deepEqual(canonical.getState().sessions[0].tags, [
		{ id: "b", name: "Project" },
	]);
	reject(new Error("synthetic offline failure"));
	await assert.rejects(operation);
	assert.equal(canonical.getState().sessions[0].primary, "a");
	assert.deepEqual(requests, [
		{
			op: "sessions.tags",
			sessionId: "aaaaaaaaaaaa",
			tags: ["b"],
			primary: "b",
		},
	]);
});
test("older failed write cannot roll back a newer assignment", async () => {
	canonical.setState({ sessions: [row("aaaaaaaaaaaa", "a")] });
	const failures = [];
	window.api.desktop.request = () =>
		new Promise((_resolve, reject) => failures.push(reject));
	const first = tags.getState().assignSessionTags("aaaaaaaaaaaa", ["b"], "b");
	const second = tags.getState().assignSessionTags("aaaaaaaaaaaa", [], null);
	failures[0](new Error("first failed"));
	await assert.rejects(first);
	assert.equal(canonical.getState().sessions[0].primary, null);
	failures[1](new Error("second failed"));
	await assert.rejects(second);
	assert.equal(canonical.getState().sessions[0].primary, "b");
});

test("enabled tags preference survives the existing persisted view storage", () => {
	preferences
		.getState()
		.setChatSidebarView({ ...DEFAULT_SIDEBAR_VIEW, tagsEnabled: true });
	const saved = [...values.values()]
		.map((value) => JSON.parse(value))
		.find((value) => value.state?.chatSidebarView);
	assert.equal(parseSidebarView(saved.state.chatSidebarView).tagsEnabled, true);
});
test("registry replacement failure keeps the loaded categories and editable draft surface", async () => {
	tags.setState({ categories, error: null });
	window.api.desktop.request = async () => ({
		status: 503,
		body: { detail: "synthetic write refusal" },
	});
	await assert.rejects(
		tags.getState().replaceCategories([{ id: "a", name: "Renamed" }]),
	);
	assert.deepEqual(tags.getState().categories, categories);
	assert.equal(
		tags.getState().error,
		null,
		"a write failure must not replace the loaded list with a load-error screen",
	);
});
test("clear uses one assignment and settles the canonical row on the response", async () => {
	canonical.setState({ sessions: [row("aaaaaaaaaaaa", "a")] });
	tags.setState({ categories });
	const requests = [];
	window.api.desktop.request = async (request) => {
		requests.push(request);
		if (request.op === "sessions.tags")
			return {
				status: 200,
				body: {
					result: { session_id: request.sessionId, tags: [], primary: null },
				},
			};
		if (request.op === "tags.list")
			return { status: 200, body: { result: { tags: categories } } };
		return {
			status: 200,
			body: {
				result: {
					sessions: [
						{
							id: "aaaaaaaaaaaa",
							name: "Chat",
							mtime: 1,
							tags: [],
							primary: null,
						},
					],
					truncated: false,
				},
			},
		};
	};
	await tags.getState().assignSessionTags("aaaaaaaaaaaa", [], null);
	assert.deepEqual(
		requests.filter((request) => request.op === "sessions.tags"),
		[
			{
				op: "sessions.tags",
				sessionId: "aaaaaaaaaaaa",
				tags: [],
				primary: null,
			},
		],
	);
	assert.deepEqual(canonical.getState().sessions[0].tags, []);
	assert.equal(canonical.getState().sessions[0].primary, null);
});

test("management has one explicit desired-state write and buffered local operations", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/manage-tags-dialog.tsx",
		"utf8",
	);
	assert.equal(source.split("await replaceCategories(").length - 1, 1);
	assert.ok(source.includes("await replaceCategories(draft)"));
	assert.ok(source.includes("setDraft(next)"));
	assert.ok(source.includes('t("ui.chat.tags.cancel")'));
	assert.ok(source.includes('t("ui.chat.tags.apply")'));
	assert.ok(!source.includes('t("ui.chat.tags.done")'));
});
test("assignment confirms the exact grouped or Untagged success copy after the write", () => {
	const copy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.tags.json", "utf8"),
	);
	assert.equal(
		copy["ui.chat.tags.updated_grouped"],
		"Tags updated. Grouped under {tag}.",
	);
	assert.equal(
		copy["ui.chat.tags.updated_untagged"],
		"Tags updated. Shown under Untagged.",
	);
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-session-tags-dialog.tsx",
		"utf8",
	);
	assert.ok(
		source.indexOf("showSuccessToast(") >
			source.indexOf("await assignSessionTags("),
	);
	assert.ok(
		source.includes(
			't("ui.chat.tags.updated_grouped", { tag: primaryTag.name })',
		),
	);
	assert.ok(source.includes('t("ui.chat.tags.updated_untagged")'));
});

test("delete plus name-only recreation is blocked without blocking normal add/delete", () => {
	const registry = [
		{ id: "a", name: "Review" },
		{ id: "b", name: "Project" },
	];
	assert.equal(
		deletedTagNameReused(registry, [
			{ id: "b", name: "Project" },
			{ name: "Review" },
		]),
		"Review",
	);
	assert.equal(
		deletedTagNameReused(registry, [{ name: " review " }]),
		" review ",
	);
	assert.equal(
		deletedTagNameReused(registry, [{ id: "b", name: "Project" }]),
		null,
	);
	assert.equal(
		deletedTagNameReused(registry, [...registry, { name: "Concept" }]),
		null,
	);
	assert.equal(
		deletedTagNameReused(registry, [
			{ id: "a", name: "Renamed" },
			{ name: "Review" },
		]),
		null,
	);
});
test("save failures are tag-specific, loading errors are not empty registries, and title has no action ellipsis", () => {
	for (const file of ["chat-session-tags-dialog", "manage-tags-dialog"]) {
		const source = readFileSync(
			`src/renderer/src/features/chat/components/${file}.tsx`,
			"utf8",
		);
		assert.ok(source.includes('setError(t("ui.chat.tags.save_failed"))'));
		assert.ok(!source.includes("userFacingMessage"));
	}
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.ok(sidebar.includes("tagCategoriesError === null"));
	const copy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.tags.json", "utf8"),
	);
	assert.equal(copy["ui.chat.tags.manage_title"], "Manage tags");
	assert.equal(copy["ui.chat.tags.done"], undefined);
});
