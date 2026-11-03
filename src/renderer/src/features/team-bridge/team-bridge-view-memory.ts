import { draftTargetKey } from "./team-bridge-drafts";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeRecipient,
	type TeamBridgeScope,
	type TeamBridgeTarget,
	asTeamBridgeTenantId,
} from "./team-bridge-model";
import type { ThreadTarget } from "./team-bridge-thread-read";

/**
 * WHERE THE READER WAS IN TEAM BRIDGE, PER ACCOUNT AND PER SCOPE (operator
 * report: "when switching back to the team bridge, it doesn't remember which
 * channel/message/group etc I had selected and always defaults back to
 * general").
 *
 * ROOT CAUSE THIS EXISTS FOR. `TeamBridgePage` is a route element: leaving for
 * chat, Projects or the Library unmounts it, and every piece of "where I am"
 * state (`target`, the thread pane, the quick view, the scroll offset) lived in
 * `useState` inside it. The remount initialised `target` to `null`, and the
 * one-shot landing effect then picked #general. Only the switcher's explicit
 * scope pick survived (`team-bridge-scope-preference.ts`). This record is the
 * state that has to outlive the component, read SYNCHRONOUSLY in the page's
 * `useState` initialisers so the first paint is already the restored
 * conversation (no #general flash, and the landing effect never fires).
 *
 * WHY THIS STORE. It is the same mechanism and the same module shape as the
 * feature's existing view preference (`team-bridge-scope-preference.ts`): one
 * namespaced `localStorage` key, tolerant reads, read-modify-write merges, and
 * the storage passed in so `node:test` drives it with a fake. The scope
 * preference's note explains why the feature does not write into the unscoped
 * `ui-preferences-storage` blob; the same reasons hold here. It is a sibling
 * KEY rather than a widened value because `lo.teamBridge.scope.v1` has another
 * reader (Settings' account profile) that parses its exact shape.
 *
 * WHY IT IS SEPARATE FROM THE SCOPE PREFERENCE. The preference is "the scope
 * the reader CHOSE in the switcher" and has exactly one writer by contract.
 * This record is "the scope the reader was LOOKING AT", which also moves on a
 * notification click or a union row that switches organization. Returning to
 * the page restores where the reader was; the preference stays the default
 * for an account with no record yet.
 *
 * WHAT IS STORED: `{ "<accountId>": { scope, scopes: { "<scope>": View } } }`.
 * One View per scope, so every organization - and "All organizations" - keeps
 * its own last conversation. Ids only (conversation/account/message ids, a
 * pixel offset, and a compose draft's recipient labels the draft journal
 * already stores): never a message body. Nothing here is trusted: every
 * restored target is validated against the live list by the page and silently
 * falls back to the default landing when it no longer resolves.
 */
export const VIEW_MEMORY_KEY = "lo.teamBridge.view.v1";

export type TeamBridgeQuickView =
	| "drafts"
	| "scheduled"
	| "invitations"
	| "archived";

/**
 * The timeline's reading position: the first visible message and its offset
 * from the viewport's top edge. `null` (or absent) means "at the newest
 * message", which is the default landing - a row id survives older pages
 * being prepended where a raw `scrollTop` would not.
 */
export type TeamBridgeScrollAnchor = { messageId: string; offset: number };

export type TeamBridgeViewMemory = {
	target: TeamBridgeTarget;
	thread?: ThreadTarget | null;
	quickView?: TeamBridgeQuickView | null;
	/** Keyed by the target it was measured in, so it is never applied elsewhere. */
	scroll?: (TeamBridgeScrollAnchor & { targetKey: string }) | null;
};

const MAX_ID = 256;
const QUICK_VIEWS: readonly string[] = [
	"drafts",
	"scheduled",
	"invitations",
	"archived",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const isId = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= MAX_ID;

function readAll(storage: Pick<Storage, "getItem">): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(storage.getItem(VIEW_MEMORY_KEY) ?? "{}");
		return isRecord(value) ? value : {};
	} catch {
		return {};
	}
}

/** A stored target, re-validated field by field; anything else is `null`. */
function parseTarget(value: unknown): TeamBridgeTarget | null {
	if (!isRecord(value)) return null;
	switch (value.type) {
		case "conversation":
			return isId(value.id) ? { type: "conversation", id: value.id } : null;
		case "person":
		case "chief":
			return isId(value.accountId)
				? { type: value.type, accountId: value.accountId }
				: null;
		case "compose": {
			if (!Array.isArray(value.recipients)) return null;
			const recipients = value.recipients.flatMap(
				(row: unknown): TeamBridgeRecipient[] => {
					if (!isRecord(row) || !isId(row.accountId)) return [];
					const label = typeof row.label === "string" ? row.label : "";
					if (row.kind === "human")
						return [
							{ kind: "human" as const, accountId: row.accountId, label },
						];
					if (row.kind === "agent" && isId(row.endpointId))
						return [
							{
								kind: "agent" as const,
								accountId: row.accountId,
								endpointId: row.endpointId,
								label,
							},
						];
					return [];
				},
			);
			return { type: "compose", recipients };
		}
		default:
			return null;
	}
}

