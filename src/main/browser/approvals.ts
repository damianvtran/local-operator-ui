import { join } from "node:path";
import { PRIVATE_FILE_MODE, readJson, writeJsonAtomic } from "./atomic-json";
import { BrowserHostError } from "./errors";
import { nextSequence } from "./policy/adapter";
import {
	type AccessTombstones,
	ONCE_GRANT_TTL_MS,
	type OnceGrants,
	TOMBSTONE_CAP,
	accessState,
	consumableGrant,
	receiptKey,
	tombstoneFor,
} from "./vendor/driver/access-flow";
import {
	ACCESS_QUEUE_CAP,
	type AccessQueueEntry,
	type AccessResults,
	type AccessState,
	type OriginDecision,
	cleanResults,
	findPending,
	liveQueue,
	newEntry,
	receiptFor,
	receiptForRequester,
	resultKey,
} from "./vendor/driver/access-queue";
import {
	type BroadGrant,
	type SiteGrantsState,
	type StoredVerdict,
	broadGrantFor,
	displayAuthority,
	matchingGrantScope,
	safeHttpUrl,
	storedOriginAllowed,
} from "./vendor/driver/origin-policy";

/**
 * The origin gate, the pending-request slot, and the durable approval store.
 * Design: docs/design/ui-browser-tab.md 9 (R6), 6.3, 6.4.
 *
 * THE PROBLEM THIS FILE EXISTS FOR, stated exactly as the design states it: a
 * persistent jar plus agent-driven tabs means an agent can act as the operator on
 * authenticated sites, for as long as the jar and the grant live. The answer is
 * default-deny per origin, enforced HERE in the host rather than in the session,
 * because the prompt renders in UI chrome that no local process can click — so
 * "the agent opened the user's bank" always passed through a human click on that
 * machine's screen.
 *
 * WHY the decision logic is in the shared driver modules rather than inline: design 9.2's
 * argument is that reusing the extension's pure modules makes the semantics true
 * by construction rather than by review. `requestVerdict`/`accessState`/
 * `policyCovers`/`matchingGrantScope` below are those modules, and this file only
 * supplies the storage and the plumbing around them.
 *
 * WHAT IS NOT HERE YET, deliberately: the consent BAR. This PR (design PR 3)
 * owns the gate and the three RPC methods; the rendered band, the notification
 * and the revocation UI are PR 7. Until then a raised request has no chrome to
 * appear in, so it expires unanswered — which is default-deny, the honest
 * direction — and the one way to answer one is the `respond` entry point below,
 * which the renderer IPC exposes to the (separately checked) app page.
 */

/** The durable store's shape, versioned so a newer writer's file fails closed
 * rather than being misread. */
export interface ApprovalStoreFile {
	version: 1;
	/** Exact-origin verdicts: scheme, host and port. `deny` is persisted on
	 * purpose (design 9.3) so the agent stops asking about an origin the user
	 * refused; nothing else negative is durable. */
	origins: Record<string, StoredVerdict>;
	/** Broad grants, in the extension's shape so the vocabulary a reviewer
	 * compares is the same (design 9.3: `site` is exact origin, `domain` the
	 * registrable domain or loopback host). */
	siteGrants: SiteGrantsState;
	/** The provenance list the approvals UI shows: one row per decision that is
	 * still in force, with the scope, when it was granted, and the requester that
	 * earned it. Kept even though the maps above are sufficient to enforce, because
	 * "which sites can an agent act on as me right now, and who asked" must be
	 * answerable from the UI alone (design 9.3's honesty requirement). */
	records: ApprovalRecord[];
}

export interface ApprovalRecord {
	origin: string;
	scope: "origin" | "domain" | "host" | "deny";
	/** The requester that earned the grant; "" for a grant made outside a request
	 * (a settings toggle). */
	requester: string;
	grantedAt: number;
}

export const APPROVALS_FILENAME = "approvals.json";

