import { randomBytes, randomUUID } from "node:crypto";
import type { DriveableView } from "./electron-types";
import { BrowserHostError } from "./errors";
import type { PersistedTab } from "./session-store";
import type { SnapshotRef } from "./vendor/driver/ax-compact";

/**
 * The tab registry: the main process's one truth about what browser tabs exist.
 *
 * Design: docs/design/ui-browser-tab.md 6.2 (the registry), 6.3 (ownership and
 * hand-over), 6.4 (concurrency), 6.5 (caps), 7.3 (restore and stale handles).
 *
 * WHY one Map here and no parallel truth in the renderer: two actors address the
 * same tabs — the user through the chrome, an agent through the session leg — and
 * two registries that can disagree is how a tab gets closed twice, or a handle
 * keeps naming a tab that is gone. The renderer gets a projection over IPC and
 * sends intents; every decision is made here.
 *
 * WHY the token is `ui:<tabId>:<nonce>` and not the tabId: the tabId is a name,
 * the nonce is the capability. An agent that learns a tab's number by listing
 * tabs must not thereby be able to drive it (the extension makes the same
 * argument at `commands/nav.ts:169`, and the session redacts handles for exactly
 * this reason). A token with a wrong or stale nonce is refused, and that refusal
 * is what makes "handed to you" a real transfer rather than a courtesy.
 */

/** What a tab's owner is. A restored tab is always `user` (design 7.3). */
export type TabOwner = "user" | "agent";

/** A rectangle in CSS pixels, as the renderer measures its content area. */
export interface ContentRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TabRecord {
	/** Host-minted, monotonic, stable for the tab's life. The `<n>` in the
	 * surface token; the only id either actor is shown. */
	tabId: number;
	view: DriveableView;
	owner: TabOwner;
	/** Which lop session owns it, when `owner === "agent"`. */
	sessionId: string | null;
	/**
	 * The conversation the tab was OPENED IN, which a hand-over does not move and a
	 * revocation restores (design §5.1 row 6 / open question 2(b); review round 1, Q2).
	 *
	 * WHY ITS OWN FIELD rather than reading `handedTo` before nulling it: `sessionId`
	 * is a SCOPING field — `tabsInScope`, the `tabs` listing's ownership check and
	 * `mayDrive` all read it — so a revocation that set it to null deleted the fact that
	 * the tab belongs to a conversation, and the user's tab left `This conversation`
	 * and reappeared under `No conversation` for no reason the user could see. The home
	 * is set once at `create` (the session id the host was created with, or null for the
	 * route and a draft, which have no conversation) and is never rewritten: a
	 * hand-over makes a tab an agent's without changing where it lives, so revoking it is
	 * a true inverse.
	 *
	 * A restored tab's home is null for the same reason its `sessionId` is (`restored`
	 * below): a tab that comes back from `session.json` is the user's full stop, and the
	 * file carries no conversation for it (design 7.3).
	 */
	homeSessionId: string | null;
	/** The capability. Null for a user tab that was never handed over, and null
	 * for EVERY restored tab (design 7.3: a nonce is never re-issued across a
	 * restart). */
	nonce: string | null;
	/** The session a user tab has been handed to (design 6.3), or null. */
	handedTo: string | null;
	restored: boolean;
	/**
	 * The `session.json` row a restored tab was allocated from, kept until the tab
	 * has a history of its own.
	 *
	 * WHY the record carries it (review round 2, B2): a restored view has NO
	 * history until its page commits, so a capture taken in that window — the
	 * restore's own change notification, or a quit a second after launch — used to
	 * find nothing for that tab and write a session file without it. The tab was
	 * then dropped for good by the next write. `captureTabs` consults this row as
	 * the fallback for a tab whose live history is not restorable yet, so no
	 * capture can be a partial one. It is dropped with the record, and it holds
	 * URLs and page state only: nothing here is authority (design 7.3 — a restored
	 * tab has no nonce and never regains one).
	 */
	restoreRow?: PersistedTab;
	createdAt: number;
	lastUsedAt: number;
	/** The navigation epoch refs are stamped with, and the current ref table for
	 * this tab. Per-TAB, not global: one tab's snapshot must never supply
	 * another tab's click target (the extension's `state.ts` keeps refs per
	 * surface for the same reason). */
	epoch: number;
	/** Same-document URL changes invalidate refs, not document-scoped consent. */
	documentEpoch: number;
	/** Mirrors what `applyLayout` last told the view. The capture path branches on
	 * this because Electron's `View` has no visibility getter to read back. */
	presented: boolean;
	refs: Record<string, SnapshotRef>;
	/** Ownership-journal linkage for the `owner_*` methods, empty for a tab
	 * opened without an allocation. */
	allocationId: string;
	/** A close that could not complete is a retryable obligation, never proof
	 * the view is gone. */
	cleanupPending?: boolean;
}

