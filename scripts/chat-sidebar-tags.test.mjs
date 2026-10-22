import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const root = process.cwd();
const values = new Map();
globalThis.tagMoveToasts = [];
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
export {moveChatToTag} from "./src/renderer/src/features/chat/chat-tag-move";
export {parseSidebarView, DEFAULT_SIDEBAR_VIEW} from "./src/renderer/src/features/chat/chat-sidebar-view";
export {DesktopControlError} from "./src/renderer/src/shared/api/local-operator/desktop-api";
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
			name: "tag-toast-capture",
			setup(builder) {
				builder.onResolve({ filter: /@shared\/utils\/toast-manager/ }, () => ({
					path: "toast",
					namespace: "tag-toast",
				}));
				builder.onLoad({ filter: /.*/, namespace: "tag-toast" }, () => ({
					contents: `
export const showSuccessToast = (message,options) => globalThis.tagMoveToasts.push({message,options});
export const showWarningToast = (message,options) => globalThis.tagMoveToasts.push({message,options});
`,
					loader: "js",
				}));
			},
		},
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
	moveChatToTag,
	groupChatsByTag,
	moveTagPast,
	unusedTags,
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
	for (const primary of [null, "deleted"])
		assert.deepEqual(
			groupChatsByTag([row("x", primary)], categories, true).map(
				(group) => group.id,
			),
			["untagged"],
			"all-Untagged sections still permit the first drag onto an unused tag",
		);
});
test("unused tags are the zero-conversation registry entries, in registry order (v3 D3)", () => {
	const registry = [
		{ id: "c", name: "C", order: 2, conversations: 0 },
		{ id: "a", name: "A", order: 0, conversations: 3 },
		{ id: "b", name: "B", order: 1, conversations: 0 },
	];
	assert.deepEqual(
		unusedTags(registry).map((tag) => tag.id),
		["b", "c"],
	);
});
test("a header move repositions past the VISIBLE neighbour, not the registry neighbour (v3 D2)", () => {
	// Registry a,b,c,d; this section only draws a and d (b, c carry no chat here).
	const registry = ["a", "b", "c", "d"].map((id, order) => ({
		id,
		name: id.toUpperCase(),
		order,
		conversations: 1,
	}));
	const ids = (next) => next.map((tag) => tag.id);
	// A registry-index swap would give a,c,b,d and d's header would not move.
	assert.deepEqual(ids(moveTagPast(registry, "d", "a", "up")), [
		"d",
		"a",
		"b",
		"c",
	]);
	assert.deepEqual(ids(moveTagPast(registry, "a", "d", "down")), [
		"b",
		"c",
		"d",
		"a",
	]);
	assert.deepEqual(moveTagPast(registry, "a", "b", "up")[0], {
		id: "a",
		name: "A",
	});
	assert.equal(moveTagPast(registry, "a", "a", "up"), null);
	assert.equal(moveTagPast(registry, "gone", "a", "up"), null);
	assert.equal(moveTagPast(registry, "a", "gone", "up"), null);
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
		tags.getState().replaceCategories(() => [{ id: "a", name: "Renamed" }]),
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

test("management writes every create, rename, reorder and delete immediately with no Apply transaction", () => {
	/*
	 * v3 (spec D2/D3): management lives on the group headers and the tag footer,
	 * through ONE registry hook. Each act is its own `tags.replace` desired state
	 * built from the store at press time; nothing is staged for an Apply.
	 */
	const registry = readFileSync(
		"src/renderer/src/features/chat/use-chat-tag-registry.ts",
		"utf8",
	);
	const header = readFileSync(
		"src/renderer/src/features/chat/components/chat-tag-header.tsx",
		"utf8",
	);
	for (const source of [registry, header]) {
		assert.ok(!source.includes("setDraft"), "no staged draft remains");
		assert.ok(!source.includes('t("ui.chat.tags.apply")'), "no Apply action");
	}
	assert.ok(
		registry.split("write((categories)").length - 1 >= 4,
		"create, rename, move and delete each commit",
	);
	assert.ok(registry.includes("await replaceCategories(derive)"));
	// The destructive path keeps a per-action confirmation, anchored, not modal.
	assert.ok(header.includes('role="alertdialog"'));
	assert.ok(header.includes('t("ui.chat.tags.delete_description"'));
	assert.ok(header.includes('t("ui.chat.tags.delete_tag")'));
	assert.ok(!header.includes("<Dialog"), "no modal dialog");
	const copy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.tag_dialogs.json", "utf8"),
	);
	for (const key of ["picker_description", "manage_description", "close"])
		assert.equal(copy[`ui.chat.tag_dialogs.${key}`], undefined);
});
test("assignment writes through the shared immediate-commit hook from an anchored popover", () => {
	const popover = readFileSync(
		"src/renderer/src/features/chat/components/chat-tag-popover.tsx",
		"utf8",
	);
	assert.ok(popover.includes("useChatTagAssignment({"));
	assert.ok(popover.includes("<PopoverAnchor virtualRef="));
	assert.ok(!popover.includes("<Dialog"), "no modal dialog");
	assert.ok(
		popover.includes('t("ui.chat.tags.shown_under", { tag: shownUnder })'),
	);
	assert.ok(popover.includes('t("ui.chat.tags.shown_untagged")'));
	// Create resolves the new tag from the registry the write returned, then
	// assigns it in the same interaction; it never waits for Apply.
	const hook = readFileSync(
		"src/renderer/src/features/chat/use-chat-tag-assignment.ts",
		"utf8",
	);
	assert.ok(hook.includes("const registry = await replaceCategories("));
	assert.ok(hook.includes("registry.find((tag) => tag.name === trimmed)"));
	assert.ok(hook.includes("await write(next, fallback)"));
	assert.ok(hook.includes("const showUnder = async"));
	assert.ok(!hook.includes('t("ui.chat.tags.apply")'));
	assert.ok(!popover.includes('t("ui.chat.tags.apply")'));
});

test("save failures are tag-specific, loading errors are not empty registries", () => {
	const registry = readFileSync(
		"src/renderer/src/features/chat/use-chat-tag-registry.ts",
		"utf8",
	);
	const hook = readFileSync(
		"src/renderer/src/features/chat/use-chat-tag-assignment.ts",
		"utf8",
	);
	const popover = readFileSync(
		"src/renderer/src/features/chat/components/chat-tag-popover.tsx",
		"utf8",
	);
	assert.ok(registry.includes('"ui.chat.tags.save_failed"'));
	assert.ok(hook.includes('"ui.chat.tags.save_failed"'));
	assert.ok(hook.includes('"ui.chat.tags.create_failed"'));
	assert.ok(popover.includes('t("ui.chat.tags.load_failed")'));
	for (const source of [registry, popover, hook])
		assert.ok(!source.includes("userFacingMessage"));
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	// The tag footer (and its empty state) waits for a settled registry.
	assert.ok(sidebar.includes("tagCategoriesError === null"));
	const copy = JSON.parse(
		readFileSync("src/i18n/catalogues/en/ui.chat.tags.json", "utf8"),
	);
	for (const key of ["manage_title", "manage", "move_menu", "none_yet", "done"])
		assert.equal(copy[`ui.chat.tags.${key}`], undefined);
});

test("opaque revision is sent only when supplied and the response revision is returned", async () => {
	canonical.setState({
		sessions: [{ ...row("aaaaaaaaaaaa", "a"), tags_revision: "0009" }],
	});
	tags.setState({ categories });
	const requests = [];
	window.api.desktop.request = async (request) => {
		requests.push(request);
		if (request.op === "sessions.tags")
			return {
				status: 200,
				body: {
					result: {
						session_id: request.sessionId,
						tags: [{ id: "b", name: "Project" }],
						primary: "b",
						tags_revision: "0010",
					},
				},
			};
		if (request.op === "tags.list")
			return { status: 200, body: { result: { tags: categories } } };
		return {
			status: 200,
			body: { result: { sessions: [], truncated: false } },
		};
	};
	const result = await tags
		.getState()
		.assignSessionTags("aaaaaaaaaaaa", ["b"], "b");
	assert.equal(result.tags_revision, "0010");
	assert.equal(
		requests.find((request) => request.op === "sessions.tags")
			.expected_revision,
		"0009",
	);
	assert.deepEqual(desktopEndpoint(requests[0]).body, {
		tags: ["b"],
		primary: "b",
		expected_revision: "0009",
	});
	canonical.setState({
		sessions: [{ ...row("aaaaaaaaaaaa", "b"), tags_revision: "0011" }],
	});
	requests.length = 0;
	await tags
		.getState()
		.assignSessionTags("aaaaaaaaaaaa", ["a"], "a", result.tags_revision);
	assert.equal(
		requests[0].expected_revision,
		"0010",
		"Undo captures the write response, not the newer catalogue",
	);
	canonical.setState({ sessions: [row("aaaaaaaaaaaa", "a")] });
	requests.length = 0;
	await tags.getState().assignSessionTags("aaaaaaaaaaaa", ["b"], "b");
	assert.equal(Object.hasOwn(requests[0], "expected_revision"), false);
});

test("409 tags_conflict reloads authoritative state and never retries the write", async () => {
	canonical.setState({
		sessions: [{ ...row("aaaaaaaaaaaa", "a"), tags_revision: "4" }],
	});
	tags.setState({ categories });
	const requests = [];
	window.api.desktop.request = async (request) => {
		requests.push(request);
		if (request.op === "sessions.tags")
			return {
				status: 409,
				body: {
					detail: {
						code: "tags_conflict",
						text: "Tags changed elsewhere",
						result: { ...row("aaaaaaaaaaaa", "b"), tags_revision: "5" },
					},
				},
			};
		return {
			status: 200,
			body: {
				result: {
					sessions: [
						{
							id: "aaaaaaaaaaaa",
							name: "Other edit",
							mtime: 1,
							tags: [{ id: "b", name: "Project" }],
							primary: "b",
							tags_revision: "5",
						},
					],
					truncated: false,
				},
			},
		};
	};
	await assert.rejects(
		tags.getState().assignSessionTags("aaaaaaaaaaaa", [], null, "4"),
		(error) => error.status === 409 && error.code === "tags_conflict",
	);
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags").length,
		1,
	);
	assert.equal(canonical.getState().sessions[0].tags_revision, "5");
	assert.equal(canonical.getState().sessions[0].primary, "b");
});