export interface ApprovalStoreOptions {
	/** The `userData/browser` directory. Beside `session.json` and the extensions
	 * directory, and deliberately NOT inside the Chromium profile: the profile is
	 * what a user clears when they want to "log out of everything", while these
	 * approvals are policy, so clearing data and revoking approvals stay two
	 * separate actions with separate consequences (design 5.4, 9.3). */
	dir: string;
	now?: () => number;
	/** Called whenever the pending set or the grants change, so a consent surface
	 * (and, today, the evidence run) can re-render. */
	onChanged?: () => void;
	log?: (message: string) => void;
}

/**
 * A fresh empty store.
 *
 * A FUNCTION, not a constant, and that is not style: a shared literal would hand
 * every `ApprovalStore` instance the same `origins`/`grants`/`records` objects, so
 * one store's decision would appear in another's — a grant made in one window
 * (or one test) showing up in the next, which is exactly the class of bug this
 * module exists to prevent.
 */
function emptyStore(): ApprovalStoreFile {
	return {
		version: 1,
		origins: {},
		siteGrants: { version: 1, grants: {} },
		records: [],
	};
}

export class ApprovalStore {
	private readonly path: string;
	private readonly now: () => number;
	private readonly onChanged: () => void;
	private readonly log: (message: string) => void;
	private store: ApprovalStoreFile;
	/** The live pending entries, FIFO. In-memory: a pending prompt that outlived
	 * the app would be a prompt about a navigation nobody remembers requesting. */
	private queue: AccessQueueEntry[] = [];
	/** Decisions, keyed `entryId\nrequester` (see `resultKey`). */
	private results: AccessResults = {};
	/** Unspent "Allow once" grants, keyed by origin. */
	private onceGrants: OnceGrants = {};
	/** Receipts for displaced requesters (see `access-flow.ts`). */
	private tombstones: AccessTombstones = {};
	/** Consumed once grants authorize one committed document, not every future
	 * document on that origin. Revocation invalidates in-flight admissions too. */
	private revision = 0;
	private documents = new Map<
		string,
		{ origin: string; requester: string; epoch: number; revision: number }
	>();

	constructor(options: ApprovalStoreOptions) {
		this.path = join(options.dir, APPROVALS_FILENAME);
		this.now = options.now ?? Date.now;
		this.onChanged = options.onChanged ?? (() => {});
		this.log = options.log ?? (() => {});
		const loaded = readJson<ApprovalStoreFile>(this.path);
		const fresh = emptyStore();
		this.store =
			loaded && loaded.version === 1
				? {
						...fresh,
						...loaded,
						// The three mutable containers are taken from the FRESH store when
						// the file did not carry them, never shared with another instance.
						origins: loaded.origins ?? fresh.origins,
						siteGrants: loaded.siteGrants ?? fresh.siteGrants,
						records: loaded.records ?? fresh.records,
					}
				: fresh;
	}

	// ---- the gate ------------------------------------------------------------

	/** Whether the agent may reach this URL: an exact-origin allow, a broad grant,
	 * or nothing. A persisted DENY for the exact origin wins over any broader
	 * grant: the user's most specific statement about a site is the one that
	 * counts, and a deny that a domain grant could override would make the deny
	 * button a lie.
	 *
	 * The signature is the VENDORED one — `(origins, url, hostGrants?, siteGrants?)`
	 * — and the `hostGrants` slot is passed `undefined` for the same reason
	 * `grantScopeFor` does: that slot reads the extension's legacy 0.1.4-0.1.7
	 * loopback shape, which this host never wrote. Passing `siteGrants` there
	 * instead compiles (the slot is `unknown` and optional) and silently drops
	 * every broad grant, which is why the call spells the order out. */
	originAllowed(url: URL): boolean {
		if (this.store.origins[url.origin] === "deny") return false;
		return storedOriginAllowed(
			this.store.origins,
			url,
			undefined,
			this.store.siteGrants,
		);
	}