/** Hard ceiling on concurrently-driven AGENT tabs, mirroring the extension's
 * `MAX_SURFACES = 8` (`extension/src/state.ts:12`).
 *
 * The reasoning transfers unchanged: parallel sessions each open their own tab,
 * and nothing else bounds how many an agent fleet can open. User tabs are NOT
 * capped (design 6.5) — a user opening a dozen tabs is their business, and the
 * honest bound on those is memory, which `status` reports rather than a second
 * invented number. */
export const MAX_AGENT_TABS = 8;

/** Background rendering must not depend on a foreground route's measurement.
 * The fleet cap and bounded viewport bound raster memory without activating views. */
export const BACKGROUND_VIEWPORT: ContentRect = {
	x: 0,
	y: 0,
	width: 1280,
	height: 720,
};

/** How many nonce characters a redacted handle shows. Enough to prefix-match
 * your own token against a listing entry, far too few to reconstruct the 32-hex
 * nonce (26 characters of entropy stay hidden). */
const REDACTED_NONCE_CHARS = 6;

/** The surface-token prefix this host owns. `ui:` is the design's choice
 * (10.5); `bridge:` belongs to the extension and `cmux` to the panel. */
export const SURFACE_PREFIX = "ui";

export interface ParsedSurface {
	tabId: number;
	nonce: string;
}

/** The surface token for a tab, or null for one that has no capability yet. */
export function surfaceToken(record: TabRecord): string | null {
	if (!record.nonce) return null;
	return `${SURFACE_PREFIX}:${record.tabId}:${record.nonce}`;
}

/** The surface-token grammar, anchored. Module scope: it is tested on every
 * command that carries a handle. */
const SURFACE_TOKEN = /^ui:(\d+):([A-Za-z0-9_-]+)$/;

export function parseSurface(token: unknown): ParsedSurface | null {
	if (typeof token !== "string") return null;
	// Anchored, and split on the FIRST two colons only: a nonce cannot contain
	// one, and a permissive match would let `ui:1:abc:def` name tab 1.
	const match = SURFACE_TOKEN.exec(token);
	if (!match) return null;
	const tabId = Number(match[1]);
	if (!Number.isSafeInteger(tabId)) return null;
	return { tabId, nonce: match[2] };
}

/** A display-safe form of a handle: `ui:<tabId>:<nonce[0..6]>…`.
 *
 * Every handle that leaves this host OTHER than the caller's own `open` response
 * uses this — the `tabs` listing, the `tab_limit` refusal, the ambiguous-close
 * refusal, `status`. The full token IS the drive capability, so listing it would
 * hand every session control of every tab. The redacted prefix still lets a
 * caller recognise its OWN tab by prefix-matching the token it was given. */
export function redactToken(token: string): string {
	const parsed = parseSurface(token);
	if (!parsed) return token;
	return `${SURFACE_PREFIX}:${parsed.tabId}:${parsed.nonce.slice(0, REDACTED_NONCE_CHARS)}…`;
}

/** Whether `fullToken` (a caller's own handle) names the tab a redacted listing
 * entry describes. The trailing ellipsis marks redaction; matching is a plain
 * prefix test on the un-ellipsised part. */
export function ownsRedacted(fullToken: string, redacted: string): boolean {
	if (!redacted.endsWith("…")) return fullToken === redacted;
	return fullToken.startsWith(redacted.slice(0, -1));
}

/** The bare session id behind an identity (`session:a` -> `a`), or "" for
 * anything that is not one. */
export function sessionIdOf(identity: string): string {
	return identity.startsWith("session:")
		? identity.slice("session:".length)
		: identity === "session:"
			? ""
			: identity;
}