test("move helper guards edited snapshot and Undo uses the produced revision, showing conflicts visibly", async () => {
	const original = { ...row("aaaaaaaaaaaa", "a"), tags_revision: "8" };
	canonical.setState({ sessions: [{ ...original, tags_revision: "9" }] });
	tags.setState({ categories });
	globalThis.tagMoveToasts = [];
	const requests = [];
	const announcements = [];
	let conflict = false;
	window.api.desktop.request = async (request) => {
		requests.push(request);
		if (request.op === "sessions.tags") {
			if (conflict)
				return {
					status: 409,
					body: {
						detail: {
							code: "tags_conflict",
							text: "Tags changed elsewhere",
							result: { ...row("aaaaaaaaaaaa", "b"), tags_revision: "11" },
						},
					},
				};
			return {
				status: 200,
				body: {
					result: {
						...row("aaaaaaaaaaaa", "b", ["a", "b"]),
						tags_revision: "10",
					},
				},
			};
		}
		if (request.op === "tags.list")
			return { status: 200, body: { result: { tags: categories } } };
		return {
			status: 200,
			body: {
				result: {
					sessions: [
						{
							id: "aaaaaaaaaaaa",
							name: "Refreshed later",
							mtime: 1,
							tags: [{ id: "b", name: "Project" }],
							primary: "b",
							tags_revision: "11",
						},
					],
					truncated: false,
				},
			},
		};
	};
	await moveChatToTag(original, "b", (message) => announcements.push(message));
	assert.equal(
		requests[0].expected_revision,
		"8",
		"a newer canonical revision must not authorize a stale menu snapshot",
	);
	assert.equal(
		globalThis.tagMoveToasts[0].message,
		"Added “Project” and grouped under it",
	);
	conflict = true;
	globalThis.tagMoveToasts[0].options.action.onClick();
	for (
		let attempt = 0;
		attempt < 20 && globalThis.tagMoveToasts.length < 2;
		attempt++
	)
		await new Promise((resolve) => setTimeout(resolve, 1));
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags")[1]
			.expected_revision,
		"10",
	);
	assert.equal(
		globalThis.tagMoveToasts.at(-1).message,
		"Tags changed elsewhere",
	);
	assert.equal(announcements.at(-1), "Tags changed elsewhere");
	assert.equal(canonical.getState().sessions[0].tags_revision, "11");
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags").length,
		2,
		"conflicting Undo must not retry",
	);
});

test("failed move restores the source tags and reports move-specific retry guidance", async () => {
	const original = { ...row("aaaaaaaaaaaa", "a"), tags_revision: "4" };
	canonical.setState({ sessions: [original] });
	tags.setState({ categories });
	globalThis.tagMoveToasts = [];
	const requests = [];
	const announcements = [];
	window.api.desktop.request = async (request) => {
		requests.push(request);
		return {
			status: 503,
			body: { detail: { code: "store_busy", text: "Fixture write refused" } },
		};
	};
	await assert.rejects(
		moveChatToTag(original, "b", (message) => announcements.push(message)),
	);
	assert.equal(canonical.getState().sessions[0].primary, "a");
	assert.deepEqual(canonical.getState().sessions[0].tags, original.tags);
	assert.equal(
		globalThis.tagMoveToasts.at(-1).message,
		"Tags were not moved. Try again.",
	);
	assert.equal(announcements.at(-1), "Tags were not moved. Try again.");
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags").length,
		1,
	);
});