	/** Why the URL is refused, for the refusal's `data` — a sentence the model can
	 * use rather than a bare boolean. */
	refusalReason(url: URL): "denied" | "unapproved" {
		return this.store.origins[url.origin] === "deny" ? "denied" : "unapproved";
	}

	/**
	 * The admission decision for a top-level navigation, made ONCE at command
	 * entry.
	 *
	 * The "once" is load-bearing (the extension's round-1 M1): a grant consumed
	 * here is already spent, and re-consulting the grant map later in the same
	 * command would let the 10-minute TTL lapse between entry and navigation,
	 * turning a granted navigation back into a prompt the agent thinks it already
	 * passed.
	 *
	 * An unapproved origin is refused EARLY with `origin_not_allowed` — never by
	 * blocking the navigation on a prompt. That is the design's three-step dance:
	 * the agent gets a typed failure it can narrate, then runs
	 * `request_access` → tells the user → `await_access`.
	 */
	ensureTopLevelAccess(
		url: URL,
		requester: string,
	): { allowed: boolean; viaOnceGrant: boolean } {
		if (this.originAllowed(url)) return { allowed: true, viaOnceGrant: false };
		const grant = consumableGrant(
			this.onceGrants,
			url.origin,
			requester,
			this.now(),
		);
		if (grant) {
			delete this.onceGrants[url.origin];
			this.persistIfChanged();
			return { allowed: true, viaOnceGrant: true };
		}
		throw new BrowserHostError(
			"origin_not_allowed",
			`the user has not approved ${url.origin} for agent access`,
			{
				origin: url.origin,
				authority: displayAuthority(url),
				reason: this.refusalReason(url),
			},
		);
	}

	/** Admission is captured once, but revocation remains authoritative while an
	 * asynchronous navigation is in flight. A receipt is never transferable. */
	admit(
		url: URL,
		requester: string,
	): { viaOnceGrant: boolean; approved: (candidate: URL) => boolean } {
		const { viaOnceGrant } = this.ensureTopLevelAccess(url, requester);
		const revision = this.revision;
		return {
			viaOnceGrant,
			approved: (candidate) =>
				this.originAllowed(candidate) ||
				(viaOnceGrant &&
					revision === this.revision &&
					candidate.origin === url.origin),
		};
	}

	rememberDocument(
		token: string,
		url: URL,
		requester: string,
		epoch: number,
		admitted: (url: URL) => boolean,
	): void {
		if (!admitted(url)) this.refuseDocument(url);
		this.documents.set(token, {
			origin: url.origin,
			requester,
			epoch,
			revision: this.revision,
		});
	}

	documentAllowed(
		token: string,
		url: URL,
		requester: string,
		epoch: number,
	): boolean {
		if (this.originAllowed(url)) return true;
		const receipt = this.documents.get(token);
		return (
			!!receipt &&
			receipt.origin === url.origin &&
			receipt.requester === requester &&
			receipt.epoch === epoch &&
			receipt.revision === this.revision
		);
	}

	forgetDocument(token: string): void {
		this.documents.delete(token);
	}

	refuseDocument(url: URL): never {
		throw new BrowserHostError(
			"origin_not_allowed",
			`the user has not approved ${url.origin} for this document; request access before driving it`,
			{ origin: url.origin, reason: this.refusalReason(url) },
		);
	}

	// ---- request_access / await_access / cancel_access -----------------------

	/** The live entry for an exact origin, if any: what a consent surface renders. */
	pendingEntry(): AccessQueueEntry | undefined {
		return liveQueue(this.queue, this.now())[0];
	}

	/** Every live pending entry, in FIFO order (the cap is small, so a list is
	 * cheap and the surface decides what to show). */
	pendingEntries(): AccessQueueEntry[] {
		return liveQueue(this.queue, this.now());
	}

