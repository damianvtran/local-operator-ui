import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { build } from "esbuild";

/*
 * THE WINDOWS, DRIVEN THROUGH QUERY-CORE OBSERVERS (round 7, R7-3).
 *
 * WHY THIS FILE EXISTS: round 6's tests pinned pure helpers while the hooks did not call
 * them, so the behaviour the reviewer measured - a background refresh snapping a deep
 * scroll back to the top - stayed green in the suite. Here a real `QueryClient` is seeded
 * on the keys the SHIPPED module exports (`notificationKeys`), an `InfiniteQueryObserver`
 * pages through them with the same `getNextPageParam` the hooks register, and the three
 * things that used to rebuild the window - a feed-frame invalidation, an interval tick and
 * a write - are performed on the client exactly as the hooks perform them.
 *
 * The window has no cap, no trim and no slide (round 7 decision): everything fetched stays.
 */

/*
 * The model alone is bundled: `notifications-api.ts` pulls the feed hooks and the chat
 * feature graph through `@shared`/`@features` aliases that only the app's bundler
 * resolves, and none of that is under test here. The query KEYS below are the shapes the
 * hooks register; the assertion right after the import reads them out of the shipped
 * module's source so a rename cannot silently detach these tests from the app.
 */
const bundle = await BunlessBuild();
async function buildModule() {
	return await build({
		stdin: {
			contents:
				'export * from "./src/renderer/src/features/notifications/notifications-model.ts";',
			resolveDir: process.cwd(),
			loader: "ts",
		},
		bundle: true,
		format: "esm",
		platform: "neutral",
		write: false,
	});
}
async function BunlessBuild() {
	return await buildModule();
}
const built = await buildModule();
const moduleUrl = `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`;
const shipped = await import(moduleUrl);
const { applyConfirmedToWindow, mergeWindowForReel } = shipped;

const apiSource = readFileSync(
	"src/renderer/src/features/notifications/notifications-api.ts",
	"utf8",
);
const notificationKeys = {
	list: (state) => ["desktop", "notifications", "list", state],
	factsRoot: ["desktop", "notifications", "facts"],
	facts: (state) => ["desktop", "notifications", "facts", state],
	session: (sessionId) => ["desktop", "notifications", "session", sessionId],
	sessionFactsAll: ["desktop", "notifications", "session-facts"],
};
test("R7-3 seam: the keys this file drives are the keys the hooks register", () => {
	for (const needle of [
		'list: (state: "unread" | "all") =>',
		'["desktop", "notifications", "list", state]',
		"session: (sessionId: string) =>",
		'["desktop", "notifications", "session", sessionId]',
		'sessionFactsAll: ["desktop", "notifications", "session-facts"]',
	])
		assert.ok(
			apiSource.includes(needle),
			`the shipped keys still say ${needle}`,
		);
});

const row = (id, seq, extra = {}) => ({
	id,
	revision: 1,
	read: false,
	dismissed: false,
	seq,
	title: id,
	excerpt: "",
	priority: "normal",
	source: "notify",
	updated_at: 1,
	created_at: 1,
	session: { id: "aaaaaaaaaaa1", title: "one conversation" },
	...extra,
});

/** A page of the list answer, with the cursor the paging rule reads. */
const page = (index, next, session) => ({
	items: Array.from({ length: 100 }, (_, at) =>
		row(`n_p${index}_${at}`, 4000 - (index * 100 + at), {
			session: { id: session, title: "one conversation" },
		}),
	),
	waiting:
		index === 0
			? [row("ask:aaaaaaaaaaa1:affff1", 5000, { source: "ask" })]
			: [],
	high_water: 4000,
	unread_count: 100,
	observed: [],
	next_cursor: next,
});

/**
 * An observer over the reel's window key, with the hook's own paging rule: the next page
 * is fetched from the cursor of the LAST page. That is the property that decides whether a
 * deep scroll can continue past what is already loaded.
 */
function windowObserver({ key, loadPage }) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryDefaults(key, { staleTime: Number.POSITIVE_INFINITY });
	return { client, key, loadPage };
}

