/** A workspace tab describes what can be opened, not a router or pane mount key. */
export type WorkspaceTarget =
	| { kind: "draft"; id: string }
	| { kind: "session"; id: string };

export type WorkspaceTab = {
	key: string;
	target: WorkspaceTarget;
	pinned: boolean;
};

/**
 * What a launch restores for one tab.
 *
 * `title` is the conversation's LAST-KNOWN name, so a restored strip can draw
 * real names in its first frame (operator, 2026-11-24: on launch every restored
 * tab read "New chat" until the catalogue page landed, and a tab whose
 * conversation sat below that page stayed "New chat" until opened). It is a
 * display hint only, never an authority: the live catalogue row and the open
 * conversation's header both outrank it, and it is overwritten whenever they
 * resolve. Optional so state written before it existed still loads.
 */
export type SavedWorkspaceTab = { id: string; pinned: boolean; title?: string };

/** Long enough for any real title; bounds what a hand-edited blob can inject. */
const SAVED_TITLE_MAX = 300;

/** A usable remembered title, or undefined for blank, non-string or absent. */
export function savedWorkspaceTitle(value: unknown): string | undefined {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	if (!trimmed) return;
	return trimmed.slice(0, SAVED_TITLE_MAX);
}

/**
 * What a tab's title slot draws: a name, a loading placeholder, or the
 * existing "New chat" fallback.
 *
 * WHY "loading" EXISTS: before the first catalogue answer a session tab with no
 * remembered name is genuinely UNKNOWN, and calling it "New chat" claims it is
 * empty. Once the catalogue has answered (or failed) the tab settles to the
 * fallback instead of spinning forever - an absent row then means the
 * conversation is below the page or gone, and opening the tab resolves it.
 * Drafts are always "New chat"; they are the one honest use of that label.
 */
export type WorkspaceTabTitle =
	| { kind: "title"; text: string }
	| { kind: "loading" }
	| { kind: "fallback" };

export function resolveWorkspaceTabTitle(input: {
	target: WorkspaceTarget;
	/** The open conversation's header title, for the active tab only. */
	activeTitle?: string | null;
	catalogueTitle?: string | null;
	/** Names seen earlier in this run (the strip's in-memory map). */
	sessionTitle?: string | null;
	/** The name persisted with the tab by the previous run. */
	savedTitle?: string | null;
	/** True once the catalogue has answered or failed at least once. */
	catalogueSettled: boolean;
}): WorkspaceTabTitle {
	for (const candidate of [
		input.activeTitle,
		input.target.kind === "session" ? input.catalogueTitle : undefined,
		input.sessionTitle,
		input.target.kind === "session" ? input.savedTitle : undefined,
	]) {
		const text = savedWorkspaceTitle(candidate);
		if (text) return { kind: "title", text };
	}
	if (input.target.kind === "session" && !input.catalogueSettled)
		return { kind: "loading" };
	return { kind: "fallback" };
}