	/**
	 * Raise a request, or report that one already covers this caller.
	 *
	 * The rules are `vendor/driver/access-flow.ts`'s, applied to the queue: a repeat
	 * request for the same origin by the same requester is idempotent with its
	 * original TTL, a request for a different origin REPLACES the live one (with
	 * a tombstone for the displaced requester), and a live deny receipt answers
	 * "denied" without re-prompting until its cool-down expires.
	 */
	requestAccess(
		rawUrl: unknown,
		requester: string,
		kind: "async" | "in_command" = "async",
		commandId?: string,
	): Record<string, unknown> {
		const url = safeHttpUrl(rawUrl);
		const now = this.now();
		if (this.originAllowed(url)) {
			return { origin: url.origin, state: "allowed" satisfies AccessState };
		}
		const existing = findPending(this.queue, url.origin, requester, kind, now);
		if (existing) {
			// Same origin, same requester, already pending: idempotent, original TTL
			// kept. Resetting the TTL would let a polling agent extend the window
			// indefinitely.
			return this.entryResponse(existing, "pending");
		}
		const receipt = receiptForRequester(
			this.results,
			url.origin,
			requester,
			now,
		);
		if (receipt && receipt.state !== "superseded") {
			// A resolved record only answers ITS OWN requester, and a fresh deny is a
			// cool-down rather than a nag: re-raising the prompt on every retry is how
			// the user learns to click Allow to make it stop.
			const state: AccessState =
				receipt.state === "denied" ? "denied" : "allowed";
			return { origin: url.origin, state, entry_id: receipt.entryId };
		}
		this.sweep(now);
		if (liveQueue(this.queue, now).length >= ACCESS_QUEUE_CAP) {
			throw new BrowserHostError(
				"access_queue_full",
				`site approval queue is full with ${liveQueue(this.queue, now).length} pending requests`,
				{ pending_count: liveQueue(this.queue, now).length },
			);
		}
		// Replace-don't-queue: the surface shows ONE origin, so a request for a
		// different origin displaces the live one and leaves it a receipt.
		this.displaceLive(now);
		const entry = newEntry(
			url.origin,
			displayAuthority(url),
			requester,
			kind,
			now,
			nextSequence(this.queue),
			commandId,
			undefined,
			broadGrantFor(url),
		);
		this.queue.push(entry);
		this.onChanged();
		this.log(
			`[browser] ${requester} is asking for access to ${url.origin} (${this.pendingEntries().length} pending)`,
		);
		return this.entryResponse(entry, "pending");
	}

	private entryResponse(
		entry: AccessQueueEntry,
		state: AccessState,
	): Record<string, unknown> {
		return {
			origin: entry.origin,
			state,
			entry_id: entry.entryId,
			authority: entry.displayAuthority,
			expires_at: entry.expiresAt,
			...(entry.broad ? { broad: entry.broad } : {}),
		};
	}

	/** What `await_access` answers, WITHOUT waiting (the loop is in
	 * `awaitAccess`). */
	accessStateFor(rawUrl: unknown, requester: string): Record<string, unknown> {
		const url = safeHttpUrl(rawUrl);
		const now = this.now();
		const entry = findPending(
			this.queue,
			url.origin,
			requester,
			undefined,
			now,
		);
		const state = accessState(
			entry
				? {
						origin: entry.origin,
						hostname: entry.displayAuthority,
						requester: entry.requester,
						requestedAt: entry.requestedAt,
						expiresAt: entry.expiresAt,
						...(this.decisionFor(entry)
							? { decision: this.decisionFor(entry) }
							: {}),
					}
				: undefined,
			this.tombstones,
			this.originAllowed(url),
			!!consumableGrant(this.onceGrants, url.origin, requester, now),
			url.origin,
			requester,
			now,
		);
		return {
			origin: url.origin,
			state,
			...(entry ? { entry_id: entry.entryId } : {}),
		};
	}

