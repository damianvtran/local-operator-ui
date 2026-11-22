/** A workspace tab describes what can be opened, not a router or pane mount key. */
export type WorkspaceTarget =
	| { kind: "draft"; id: string }
	| { kind: "session"; id: string };

export type WorkspaceTab = {
	key: string;
	target: WorkspaceTarget;
	pinned: boolean;
};

export type SavedWorkspaceTab = { id: string; pinned: boolean };

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
		saved.set(row.id, { id: row.id, pinned: row.pinned });
	}
	return [...saved.values()];
}

export function saveWorkspaceTabs(
	tabs: readonly WorkspaceTab[],
): SavedWorkspaceTab[] {
	return tabs.flatMap(({ target, pinned }) =>
		target.kind === "session" ? [{ id: target.id, pinned }] : [],
	);
}

/** Observe the existing route without constructing a second navigation path. */
export function workspaceSessionPathMatches(path: string, id: string): boolean {
	return path.startsWith("/chat/") && path.slice("/chat/".length) === id;
}
