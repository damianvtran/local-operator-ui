import { BrowserHostError } from "./errors";

/**
 * The in-process ownership ledger and its fencing gate.
 * Design: docs/design/ui-browser-tab.md 4 (`owner_*` "implemented against an
 * in-process ledger keyed by session_id + owner_proof + owner_generation, with
 * the same param contract"), 10.5 (why the session must select the host).
 *
 * WHY this exists at all, when the ledger is only in memory: `owner_*` is the
 * session's crash-recovery contract. A session that dies mid-task leaves a tab
 * behind; on resume it sends `owner_recover` with the proof and generation it
 * wrote to its own sidecar record, and the answer tells it whether the tab is
 * still there, whether the scope is retained, and whether the previous run
 * settled. Without these four methods the session's recovery path has nowhere to
 * go on a UI-only host, and `recover`/`retain`/`release` fall through to
 * unrelated branches of the tool (design 10.5, consequence 1).
 *
 * The semantics are the extension's (`extension/src/ownership.ts`), kept
 * deliberately identical so one session-side implementation serves both hosts:
 *
 * - a private `owner_proof` proves the caller is the owner of a scope, and a
 *   stale or absent proof is refused — a capability is not a name;
 * - `open` is fenced per ALLOCATION ID, so a lost response is replayed rather
 *   than turning into a second tab;
 * - a terminal scope refuses every method except `close` and `tabs` until it is
 *   resumed with `resumed_scope`;
 * - `retain` outlives a `finish`, so a finished scope with a retention reason
 *   keeps its tabs and answers "retained" instead of closing them.
 *
 * WHAT IS DIFFERENT FROM THE EXTENSION, and why: there is no storage.session to
 * survive a service-worker death, because there is no service worker — the host
 * is one main process. A ledger that lives exactly as long as the process that
 * owns the tabs is not a weaker guarantee here; it is the same guarantee, since
 * the tabs die with the process too.
 */

/** One owner's scope. Field names follow the extension's, so a reviewer
 * comparing the two is comparing like with like. */
export interface OwnerScope {
	session: string;
	generation: string;
	terminal?: string;
	retention?: string;
	allocations: Record<string, { tab?: string; state: string }>;
	/** Tabs a crash may have created whose handle never reached the journal.
	 * Counted and reported, NEVER closed by inference: a guess that closes the
	 * wrong tab is worse than a leak the user can see. */
	unknownReservations: number;
}

type Params = Record<string, unknown>;

/** The proof format the session mints (`resources.py` writes a urlsafe token)
 * and the extension enforces. Kept as the same shape so one client serves both. */
const PROOF_SHAPE = /^[a-zA-Z0-9_-]{32,}$/;

export interface OwnershipHooks {
	/** Close a tab by surface token, for `owner_finish`. Returns whether the close
	 * completed; a close that did not is `pending`, which is a retryable
	 * obligation rather than a failure. */
	closeTab: (token: string) => Promise<boolean>;
	/** Whether a surface token still names a live tab. */
	isLive: (token: string) => boolean;
}

export class OwnershipLedger {
	private readonly scopes = new Map<string, OwnerScope>();
	/** Per-OWNER command lanes, keyed by `owner_proof`. The lane spans a handler
	 * deliberately: it is what stops a same-owner `owner_finish` overtaking its own
	 * in-flight `open` and letting a late navigation resurrect the tab. Per proof,
	 * so it starves nobody else. */
	private readonly lanes = new Map<string, Promise<unknown>>();

	constructor(private readonly hooks: OwnershipHooks) {}

	private identity(params: Params): [string, string, string] {
		const proof = String(params.owner_proof ?? "");
		const session = String(params.requester ?? "");
		const generation = String(params.owner_generation ?? "");
		if (
			!PROOF_SHAPE.test(proof) ||
			!session.startsWith("session:") ||
			!generation
		) {
			throw new BrowserHostError(
				"owner_refused",
				"missing private browser ownership proof",
			);
		}
		return [proof, session, generation];
	}