function parseView(value: unknown): TeamBridgeViewMemory | null {
	if (!isRecord(value)) return null;
	const target = parseTarget(value.target);
	if (!target) return null;
	const view: TeamBridgeViewMemory = { target };
	const thread = value.thread;
	if (
		isRecord(thread) &&
		isId(thread.tenantId) &&
		isId(thread.conversationId) &&
		isId(thread.rootId)
	)
		view.thread = {
			tenantId: thread.tenantId,
			conversationId: thread.conversationId,
			rootId: thread.rootId,
		};
	if (
		typeof value.quickView === "string" &&
		QUICK_VIEWS.includes(value.quickView)
	)
		view.quickView = value.quickView as TeamBridgeQuickView;
	const scroll = value.scroll;
	if (
		isRecord(scroll) &&
		isId(scroll.messageId) &&
		typeof scroll.targetKey === "string" &&
		typeof scroll.offset === "number" &&
		Number.isFinite(scroll.offset)
	)
		view.scroll = {
			messageId: scroll.messageId,
			offset: scroll.offset,
			targetKey: scroll.targetKey,
		};
	return view;
}

function parseScope(value: unknown): TeamBridgeScope | undefined {
	if (value === TEAM_BRIDGE_ALL_SCOPE) return TEAM_BRIDGE_ALL_SCOPE;
	return isId(value) ? asTeamBridgeTenantId(value) : undefined;
}

/** The scope this account was last looking at, or `undefined`. */
export function readLastScope(
	storage: Pick<Storage, "getItem">,
	accountId: string,
): TeamBridgeScope | undefined {
	const entry = readAll(storage)[accountId];
	return isRecord(entry) ? parseScope(entry.scope) : undefined;
}

/** The view this account last had in `scope`, or `null` when there is none. */
export function readViewMemory(
	storage: Pick<Storage, "getItem">,
	accountId: string,
	scope: TeamBridgeScope,
): TeamBridgeViewMemory | null {
	const entry = readAll(storage)[accountId];
	if (!isRecord(entry) || !isRecord(entry.scopes)) return null;
	return parseView(entry.scopes[scope]);
}

/**
 * Record the view for one scope, and the scope the reader is looking at now.
 * The two differ when a view unmounting across a scope switch flushes its last
 * position: that position belongs to the scope it was taken in, while "where
 * the reader is" has already moved on.
 * Silent on failure, like every other preference write in this feature:
 * losing a convenience must never surface as an error.
 */
export function writeViewMemory(
	storage: Storage,
	accountId: string,
	scope: TeamBridgeScope,
	view: TeamBridgeViewMemory,
	current: TeamBridgeScope = scope,
): void {
	try {
		const all = readAll(storage);
		const entry = isRecord(all[accountId]) ? all[accountId] : {};
		const scopes = isRecord(entry.scopes) ? entry.scopes : {};
		storage.setItem(
			VIEW_MEMORY_KEY,
			JSON.stringify({
				...all,
				[accountId]: { scope: current, scopes: { ...scopes, [scope]: view } },
			}),
		);
	} catch {
		/* Not persisted; the in-session view still holds. */
	}
}

/**
 * Record the scope alone - a switcher pick or a union row's organization switch
 * - so a reader who switches and leaves before anything lands returns to the
 * scope they switched to. That scope's own view, if any, is untouched.
 */
export function writeLastScope(
	storage: Storage,
	accountId: string,
	scope: TeamBridgeScope,
): void {
	try {
		const all = readAll(storage);
		const entry = isRecord(all[accountId]) ? all[accountId] : {};
		storage.setItem(
			VIEW_MEMORY_KEY,
			JSON.stringify({ ...all, [accountId]: { ...entry, scope } }),
		);
	} catch {
		/* Not persisted; the in-session scope still holds. */
	}
}

/** The thread to reopen with `view`, only when it belongs to its conversation. */
export function rememberedThread(
	view: TeamBridgeViewMemory | null,
): ThreadTarget | null {
	if (!view?.thread || view.target.type !== "conversation") return null;
	return view.thread.conversationId === view.target.id ? view.thread : null;
}

/** The reading position to restore for `target`, or `null` for "newest". */
export function rememberedScroll(
	view: TeamBridgeViewMemory | null,
	target: TeamBridgeTarget | null,
): TeamBridgeScrollAnchor | null {
	if (!view?.scroll || !target) return null;
	return view.scroll.targetKey === draftTargetKey(target)
		? { messageId: view.scroll.messageId, offset: view.scroll.offset }
		: null;
}