/** Mint a surface nonce. 16 random bytes hex-encoded: the same 32-character
 * shape and entropy the extension's nonces have, so a redacted handle leaks the
 * same 26 hidden characters either way. */
function mintNonce(): string {
	return randomBytes(16).toString("hex");
}

export interface CreateTabOptions {
	owner: TabOwner;
	sessionId?: string | null;
	/** A tab whose URL is restored from `session.json`. Restored tabs are always
	 * `user`-owned and never get a nonce, whatever they were before. */
	restored?: boolean;
	/** The row this tab is restored from, when it is one. See `TabRecord`. */
	restoreRow?: PersistedTab;
	allocationId?: string;
}

export class TabRegistry {
	private readonly tabs = new Map<number, TabRecord>();
	private nextTabId = 1;
	private activeTabId: number | null = null;
	private visible = true;
	private contentRect: ContentRect | null = null;
	/** Tabs with a command in flight, keyed by tabId. See `lane`. */
	private readonly busy = new Set<number>();
	private readonly epochListeners: Array<
		(tabId: number, epoch: number) => void
	> = [];

	constructor(
		private readonly viewFactory: (
			options: CreateTabOptions,
			tabId: number,
		) => DriveableView,
		private readonly onRemove: (tabId: number, webContentsId: number) => void,
		private readonly onChanged: () => void,
	) {}

	// ---- creation, addressing, listing ---------------------------------------

	/**
	 * Create a tab. A user tab becomes active (the user asked for it); an AGENT
	 * tab does NOT — design 11.4 requires that an agent `open` must never switch
	 * the tab the user is looking at, which is the extension's
	 * `chrome.tabs.create({active: false})` equivalent.
	 */
	create(options: CreateTabOptions): TabRecord {
		if (options.owner === "agent") this.assertAgentCapacity();
		const tabId = this.nextTabId++;
		const restored = options.restored === true;
		const record: TabRecord = {
			tabId,
			view: this.viewFactory({ ...options, restored }, tabId),
			// Design 7.3: a restored tab is the user's, full stop. An agent does not
			// silently reclaim the tab it owned in a previous app run.
			owner: restored ? "user" : options.owner,
			sessionId: restored ? null : (options.sessionId ?? null),
			// The same value `sessionId` gets at creation, kept because a hand-over
			// overwrites `sessionId` and a revocation has to put the conversation back
			// (see the field's own note).
			homeSessionId: restored ? null : (options.sessionId ?? null),
			nonce: restored || options.owner === "user" ? null : mintNonce(),
			handedTo: null,
			restored,
			restoreRow: options.restoreRow,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
			epoch: 0,
			documentEpoch: 0,
			presented: false,
			refs: {},
			allocationId: options.allocationId ?? "",
		};
		this.tabs.set(tabId, record);
		// Only a USER tab may become the active one, including when nothing is active
		// yet. The earlier `activeTabId === null` form activated whichever tab was
		// created first — on a session with no user tab that is the agent's own, so the
		// agent's background tab silently became the presented one and every other tab
		// kept zero layout. The layout pass below reads this to decide presentation.
		if (record.owner === "user") this.activeTabId = tabId;
		this.applyLayout();
		this.onChanged();
		return record;
	}

	/** The cap check, in one place because TWO routes make a tab agent-owned:
	 * `create({owner: "agent"})` and a hand-over, which changes the owner of a tab
	 * the user created. Checking only the first let hand-overs push the
	 * agent-owned count past the cap, after which the next `open` was refused with
	 * "already driving 8 agent tabs" for tabs the user had handed over — the cap
	 * reported by `status` and the cap enforced on `open` disagreeing (N3). */
	private assertAgentCapacity(): void {
		if (this.agentTabCount() < MAX_AGENT_TABS) return;
		throw new BrowserHostError(
			"tab_limit",
			`this host is already driving ${MAX_AGENT_TABS} agent tabs; close one first`,
			{ limit: MAX_AGENT_TABS },
		);
	}

	/** Resolve a tab by its own id. */
	get(tabId: number): TabRecord | undefined {
		return this.tabs.get(tabId);
	}

	list(): TabRecord[] {
		return [...this.tabs.values()].sort((a, b) => a.tabId - b.tabId);
	}