	/** The scope a proof names, after the session and generation checks. Creation
	 * is opt-in per method, matching the extension's `create` flag. */
	private mutate<T>(
		params: Params,
		fn: (scope: OwnerScope) => T,
		create = false,
	): T {
		const [proof, session, generation] = this.identity(params);
		let scope = this.scopes.get(proof);
		if (!scope && create) {
			scope = {
				session,
				generation,
				allocations: {},
				unknownReservations: 0,
			};
			this.scopes.set(proof, scope);
		}
		if (
			!scope ||
			scope.session !== session ||
			scope.generation !== generation
		) {
			throw new BrowserHostError(
				"owner_refused",
				"browser owner generation is stale or unresolved",
			);
		}
		return fn(scope);
	}

	/** Record (or clear) the tab an allocation owns. */
	recordAllocation(params: Params, tab: string, state: string): void {
		if (!params.owner_proof) return; // A legacy client keeps capability-only behaviour.
		this.mutate(params, (scope) => {
			const allocation = String(params.allocation_id ?? "");
			if (!allocation) {
				throw new BrowserHostError("owner_refused", "browser scope ended");
			}
			if (scope.terminal) {
				throw new BrowserHostError("owner_refused", "browser scope ended");
			}
			scope.allocations[allocation] = { tab: tab || undefined, state };
		});
	}