export function sameWorkspaceTarget(
	a: WorkspaceTarget | undefined,
	b: WorkspaceTarget | undefined,
): boolean {
	return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export function workspaceTarget(
	activeDraftKey: string | null,
	activeSessionId: string | null,
	drafts: Readonly<Record<string, { sessionId?: string }>>,
): WorkspaceTarget | undefined {
	const session = activeDraftKey
		? drafts[activeDraftKey]?.sessionId
		: activeSessionId;
	if (session) return { kind: "session", id: session };
	if (activeDraftKey && drafts[activeDraftKey]) {
		return { kind: "draft", id: activeDraftKey };
	}
}

export function makeWorkspaceTab(target: WorkspaceTarget): WorkspaceTab {
	return { key: `${target.kind}:${target.id}`, target, pinned: false };
}

export function displayedWorkspaceTabs(tabs: readonly WorkspaceTab[]) {
	return [
		...tabs.filter((tab) => tab.pinned),
		...tabs.filter((tab) => !tab.pinned),
	];
}

/** Consume the draft's own admission pointer, including a send that finishes in the background. */
export function syncWorkspaceTabs(
	tabs: WorkspaceTab[],
	active: WorkspaceTarget | undefined,
	drafts: Readonly<Record<string, { sessionId?: string }>>,
	priorDrafts: Readonly<Record<string, { sessionId?: string }>> = drafts,
): WorkspaceTab[] {
	let result = tabs;
	for (const tab of tabs) {
		if (tab.target.kind !== "draft") continue;
		const { id } = tab.target;
		const admitted = drafts[id]?.sessionId ?? priorDrafts[id]?.sessionId;
		if (admitted) {
			const target = { kind: "session", id: admitted } as const;
			const duplicate = result.find((item) =>
				sameWorkspaceTarget(item.target, target),
			);
			result = result.flatMap((item) => {
				if (item.key === tab.key)
					return [
						{
							...tab,
							target,
							pinned: tab.pinned || (duplicate?.pinned ?? false),
						},
					];
				return item === duplicate ? [] : [item];
			});
		} else if (!drafts[id]) {
			// Prune a tab whose draft was discarded elsewhere; this never discards it.
			result = result.filter((item) => item.key !== tab.key);
		}
	}
	if (!active || result.some((tab) => sameWorkspaceTarget(tab.target, active)))
		return result;
	const tab = makeWorkspaceTab(active);
	// Targeted drafts can reuse a canonical draft id after admission. The old
	// tab keeps its instance key, lane and focus; only the new tab needs a key.
	const occupied = new Set(result.map(({ key }) => key));
	const base = tab.key;
	for (let ordinal = 2; occupied.has(tab.key); ordinal++)
		tab.key = `${base}:${ordinal}`;
	return [...result, tab];
}

export function moveWorkspaceTab(
	tabs: WorkspaceTab[],
	from: string,
	to: string,
) {
	const source = tabs.findIndex((tab) => tab.key === from);
	const target = tabs.findIndex((tab) => tab.key === to);
	if (
		source < 0 ||
		target < 0 ||
		source === target ||
		tabs[source].pinned !== tabs[target].pinned
	)
		return tabs;
	const next = [...tabs];
	next.splice(source, 1);
	next.splice(target, 0, tabs[source]);
	return next;
}

export function workspaceNeighbor(tabs: readonly WorkspaceTab[], key: string) {
	const ordered = displayedWorkspaceTabs(tabs);
	const at = ordered.findIndex((tab) => tab.key === key);
	return at < 0 ? undefined : (ordered[at + 1] ?? ordered[at - 1]);
}

/** The bulk closes the per-tab menu offers, relative to the tab it opened on. */
export type WorkspaceBulkClose = "others" | "left" | "right" | "all";

/**
 * Keys a bulk close removes, in displayed order.
 *
 * WHY PINS SURVIVE: pinning is the strip's "keep this" contract - auto-close
 * skips pins for the same reason - and browsers' "close other tabs / to the
 * right" spare pinned tabs too. Only the explicit per-tab "Close tab" (or an
 * unpin) can remove a pinned tab. An empty result is the menu's cue to disable
 * the item rather than offer a no-op. `key` may name no tab only for "all".
 *
 * WHY `rtl` IS AN ARGUMENT: "left" and "right" name what the user SEES. The
 * strip renders displayed order along the inline axis, so in a right-to-left
 * layout the visual left is the logical END. The caller reads the strip's
 * computed direction; this stays a pure function so the rule is unit-testable.
 */
export function workspaceBulkCloseKeys(
	tabs: readonly WorkspaceTab[],
	key: string,
	action: WorkspaceBulkClose,
	rtl: boolean,
): string[] {
	const ordered = displayedWorkspaceTabs(tabs);
	const at = ordered.findIndex((tab) => tab.key === key);
	// "all" is also the strip-level command, which has no anchor tab.
	if (at < 0 && action !== "all") return [];
	const logicalBefore = (action === "left") !== rtl;
	return ordered
		.filter((tab, index) => {
			if (tab.pinned) return false;
			if (action === "all") return true;
			if (action === "others") return index !== at;
			return logicalBefore ? index < at : index > at;
		})
		.map((tab) => tab.key);
}

const SESSION_ID = /^[a-f0-9]{12}$/;

export function sanitizeSavedWorkspaceTabs(
	value: unknown,
): SavedWorkspaceTab[] {
	if (!Array.isArray(value)) return [];
	const saved = new Map<string, SavedWorkspaceTab>();
	for (const row of value) {
		if (
			typeof row?.id !== "string" ||
			!SESSION_ID.test(row.id) ||
			typeof row.pinned !== "boolean" ||
			saved.has(row.id)
		)
			continue;
		const title = savedWorkspaceTitle(row.title);
		saved.set(
			row.id,
			title
				? { id: row.id, pinned: row.pinned, title }
				: { id: row.id, pinned: row.pinned },
		);
	}
	return [...saved.values()];
}

/**
 * The persisted form of the strip. `titleOf` names each session's best-known
 * title (catalogue row, else what was saved before); a tab it cannot name is
 * saved without one rather than with a placeholder.
 */
export function saveWorkspaceTabs(
	tabs: readonly WorkspaceTab[],
	titleOf: (id: string) => string | null | undefined = () => undefined,
): SavedWorkspaceTab[] {
	return tabs.flatMap(({ target, pinned }) => {
		if (target.kind !== "session") return [];
		const title = savedWorkspaceTitle(titleOf(target.id));
		return [
			title ? { id: target.id, pinned, title } : { id: target.id, pinned },
		];
	});
}

/**
 * The header title the tab strip may use for the ACTIVE tab: a REAL name or
 * null, never the header's own placeholder.
 *
 * WHY (QA #2099 Q1B-F1): the header falls back to "Untitled chat" while the
 * catalogue has not answered (and forever for a conversation below page one).
 * `resolveWorkspaceTabTitle` ranks the header first, so feeding it that
 * placeholder beat the tab's saved name on launch, and recording it would
 * have saved a placeholder as if it were a title. A staged draft with no
 * conversation keeps its own sentence (`draftSentence`): that is the honest
 * label for a tab that is genuinely a new chat.
 */
export function workspaceHeaderTitle(input: {
	draftSentence?: string | null;
	liveTitle?: string | null;
	catalogueTitle?: string | null;
}): string | null {
	return (
		savedWorkspaceTitle(input.draftSentence) ??
		savedWorkspaceTitle(input.liveTitle) ??
		savedWorkspaceTitle(input.catalogueTitle) ??
		null
	);
}

/**
 * The persisted strip with each tab's BEST-KNOWN title, from every source this
 * run has seen.
 *
 * WHY THREE SOURCES (operator, 2026-11-24: mid-session, tabs that had real
 * names blanked to "New chat" while their neighbours kept theirs). The head
 * catalogue page is rebuilt from each answer (`headAnswerRows` keeps only the
 * ACTIVE session beyond the page), so as other conversations take activity an
 * inactive tab's row falls off page one and `rows` stops naming it. The
 * previously saved title must then stand, never be overwritten with nothing.
 * And a conversation that was never ON page one (QA #2099 Q1C-F1) has no row
 * at all, so the open pane's REAL header title (`seen`, keyed by tab key) is
 * the only name it ever gets; it is recorded here so the next launch has it.
 *
 * Precedence: catalogue row (follows renames everywhere) > header title seen
 * this run > what was saved before. A tab none of them name saves no title.
 */
export function saveWorkspaceTabsWithTitles(
	tabs: readonly WorkspaceTab[],
	sources: {
		rows: ReadonlyMap<string, string | null | undefined>;
		seen: Readonly<Record<string, string>>;
		prior: readonly SavedWorkspaceTab[];
	},
): SavedWorkspaceTab[] {
	const prior = new Map(sources.prior.map((row) => [row.id, row.title]));
	return saveWorkspaceTabs(
		tabs,
		(id) =>
			savedWorkspaceTitle(sources.rows.get(id)) ??
			savedWorkspaceTitle(
				sources.seen[makeWorkspaceTab({ kind: "session", id }).key],
			) ??
			prior.get(id),
	);
}

/**
 * Session tabs that NO source can name, and that have not been looked up yet
 * this run.
 *
 * WHY (operator, 2026-11-25: "I'm still ending up with 'New chat' tabs after
 * some time"). Their strip held a session tab saved with no title whose
 * conversation DOES have a stored title, but sat ~290 rows deep in activity
 * order - far below the 50-row head page - and was not the active tab. Row,
 * header and saved title were all empty, so after the catalogue settled the
 * tab drew "New chat" for the whole run and saved nothing for the next one.
 * A tab whose name is missing from every local source must ASK for it (the
 * caller reads the session's snapshot, which carries the stored title since
 * Core #4576) rather than settle to a label that claims the chat is empty.
 *
 * CONSTRAINTS. Only once the catalogue has settled (until then the row may
 * still arrive, and the tab is already drawing its loading state); never a
 * draft (a draft genuinely is a new chat); and at most once per session per
 * run (`attempted`), so a conversation with no title, a deleted one, or a
 * failing read costs one request rather than a loop.
 */
export function workspaceTabsAwaitingTitle(input: {
	tabs: readonly WorkspaceTab[];
	rows: ReadonlyMap<string, string | null | undefined>;
	seen: Readonly<Record<string, string>>;
	saved: readonly SavedWorkspaceTab[];
	catalogueSettled: boolean;
	attempted: ReadonlySet<string>;
}): { key: string; id: string }[] {
	if (!input.catalogueSettled) return [];
	const saved = new Map(input.saved.map((row) => [row.id, row.title]));
	return input.tabs.flatMap(({ key, target }) => {
		if (target.kind !== "session" || input.attempted.has(target.id)) return [];
		const named =
			savedWorkspaceTitle(input.rows.get(target.id)) ??
			savedWorkspaceTitle(input.seen[key]) ??
			savedWorkspaceTitle(saved.get(target.id));
		return named ? [] : [{ key, id: target.id }];
	});
}

/**
 * The stored conversation title out of a `sessions.get` snapshot answer, or
 * null. Core fills a cold snapshot's blank `conversation_title` from the same
 * resolver the catalogue row uses (Core #4576), so the tab and the sidebar
 * agree. Defensive like `sessionCwdFromSnapshot`: the document is not part of
 * the typed contract, and a missing layer means "no name", never a throw.
 */
export function snapshotConversationTitle(snapshot: unknown): string | null {
	const payload = (snapshot as { payload?: unknown } | null | undefined)
		?.payload;
	const frontend = (payload as { frontend?: unknown } | null | undefined)
		?.frontend;
	const state = (frontend as { snapshot?: unknown } | null | undefined)
		?.snapshot;
	return (
		savedWorkspaceTitle(
			(state as { conversation_title?: unknown } | null | undefined)
				?.conversation_title,
		) ?? null
	);
}

/** Whether two persisted strips differ in anything a launch would restore. */
export function savedWorkspaceTabsDiffer(
	a: readonly SavedWorkspaceTab[],
	b: readonly SavedWorkspaceTab[],
): boolean {
	return (
		a.length !== b.length ||
		a.some(
			(row, i) =>
				row.id !== b[i].id ||
				row.pinned !== b[i].pinned ||
				row.title !== b[i].title,
		)
	);
}

/** Observe the existing route without constructing a second navigation path. */
export function workspaceSessionPathMatches(path: string, id: string): boolean {
	return path.startsWith("/chat/") && path.slice("/chat/".length) === id;
}