	/**
	 * The tab whose view owns this webContents id, if any.
	 *
	 * The passkey chooser needs it to name the page a request came from: Electron
	 * hands the initiating frame, `webContents.fromFrame` turns that into a
	 * webContents, and this is the mapping from there to a tab of THIS host — the
	 * frame may belong to no tab here at all, which is why the answer is optional
	 * rather than an error.
	 */
	byWebContentsId(webContentsId: number): TabRecord | undefined {
		return this.list().find(
			(record) =>
				!record.view.webContents.isDestroyed() &&
				record.view.webContents.id === webContentsId,
		);
	}

	/** The tab a webContents belongs to, or null.
	 *
	 * WHY THIS EXISTS: `will-download` is a SESSION-level handler (Electron's own
	 * split, see `profile.ts`), and the only thing it hands the handler that names a
	 * tab is the WebContents that started the download. Without this lookup the
	 * host could not tell an armed tab from an unarmed one, and every download would
	 * have to be refused — which is what it did before the file-transfer feature.
	 *
	 * A linear scan is deliberate: the set is bounded by the agent-tab cap plus the
	 * user's own tabs, it runs once per download, and a second index keyed by
	 * webContents id is one more thing that can go stale when a view dies. */
	byWebContents(webContentsId: number): TabRecord | null {
		if (!Number.isSafeInteger(webContentsId)) return null;
		for (const record of this.tabs.values()) {
			if (record.view.webContents.id === webContentsId) return record;
		}
		return null;
	}

	get activeTab(): TabRecord | null {
		return this.activeTabId === null
			? null
			: (this.tabs.get(this.activeTabId) ?? null);
	}

	agentTabCount(): number {
		return this.list().filter((record) => record.owner === "agent").length;
	}

	count(): number {
		return this.tabs.size;
	}

	/**
	 * Resolve a surface token to a live tab, or refuse.
	 *
	 * This is the fail-closed gate every agent action goes through, and its
	 * refusals are the design's contract:
	 * - malformed token → `tab_closed` ("dropped the handle"): the session's
	 *   recovery is `open`, and inventing a different code for a typo would give
	 *   it nothing to act on;
	 * - unknown tab, or a nonce that does not match → `tab_closed`. A wrong nonce
	 *   is deliberately indistinguishable from a missing tab: saying "wrong
	 *   nonce" would confirm the tab exists, which is the one thing a guessed
	 *   handle must not learn;
	 * - a view whose webContents is already destroyed → the record is dropped
	 *   here and the same refusal is returned, so a handle that outlives its view
	 *   fails instead of driving something else.
	 */
	requireSurface(token: unknown): TabRecord {
		const parsed = parseSurface(token);
		if (!parsed) {
			throw new BrowserHostError(
				"tab_closed",
				"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab",
				{ reason: "malformed_handle" },
			);
		}
		const record = this.tabs.get(parsed.tabId);
		if (!record || !record.nonce || record.nonce !== parsed.nonce) {
			throw new BrowserHostError(
				"tab_closed",
				"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab",
				{ reason: "unknown_handle" },
			);
		}
		if (record.view.webContents.isDestroyed()) {
			this.forget(record.tabId);
			throw new BrowserHostError(
				"tab_closed",
				"that browser tab is gone; dropped the handle. Use 'open' with a URL to get a new tab",
				{ reason: "view_destroyed" },
			);
		}
		return record;
	}

	/** Touch a tab driven by an agent, so `tabs` can order by recency. */
	touch(record: TabRecord): void {
		record.lastUsedAt = Date.now();
	}

	// ---- hand-over (design 6.3) ---------------------------------------------