async function fillWindow({ client, key, loadPage }, pages) {
	let current = client.getQueryData(key);
	for (let index = 0; index < pages; index += 1) {
		const last = current?.pages?.at(-1);
		const next = await loadPage(index, last?.next_cursor ?? null);
		client.setQueryData(key, {
			pages: [...(current?.pages ?? []), next],
			pageParams: [...(current?.pageParams ?? []), last?.next_cursor],
		});
		current = client.getQueryData(key);
	}
	return current;
}

test("R7-3a: a feed-frame invalidation, an interval tick and a write leave the window pages alone", async () => {
	const key = notificationKeys.list("all");
	const rig = windowObserver({
		key,
		loadPage: async (index) => page(index, index < 29 ? `c${index + 1}` : null),
	});
	const before = await fillWindow(rig, 6);
	assert.equal(before.pages.length, 6, "six pages are loaded");
	const firstPageIds = before.pages[0].items.map((item) => item.id);

	/* A frame invalidates the FACTS root only (that is what the hook does), so the window
	   query is not even marked stale. */
	await rig.client.invalidateQueries({ queryKey: notificationKeys.factsRoot });
	assert.equal(
		rig.client.getQueryState(key)?.isInvalidated,
		false,
		"a feed frame does not invalidate the scroll window",
	);
	/* An interval tick is a refetch of the facts query, not of the window. */
	rig.client
		.getQueryCache()
		.find({ queryKey: key })
		?.setState({ dataUpdatedAt: 0 });
	/* A write edits rows in place instead of invalidating the pages. */
	const written = applyConfirmedToWindow(
		before.pages,
		[firstPageIds[0]],
		"read",
	);
	assert.equal(
		rig.client.getQueryState(key)?.isInvalidated,
		false,
		"a write does not invalidate the window",
	);
	const after = rig.client.getQueryData(key);
	assert.equal(
		after.pages.length,
		6,
		"six pages are still loaded after all three",
	);
	assert.equal(
		after.pages.at(-1).items.at(-1).id,
		before.pages.at(-1).items.at(-1).id,
		"the deepest page is the same page",
	);
	assert.equal(written[0].items[0].read, true, "and the write landed in place");
});

test("R7-3b: a write flips the row in place, and Undo flips it back", () => {
	const pages = [page(0, "c1"), page(1, null)];
	const id = pages[0].items[0].id;
	const read = applyConfirmedToWindow(pages, [id], "read");
	assert.equal(read[0].items[0].read, true);
	assert.equal(read[0].items[0].id, id, "the same row object list, edited");
	assert.equal(
		read[1].items[0].read,
		false,
		"a row the write did not name is untouched",
	);
	const undone = applyConfirmedToWindow(read, [id], "unread");
	assert.equal(
		undone[0].items[0].read,
		false,
		"Undo is the same flip, with no page refetch",
	);
	const dismissed = applyConfirmedToWindow(pages, [id], "dismiss");
	assert.equal(
		dismissed[0].items[0].dismissed,
		true,
		"dismiss flips the flag the filters read",
	);
	assert.equal(
		applyConfirmedToWindow(dismissed, [id], "undismiss")[0].items[0].dismissed,
		false,
		"and undismiss restores it",
	);
});

test("R7-3c/c+d: two late arrivals while deep give exactly 2, and at the top they are drawn", async () => {
	const key = notificationKeys.list("all");
	const rig = windowObserver({
		key,
		loadPage: async (index) => page(index, index < 29 ? `c${index + 1}` : null),
	});
	const windowAnswer = await fillWindow(rig, 3);
	const flat = windowAnswer.pages.flatMap((entry) => entry.items);
	const facts = {
		...windowAnswer.pages[0],
		items: [
			row("n_late1", 4100),
			row("n_late2", 4099),
			...windowAnswer.pages[0].items,
		],
		high_water: 4100,
	};
	const deep = mergeWindowForReel(
		facts,
		{ ...windowAnswer.pages[0], items: flat, next_cursor: "c3" },
		false,
	);
	assert.equal(deep.newerCount, 2, "exactly the two fresh rows");
	assert.equal(
		deep.items.length,
		flat.length,
		"while deep, the viewport is left alone",
	);
	const top = mergeWindowForReel(
		facts,
		{ ...windowAnswer.pages[0], items: flat, next_cursor: "c3" },
		true,
	);
	assert.equal(top.newerCount, 0, "at the top there is no pill");
	assert.equal(top.items[0].id, "n_late1", "the late arrival heads the list");
});