	/** The caller's own exact-origin pending entry, removed. Only this
	 * requester's own entry: a cancel must not let one session dismiss another's
	 * prompt. */
	cancelAccess(rawUrl: unknown, requester: string): Record<string, unknown> {
		const url = safeHttpUrl(rawUrl);
		const now = this.now();
		const index = this.queue.findIndex(
			(entry) => entry.origin === url.origin && entry.requester === requester,
		);
		if (index < 0)
			return { origin: url.origin, state: "none" satisfies AccessState };
		const [entry] = this.queue.splice(index, 1);
		if (entry) {
			this.results[resultKey(entry.entryId, entry.requester)] = receiptFor(
				entry,
				"cancelled",
				now,
			);
		}
		this.onChanged();
		return { origin: url.origin, state: "cancelled" satisfies AccessState };
	}

	/**
	 * Answer the pending prompt: the user's decision, applied.
	 *
	 * Reached from the renderer IPC (a chrome band will call it; nothing else
	 * can, and the IPC handler checks the sender). `entryId` names which pending
	 * entry is being answered, so an answer that arrives after the queue moved on
	 * fails rather than granting whatever is pending now.
	 */
	respond(
		entryId: string,
		decision: OriginDecision,
		requester = "",
	): Record<string, unknown> {
		const entry = this.queue.find((candidate) => candidate.entryId === entryId);
		if (!entry) {
			throw new BrowserHostError(
				"internal",
				"that site approval request is no longer pending",
			);
		}
		const now = this.now();
		this.queue = this.queue.filter(
			(candidate) => candidate.entryId !== entryId,
		);
		if (decision === "once") {
			this.onceGrants[entry.origin] = {
				expiresAt: now + ONCE_GRANT_TTL_MS,
				requester: entry.requester,
				...(entry.commandId ? { handoff: entry.commandId } : {}),
			};
			this.results[resultKey(entry.entryId, entry.requester)] = receiptFor(
				entry,
				"allowed",
				now,
			);
			this.persist();
			this.onChanged();
			return { origin: entry.origin, state: "allowed", scope: "once" };
		}
		if (decision === "deny") {
			this.store.origins[entry.origin] = "deny";
			this.store.records.push({
				origin: entry.origin,
				scope: "deny",
				requester: requester || entry.requester,
				grantedAt: now,
			});
			this.results[resultKey(entry.entryId, entry.requester)] = receiptFor(
				entry,
				"denied",
				now,
			);
			this.persist();
			this.onChanged();
			return { origin: entry.origin, state: "denied", scope: "deny" };
		}
		// "site" is the exact origin; "domain" is the broad option the entry
		// carried. A broad decision without a `broad` computation (no PSL data) is
		// refused rather than silently widened to the exact origin.
		if (decision === "site") {
			this.store.origins[entry.origin] = "allow";
			this.store.records.push({
				origin: entry.origin,
				scope: "origin",
				requester: requester || entry.requester,
				grantedAt: now,
			});
		} else {
			const broad: BroadGrant | undefined = entry.broad;
			if (!broad) {
				throw new BrowserHostError(
					"internal",
					"this build cannot grant a broad scope for that origin",
				);
			}
			if (broad.scope === "domain") {
				this.store.siteGrants.grants[broad.key] = {
					scope: "domain",
					createdAt: now,
				};
			} else {
				this.store.siteGrants.grants[broad.key] = {
					scope: "host",
					createdAt: now,
				};
			}
			this.store.records.push({
				origin: entry.origin,
				scope: broad.scope,
				requester: requester || entry.requester,
				grantedAt: now,
			});
		}
		this.results[resultKey(entry.entryId, entry.requester)] = receiptFor(
			entry,
			"allowed",
			now,
		);
		this.persist();
		this.onChanged();
		return {
			origin: entry.origin,
			state: "allowed",
			scope: decision === "site" ? "origin" : (entry.broad?.scope ?? decision),
		};
	}

	/** The decisions still in force, for the approvals list. */
	grants(): ApprovalRecord[] {
		return [...this.store.records];
	}

	/**
	 * Revoke every site approval.
	 *
	 * Bulk, and separate from clearing cookies (design 9.4): revoking does not log
	 * the user out, and clearing cookies does not restore the deny state — so an
	 * origin the agent was denied on will prompt again afterwards, which is stated
	 * in the copy rather than left to look like a bug.
	 */
	revokeAll(): number {
		const removed = this.store.records.length;
		this.store.origins = {};
		this.store.siteGrants = { version: 1, grants: {} };
		this.store.records = [];
		this.resetPending();
		this.persist();
		this.onChanged();
		return removed;
	}