	/**
	 * Hand a user tab to a session, minting its capability.
	 *
	 * The renderer never sees the nonce: this is the ONE place renderer authority
	 * becomes agent authority, and the nonce travels to the session through
	 * `tabs`, not back through the renderer.
	 */
	handOver(tabId: number, rawSessionId: string): void {
		const record = this.tabs.get(tabId);
		if (!record) throw new BrowserHostError("tab_closed", "that tab is gone"); // Stored BARE (`a`, not `session:a`), matching what `open` writes and what a
		// session's own identity reduces to. Normalising here rather than at each
		// comparison is what keeps `tabs`'s "handed to you" marker and the ownership
		// checks from disagreeing about the same session's name.
		const sessionId = sessionIdOf(rawSessionId);
		if (!sessionId) {
			throw new BrowserHostError(
				"internal",
				"handing a tab over needs a session to hand it to",
			);
		}
		// Only a hand-over that ADDS an agent-owned tab is capped: re-handing an
		// agent tab to another session does not change the count, and refusing it
		// would make the cap visible as "this host is already driving 8 agent tabs"
		// for the one action that does not add one.
		if (record.owner !== "agent") this.assertAgentCapacity();
		record.owner = "agent";
		// `sessionId` moves to the session that now drives the tab; `homeSessionId` does
		// NOT, and deliberately: a hand-over changes who may drive a tab, not the
		// conversation the user opened it in — which is what `revokeHandOver` restores
		// (review round 1, Q2).
		record.sessionId = sessionId;
		record.handedTo = sessionId;
		record.nonce = mintNonce();
		record.allocationId = "";
		this.bumpEpoch(record.tabId);
		this.onChanged();
	}

	/** Revoke a hand-over: nulls the nonce, so the session's next action on that
	 * handle gets the ordinary `tab_closed` refusal, and puts the tab back in the
	 * conversation the user opened it in.
	 *
	 * THE ATTRIBUTION COMES BACK, NOT JUST THE OWNERSHIP (review round 1, Q2): the
	 * revocation used to null `sessionId` outright, which took the tab out of the
	 * conversation it was opened in (`tabsInScope` reads that field, and so does the
	 * conversation's own tab count) — so revoking a hand-over silently lost the
	 * conversation, and the design's §5.1 row 6 says a revoke is a true inverse. The
	 * ownership and the capability still go, and `mayDrive` still refuses without the
	 * nonce. A tab with no home (the route, a draft, a restored tab) still lands on
	 * `null`, which is the behaviour it always had. */
	revokeHandOver(tabId: number): void {
		const record = this.tabs.get(tabId);
		if (!record) return;
		record.nonce = null;
		record.owner = "user";
		record.sessionId = record.homeSessionId;
		record.handedTo = null;
		record.allocationId = "";
		this.bumpEpoch(record.tabId);
		this.onChanged();
	}

	/** Whether a session may drive this tab: its own agent tab, or one handed to
	 * it. Nothing else — a user tab with no hand-over has no nonce to present. */
	mayDrive(record: TabRecord, sessionId: string): boolean {
		return record.sessionId === sessionId && record.nonce !== null;
	}

	// ---- navigation epochs ---------------------------------------------------

	/**
	 * Bump a tab's navigation epoch and drop its refs.
	 *
	 * Called on every top-level navigation (agent `open`/`goto` AND the user
	 * typing a URL, per design 6.4). It is what makes concurrent interaction safe
	 * rather than merely untested: a ref taken before the navigation belongs to a
	 * document that no longer exists, and `resolveRef` refuses it with
	 * `element_not_found` instead of clicking whatever now occupies that
	 * position.
	 */
	bumpEpoch(tabId: number, newDocument = true): void {
		const record = this.tabs.get(tabId);
		if (!record) return;
		record.epoch += 1;
		if (newDocument) record.documentEpoch += 1;
		// The refs are deliberately KEPT, not cleared. Clearing them would also make
		// the old refs unusable, but it would do so by making them indistinguishable
		// from a ref that never existed — and the more useful refusal is the one that
		// says why: "the page navigated since that snapshot". The table is replaced
		// wholesale by the next snapshot, so keeping it costs one snapshot's worth of
		// bookkeeping.
		for (const listener of this.epochListeners) listener(tabId, record.epoch);
	}

	/** Observe epoch changes (the CDP driver uses one to re-arm per-navigation
	 * event capture without the registry knowing what CDP is). */
	onEpoch(listener: (tabId: number, epoch: number) => void): void {
		this.epochListeners.push(listener);
	}

	// ---- per-tab command lane (design 6.4) -----------------------------------