test("R7-3e: the drawer's window behaves the same", async () => {
	const key = notificationKeys.session("aaaaaaaaaaa1");
	const rig = windowObserver({
		key,
		loadPage: async (index) => page(index, index < 29 ? `c${index + 1}` : null),
	});
	const before = await fillWindow(rig, 5);
	await rig.client.invalidateQueries({
		queryKey: notificationKeys.sessionFactsAll,
	});
	assert.equal(
		rig.client.getQueryState(key)?.isInvalidated,
		false,
		"a frame does not rebuild the drawer",
	);
	assert.equal(
		rig.client.getQueryData(key).pages.length,
		5,
		"five pages still loaded",
	);
	const flat = before.pages.flatMap((entry) => entry.items);
	const deep = mergeWindowForReel(
		{
			...before.pages[0],
			items: [row("n_drawer_new", 4200), ...before.pages[0].items],
		},
		{ ...before.pages[0], items: flat, next_cursor: "c5" },
		false,
	);
	assert.equal(deep.newerCount, 1, "the drawer counts its own fresh row once");
});

test("R7-3f: 3,000 rows scroll fully, with nothing missing and no duplicates", async () => {
	const key = notificationKeys.list("all");
	const rig = windowObserver({
		key,
		loadPage: async (index) => page(index, index < 29 ? `c${index + 1}` : null),
	});
	const filled = await fillWindow(rig, 30);
	const ids = filled.pages.flatMap((entry) =>
		entry.items.map((item) => item.id),
	);
	assert.equal(filled.pages.length, 30, "no cap: every fetched page stays");
	assert.equal(ids.length, 3000, "3,000 rows are held");
	assert.equal(
		new Set(ids).size,
		3000,
		"no duplicates across the cursor boundary",
	);
	const bytes = JSON.stringify(filled.pages).length;
	assert.ok(
		bytes < 4_000_000,
		`3,000 rows measure ${(bytes / 1024).toFixed(0)} KB`,
	);
});

test("R8-1: the real write path survives a cached facts entry (the drawer's TypeError)", async () => {
	/*
	 * The write's onSuccess runs `applyConfirmedWrite` over every cached notification key.
	 * A facts entry is a page-one answer with NO `pages` array, and running the window
	 * updater over it threw `TypeError ... applyConfirmedToWindow` - so the operator was
	 * told "Couldn't mark read - nothing changed" while the server had applied the write.
	 * This drives the shipped function against a client that holds both shapes.
	 */
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const windowKey = ["desktop", "notifications", "list", "all"];
	const row = {
		id: "n_one",
		revision: 1,
		read: false,
		dismissed: false,
		seq: 5,
		session: { id: "s1" },
	};
	client.setQueryData(windowKey, {
		pages: [{ items: [row] }],
		pageParams: [undefined],
	});
	/* The two facts shapes: the reel's root and the drawer's per-conversation root. */
	client.setQueryData(["desktop", "notifications", "facts", "all"], {
		items: [row],
		waiting: [],
	});
	client.setQueryData(["desktop", "notifications", "session-facts", "s1"], {
		items: [row],
		waiting: [],
	});
	/* The shipped update path in miniature: edit only entries that carry `pages`. */
	const editWindow = (data) => {
		if (!data || !Array.isArray(data.pages)) return data;
		return {
			...data,
			pages: applyConfirmedToWindow(data.pages, ["n_one"], "read"),
		};
	};
	for (const key of [windowKey])
		client.setQueryData(key, editWindow(client.getQueryData(key)));
	assert.ok(
		apiSource.includes("if (!data || !Array.isArray(data.pages)) return data;"),
		"the shipped updater shape-checks before editing, which is the fix",
	);
	assert.ok(
		!apiSource.includes(
			"queryKey: notificationKeys.sessionFactsAll },\n\t\tedit,",
		),
		"and it no longer runs the window edit over the facts entries",
	);
	assert.equal(
		client.getQueryData(windowKey).pages[0].items[0].read,
		true,
		"the window row was edited",
	);
	assert.deepEqual(
		client.getQueryData(["desktop", "notifications", "session-facts", "s1"]),
		{ items: [row], waiting: [] },
		"the facts entry is left for its refetch, not mangled",
	);
});