	/**
	 * Run a command under the ownership gate.
	 *
	 * The order of the checks is the extension's, and it matters: `open`'s
	 * allocation fence runs BEFORE the terminal check, because an `open` that
	 * replays an allocation the scope already knows must succeed even after the
	 * scope is resolved (that is exactly the lost-response case).
	 */
	withOwnership(
		method: string,
		params: Params,
		handler: () => Promise<Record<string, unknown>>,
	): Promise<Record<string, unknown>> {
		const key = String(params.owner_proof ?? "legacy");
		const previous = this.lanes.get(key) ?? Promise.resolve();
		const operate = async (): Promise<Record<string, unknown>> => {
			if (!params.owner_proof) {
				// A legacy capability cannot bypass fencing for a modern allocation.
				if (params.tab) {
					const token = String(params.tab);
					const scope = this.scopeOwning(token);
					if (scope?.allocations && this.tokenHasAllocation(token)) {
						throw new BrowserHostError(
							"owner_refused",
							"owner-aware client required",
						);
					}
				}
				return handler();
			}
			const [proof, session, generation] = this.identity(params);
			if (method === "owner_recover") {
				const scope = this.scopes.get(proof);
				if (!scope) return { ownership_version: 1, state: "unresolved" };
				const predecessors = Array.isArray(params.previous_generations)
					? params.previous_generations
					: [];
				if (
					scope.session !== session ||
					(scope.generation !== generation &&
						scope.generation !== params.previous_generation &&
						!predecessors.includes(scope.generation))
				) {
					throw new BrowserHostError(
						"owner_refused",
						"browser owner generation is stale",
					);
				}
				// A resume retires the ended scope. Keyed on the owner's own
				// `resumed_scope` statement rather than on the generation changing: an
				// in-process child reuses one generation per session, so a
				// generation-change test would never fire and `open` would refuse
				// forever after telling the owner to resume.
				if (scope.generation !== generation || params.resumed_scope === true) {
					// Cleared by assignment rather than `delete`: the field's only readers
					// test it for truthiness, and `delete` on an object shape here is the
					// one form the repo's linter refuses outright.
					scope.terminal = undefined;
				}
				scope.generation = generation;
				const allocation =
					scope.allocations[String(params.allocation_id ?? "")];
				const live = allocation?.tab
					? this.hooks.isLive(allocation.tab)
					: false;
				const unresolved =
					allocation &&
					["allocating", "allocated", "cleanup_pending"].includes(
						allocation.state,
					);
				return {
					ownership_version: 1,
					state: live ? allocation.state : unresolved ? "allocating" : "closed",
					tab: live ? (allocation.tab ?? "") : "",
					retention: scope.retention ?? "",
					terminal: scope.terminal ?? "",
					unknown_reservations: scope.unknownReservations,
				};
			}

			if (method === "open") {
				const existing = this.mutate(
					params,
					(value) => {
						if (value.terminal) {
							throw new BrowserHostError(
								"owner_refused",
								"browser scope ended; resume a new generation first",
							);
						}
						const id = String(params.allocation_id ?? "");
						if (!id) {
							throw new BrowserHostError(
								"owner_refused",
								"missing browser allocation id",
							);
						}
						return value.allocations[id];
					},
					true,
				);
				if (params.tab) {
					if (existing?.tab !== params.tab) {
						throw new BrowserHostError(
							"owner_refused",
							"tab does not belong to allocation",
						);
					}
					return handler();
				}
				if (existing?.tab && this.hooks.isLive(existing.tab)) {
					// A response may have been lost after a successful navigation: return
					// the recorded capability rather than navigating a second time.
					return {
						tab: existing.tab,
						state: existing.state,
						replayed: true,
					};
				}
				if (existing && existing.state !== "closed") {
					// The journal says this allocation began and no live tab carries it:
					// that tab is UNKNOWN — counted, never closed by inference — and it
					// must not lock the owner out of browsing, so the allocation is
					// retried.
					this.mutate(params, (value) => {
						value.unknownReservations += 1;
					});
				}
				this.recordAllocation(params, "", "allocating");
				return handler();
			}

			// The generic scope lookup comes AFTER the `open` branch, and the order is
			// the extension's: `open` creates its own scope through the allocation
			// fence below, so looking the scope up first would refuse the very first
			// `open` of a session with "generation is stale or unresolved" — a scope
			// that does not exist yet is not a stale one.
			const scope = this.mutate(
				params,
				(value) => value,
				[
					"tabs",
					"status",
					"request_access",
					"await_access",
					"cancel_access",
					"owner_retain",
					"owner_finish",
				].includes(method),
			);

			if (method === "owner_retain") {
				const reason = String(params.reason ?? "").trim();
				if (!reason || reason.length > 500) {
					throw new BrowserHostError(
						"owner_refused",
						"retention requires a bounded reason",
					);
				}
				this.mutate(params, (value) => {
					value.retention = reason;
				});
				return { state: "retained" };
			}
			if (method === "owner_release") {
				this.mutate(params, (value) => {
					value.retention = undefined;
				});
				return { state: "released", terminal: scope.terminal ?? "" };
			}
			if (method === "owner_finish") {
				const retained = scope.retention;
				this.mutate(params, (value) => {
					value.terminal = String(params.outcome ?? "completed");
				});
				if (retained) return { state: "retained" };
				let pending = false;
				for (const allocation of Object.values(scope.allocations)) {
					if (!allocation.tab || !this.hooks.isLive(allocation.tab)) {
						if (
							["allocating", "allocated", "cleanup_pending"].includes(
								allocation.state,
							)
						) {
							pending = true;
						}
						continue;
					}
					const closed = await this.hooks.closeTab(allocation.tab);
					if (!closed) pending = true;
				}
				return { state: pending ? "pending" : "closed" };
			}

			if (scope.terminal && method !== "close" && method !== "tabs") {
				throw new BrowserHostError("owner_refused", "browser scope ended");
			}
			if (
				params.tab &&
				!Object.values(scope.allocations).some(
					(allocation) => allocation.tab === params.tab,
				)
			) {
				throw new BrowserHostError(
					"owner_refused",
					"tab does not belong to this browser owner",
				);
			}
			return handler();
		};

		const run = previous.catch(() => {}).then(operate);
		this.lanes.set(key, run);
		void run
			.finally(() => {
				if (this.lanes.get(key) === run) this.lanes.delete(key);
			})
			.catch(() => {});
		return run;
	}

	/** The scope a token belongs to, if any (legacy-path fencing only). */
	private scopeOwning(token: string): OwnerScope | undefined {
		for (const scope of this.scopes.values()) {
			if (Object.values(scope.allocations).some((a) => a.tab === token)) {
				return scope;
			}
		}
		return undefined;
	}

	private tokenHasAllocation(token: string): boolean {
		return this.scopeOwning(token) !== undefined;
	}

	/** Forget every scope. Called when the host stops, so a restart cannot
	 * half-remember a previous process's tabs. */
	clear(): void {
		this.scopes.clear();
	}

	/** Diagnostic counts for `status`. */
	describe(): { scopes: number; retained: number; terminal: number } {
		let retained = 0;
		let terminal = 0;
		for (const scope of this.scopes.values()) {
			if (scope.retention) retained += 1;
			if (scope.terminal) terminal += 1;
		}
		return { scopes: this.scopes.size, retained, terminal };
	}
}