	/**
	 * Run `fn` as the sole command on this tab, or refuse with `busy`.
	 *
	 * Serialised PER TAB, across sessions: the session side already serialises
	 * per session, but two sessions can target different tabs and one session can
	 * target one tab, so the host owns this queue. A second command on a busy tab
	 * is NOT quietly queued — it gets `busy` with the existing "retry this action
	 * once" copy, because a silent queue turns a 30 s budget into an unbounded
	 * wait and the agent has no way to tell the difference from a slow page.
	 */
	async lane<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
		if (this.busy.has(tabId)) {
			throw new BrowserHostError(
				"busy",
				"this browser tab is busy with another command; retry this action once",
				{ tab: tabId },
			);
		}
		this.busy.add(tabId);
		try {
			return await fn();
		} finally {
			this.busy.delete(tabId);
		}
	}

	// ---- layout, visibility, activation --------------------------------------

	/** The renderer owns presentation geometry, not whether a background renderer
	 * has a viewport. Inactive views keep bounded default dimensions independently
	 * of this rectangle, so agent actions never require a route or focus change.
	 *
	 * A NULL rect still hides every view, and that is a correctness requirement
	 * rather than a tidy-up: the browser surface is a ROUTE, so navigating away
	 * unmounts the only thing that knows where the view belongs. Without this, the
	 * last rect would stay applied and the native view would go on painting over
	 * the chat route — the one failure mode that makes this feature look like a
	 * hijacked window. Visiting the route again reports a fresh rect and restores
	 * it. A null rect is also how the caller hides the view at teardown, so it must
	 * never be swallowed on the way here (see `use-browser-chrome`). */
	setContentRect(rect: ContentRect | null): void {
		this.contentRect = rect;
		this.applyLayout();
	}

	/** Full-window overlays hide the view (design 11.3): a native view paints
	 * above all DOM, so an overlay is invisible unless the view goes away. */
	setViewVisible(visible: boolean): void {
		this.visible = visible;
		this.applyLayout();
	}

	activate(tabId: number): void {
		if (!this.tabs.has(tabId)) return;
		this.activeTabId = tabId;
		this.applyLayout();
		this.onChanged();
	}

	private applyLayout(): void {
		const active =
			this.activeTabId === null ? null : this.tabs.get(this.activeTabId);
		for (const record of this.tabs.values()) {
			const isActive = record === active;
			record.presented = isActive && this.visible && this.contentRect !== null;
			record.view.setBounds(
				isActive && this.contentRect ? this.contentRect : BACKGROUND_VIEWPORT,
			);
			record.view.setVisible(record.presented);
		}
	}

	// ---- removal -------------------------------------------------------------

	/**
	 * Drop one tab's record WITHOUT notifying: the registry-local half of every removal.
	 *
	 * EXTRACTED FROM `forget` FOR `destroyMany` (design R5), and the split is what makes a
	 * batch one change rather than N: `destroyMany` drops every record first, then runs
	 * ONE `applyLayout()` and ONE `onChanged()`, and the notify-free half is the only way
	 * to do that without N full state builds, N IPC broadcasts and N `session.json`
	 * writes — which is what N sequential closes cost today (`host.closeTab` →
	 * `registry.destroy` → `onChanged` per tab).
	 */
	private drop(tabId: number): TabRecord | undefined {
		const record = this.tabs.get(tabId);
		if (!record) return undefined;
		this.tabs.delete(tabId);
		if (this.activeTabId === tabId) {
			// The successor must be a USER tab, for the same reason `create` only ever
			// activates one (see above): `list().at(-1)` with no owner filter handed the
			// presented surface to an AGENT tab as soon as the user closed their own
			// active tab — active AND `presented`, laid out with the content rect — which
			// is exactly the state the rule on `create` names as the bug (review round 1,
			// R3). "Last" keeps the previous preference (most recently created) and the
			// filter narrows it to the tabs that may hold presentation at all; with no
			// user tab left nothing is presented and every agent tab stays a bounded
			// background view.
			this.activeTabId =
				this.list()
					.filter((candidate) => candidate.owner === "user")
					.at(-1)?.tabId ?? null;
		}
		return record;
	}

	/**
	 * Drop a tab and hand its webContents id to `onRemove`, which is where the
	 * debugger session, the log buffer and the child view are released.
	 *
	 * `forget` is the registry-local half PLUS the notification: `drop` above removes the
	 * record, and this runs the one `applyLayout()`/`onChanged()` pair every single-tab
	 * removal has always run. It is what `destroy` below and the fail-closed handle check
	 * use (where the caller has no cleanup work to do — the webContents is already
	 * destroyed), while `destroyMany` uses `drop` for the same reason one level down: it
	 * wants N removals under ONE notification rather than N of each.
	 *
	 * WHAT IT IS NOT, because this file is where a reader learns which removal path
	 * notifies and it used to say the opposite of `drop`'s note (review round 1, A8):
	 * `forget` is NOT the registry-local half — `drop` above is — and a caller that wants
	 * the removal without the notification wants `drop`.
	 */
	forget(tabId: number): TabRecord | undefined {
		const record = this.drop(tabId);
		if (!record) return undefined;
		this.applyLayout();
		this.onChanged();
		return record;
	}

	/**
	 * Close SEVERAL tabs as one change: the registry half of the renderer's bulk closes
	 * (design R5).
	 *
	 * WHY ONE INTENT RATHER THAN N `destroy` CALLS, in the order the design weighs it:
	 *
	 * 1. "Close all tabs in this conversation" cannot be expressed as a list without
	 *    racing. A list computed from a projection the renderer read up to seconds ago
	 *    misses a tab an agent opened in that conversation in the meantime, and the user
	 *    pressed something that said ALL. (The renderer resolves that mode HERE, at
	 *    execution time, for exactly this reason.)
	 * 2. N round trips are N full `chromeState()` builds, N IPC broadcasts and N
	 *    `session.json` writes, each of which re-renders the strip. A batch is one of
	 *    each.
	 * 3. `destroy` is synchronous and the chrome's closes do not take the per-tab lane
	 *    (`registry.lane` is the dispatcher's), so there is no interleaving to reason
	 *    about within one intent — and N separate intents are N separate windows in which
	 *    an agent can create a tab. One intent, one window, one decision.
	 *
	 * IDS THAT ARE ALREADY GONE ARE SKIPPED RATHER THAN REFUSED: the user's intent was
	 * that they be closed, and they are. Refusing the batch because one tab was closed
	 * twice — by a second press, or by an agent's own `close` — would leave the other
	 * tabs open, which is the one outcome nobody asked for.
	 *
	 * `onRemove` STILL RUNS PER RECORD and after the single notification, so the
	 * webContents/debugger/log release path stays the single one it has always been
	 * (design 11.1: with `WebContentsView`, nothing destroys the webContents for you).
	 */
	destroyMany(tabIds: readonly number[]): number {
		const removed: TabRecord[] = [];
		for (const tabId of tabIds) {
			const record = this.drop(tabId);
			if (record) removed.push(record);
		}
		if (removed.length === 0) return 0;
		this.applyLayout();
		this.onChanged();
		for (const record of removed) {
			this.onRemove(record.tabId, record.view.webContents.id);
		}
		return removed.length;
	}

	/** Destroy a tab: forget it, then release its resources. `onRemove` is
	 * called for every removal path so a tab can never be forgotten while its
	 * webContents, debugger session or log buffer leak (design 11.1: with
	 * `WebContentsView`, nothing destroys the webContents for you). */
	destroy(tabId: number): void {
		const record = this.forget(tabId);
		if (!record) return;
		this.onRemove(record.tabId, record.view.webContents.id);
	}

	/** Every tab, destroyed. Called on host stop and app quit. */
	destroyAll(): void {
		for (const tabId of [...this.tabs.keys()]) this.destroy(tabId);
	}

	/** A debug/diagnostic projection: what `status` and `tabs` report, and what
	 * the renderer's strip renders. */
	snapshot(): Array<{
		tabId: number;
		owner: TabOwner;
		sessionId: string | null;
		handedTo: string | null;
		restored: boolean;
		active: boolean;
		url: string;
		title: string;
		handle: string;
	}> {
		return this.list().map((record) => {
			const token = surfaceToken(record);
			return {
				tabId: record.tabId,
				owner: record.owner,
				sessionId: record.sessionId,
				handedTo: record.handedTo,
				restored: record.restored,
				active: record.tabId === this.activeTabId,
				url: record.view.webContents.isDestroyed()
					? ""
					: record.view.webContents.getURL(),
				title: record.view.webContents.isDestroyed()
					? ""
					: record.view.webContents.getTitle(),
				handle: token ? redactToken(token) : `ui:${record.tabId}:no-handle`,
			};
		});
	}
}

/** A fresh allocation id for the ownership journal (design 10.5 / the
 * extension's `allocation_id`). Opaque to both sides. */
export function mintAllocationId(): string {
	return randomUUID();
}