	/** Drop everything about the pending flow. Used by the host-off toggle, which
	 * tears the state file down so discovery is honest. */
	resetPending(): void {
		this.revision += 1;
		this.documents.clear();
		this.queue = [];
		this.results = {};
		this.onceGrants = {};
		this.tombstones = {};
		this.onChanged();
	}

	// ---- internals -----------------------------------------------------------

	private decisionFor(entry: AccessQueueEntry): OriginDecision | undefined {
		const receipt = this.results[resultKey(entry.entryId, entry.requester)];
		if (!receipt) return undefined;
		if (receipt.state === "denied") return "deny";
		if (receipt.state === "allowed") return "site";
		return undefined;
	}

	/** Replace-don't-queue: the live entry for another origin (or another
	 * requester) is displaced, and its requester gets a tombstone so its next poll
	 * reads "superseded" rather than the neutral "none". */
	private displaceLive(now: number): void {
		const live = liveQueue(this.queue, now);
		if (!live.length) return;
		for (const entry of live) {
			this.tombstones[receiptKey(entry.origin, entry.requester)] = tombstoneFor(
				{
					origin: entry.origin,
					hostname: entry.displayAuthority,
					requester: entry.requester,
					requestedAt: entry.requestedAt,
					expiresAt: entry.expiresAt,
				},
			);
		}
		this.queue = [];
		this.trimTombstones();
	}

	private trimTombstones(): void {
		const entries = Object.entries(this.tombstones);
		if (entries.length <= TOMBSTONE_CAP) return;
		for (const [key] of entries
			.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
			.slice(0, entries.length - TOMBSTONE_CAP)) {
			delete this.tombstones[key];
		}
	}

	private sweep(now: number): void {
		const live = liveQueue(this.queue, now);
		this.queue = live;
		this.results = cleanResults(this.results, now);
		for (const [origin, grant] of Object.entries(this.onceGrants)) {
			if (now >= grant.expiresAt) delete this.onceGrants[origin];
		}
	}

	private persist(): void {
		const ok = writeJsonAtomic(this.path, this.store);
		if (!ok) {
			this.log(
				`[browser] could not write the approvals store at ${this.path}; the decision is in force for this run only`,
			);
		}
	}

	private persistIfChanged(): void {
		this.persist();
	}

	/** Diagnosic facts for `status` (never enforced from here). */
	describe(): {
		allowed_origins: number;
		denied_origins: number;
		broad_grants: number;
		pending: number;
		file_mode: number;
	} {
		return {
			allowed_origins: Object.values(this.store.origins).filter(
				(v) => v === "allow",
			).length,
			denied_origins: Object.values(this.store.origins).filter(
				(v) => v === "deny",
			).length,
			broad_grants: Object.keys(this.store.siteGrants.grants ?? {}).length,
			pending: this.pendingEntries().length,
			file_mode: PRIVATE_FILE_MODE,
		};
	}

	/** The path the store lives at, for `status` and for the Settings surface. */
	get filePath(): string {
		return this.path;
	}

	/** Whether a URL is covered by a stored grant, and by which scope (the
	 * approvals list and the diagnostic path both want this).
	 *
	 * The vendored `matchingGrantScope` also reads the extension's LEGACY
	 * `hostGrants` shape (0.1.4-0.1.7 loopback all-ports). This host passes
	 * `undefined` for it deliberately: the store is new here, so there are no
	 * legacy records to read, and the module's own schema check turns an absent
	 * shape into "no legacy grant" rather than into a second grant model with no
	 * data behind it. */
	grantScopeFor(url: URL): string | null {
		return matchingGrantScope(
			this.store.origins,
			undefined,
			url,
			this.store.siteGrants,
		);
	}
}
