import type { TabRecord, TabRegistry } from "./registry";

// Reuse the existing 45-minute idle window as a protection floor, never as
// proof that an owner ended or a human yielded a tab.
export const RECLAIM_QUIET_MS = 45 * 60_000;
export const REAP_SWEEP_INTERVAL_MS = 60_000;
const GENERATION_DIGEST = /^[a-f0-9]{64}$/;

export type OwnerStatus = {
	session_id: string;
	verdict: "live" | "ended" | "unknown";
	turn: "running" | "delegating" | "awaiting_user" | "idle" | "unknown";
	retained: boolean | null;
	provenance: "execution_lease" | "session_claim" | "browser_terminal" | "none";
	generation: string | null;
};

export type TabAuthProtection =
	| "non_auth"
	| "auth"
	| "pending_prompt"
	| "unknown";

type ReclaimResource = Pick<
	TabRecord,
	"tabId" | "epoch" | "documentEpoch" | "allocationId"
>;

export interface OwnerStatusResolver {
	/** Trusted daemon read; no caller-supplied verdicts. */
	read(
		sessionIds: readonly string[],
	): Promise<{ owners: readonly OwnerStatus[] } | null>;
	/** Mutation-side authority for these exact resources, not a cached HTTP read.
	 * Must fail closed unless it can attest the generation remains current through
	 * the synchronous mutation (including against resumed/new owner scopes). */
	currentGeneration(
		sessionId: string,
		resources: readonly Readonly<ReclaimResource>[],
	): string | null;
}

type Selection = Pick<
	TabRecord,
	| "nonce"
	| "epoch"
	| "documentEpoch"
	| "activityEpoch"
	| "openedByTab"
	| "sessionId"
	| "allocationId"
>;

interface ReaperOptions {
	registry: TabRegistry;
	resolver?: OwnerStatusResolver;
	protected: (record: TabRecord) => boolean;
	/** Undefined/unknown is not proof; page URLs and DOM are not auth classifiers. */
	authProtection?: (record: Readonly<ReclaimResource>) => TabAuthProtection;
	onReclaimed?: (records: readonly TabRecord[]) => void;
	now?: () => number;
}

function resourceOf({
	tabId,
	epoch,
	documentEpoch,
	allocationId,
}: TabRecord): ReclaimResource {
	return { tabId, epoch, documentEpoch, allocationId };
}

function endedGeneration(
	response: { owners: readonly OwnerStatus[] } | null,
	id: string,
): string | null {
	if (!Array.isArray(response?.owners)) return null;
	const entries = response.owners.filter((row) => row?.session_id === id);
	const row = entries[0];
	if (
		entries.length !== 1 ||
		!row ||
		row.verdict !== "ended" ||
		row.retained !== false ||
		row.turn !== "idle" ||
		(row.provenance !== "execution_lease" &&
			row.provenance !== "browser_terminal") ||
		typeof row.generation !== "string" ||
		!GENERATION_DIGEST.test(row.generation)
	)
		return null;
	return row.generation;
}

/** Host-only and ended-only. No capacity, popup or public/RPC call can nominate
 * a target or turn its own authority into permission to reclaim another owner. */
export class TabReaper {
	private sweeping = false;
	private stopped = false;

	constructor(private readonly options: ReaperOptions) {}

	stop(): void {
		this.stopped = true;
	}

	async sweep(): Promise<number> {
		const { registry, resolver, authProtection } = this.options;
		if (!resolver || !authProtection || this.stopped || this.sweeping) return 0;
		const selectionEpoch = registry.reclaimEpoch();
		if (selectionEpoch === null) return 0;
		const candidates = registry
			.list()
			.filter(
				(record) =>
					record.owner === "agent" && record.sessionId && record.nonce,
			);
		const selection = new Map<number, Selection>(
			candidates.map((record) => [
				record.tabId,
				{
					nonce: record.nonce,
					epoch: record.epoch,
					documentEpoch: record.documentEpoch,
					activityEpoch: record.activityEpoch,
					openedByTab: record.openedByTab,
					sessionId: record.sessionId,
					allocationId: record.allocationId,
				},
			]),
		);
		const ids = [
			...new Set(
				candidates.flatMap((record) =>
					record.sessionId ? [record.sessionId] : [],
				),
			),
		];
		if (!ids.length) return 0;
		this.sweeping = true;
		try {
			// No stored cold streak: a failed read, an intervening command, or a
			// changed generation invalidates the selection, never extends its life.
			const first = await this.read(resolver, ids);
			if (!first || this.stopped || registry.reclaimEpoch() !== selectionEpoch)
				return 0;
			const confirmed = new Map(
				ids.map((id) => [id, endedGeneration(first, id)]),
			);
			const fresh = await this.read(resolver, ids);
			if (!fresh) return 0;
			let closed = 0;
			for (const candidate of candidates.sort(
				(a, b) => a.lastUsedAt - b.lastUsedAt,
			)) {
				const owner = selection.get(candidate.tabId)?.sessionId;
				if (!owner) continue;
				const generation = endedGeneration(fresh, owner);
				if (!generation || generation !== confirmed.get(owner)) continue;
				closed += registry.reclaimEnded(
					() =>
						this.eligibleClosure(
							candidate,
							owner,
							generation,
							selectionEpoch,
							selection,
						),
					this.options.onReclaimed,
				);
			}
			return closed;
		} finally {
			this.sweeping = false;
		}
	}

	private async read(resolver: OwnerStatusResolver, ids: readonly string[]) {
		try {
			return await resolver.read(ids);
		} catch {
			return null;
		}
	}

	/** The only mutation-time check. No await, renderer callbacks or release hooks
	 * between approval here and dropping the approved set in the registry. */
	private eligibleClosure(
		root: TabRecord,
		owner: string,
		generation: string,
		selectionEpoch: number,
		selection: ReadonlyMap<number, Selection>,
	): TabRecord[] | null {
		const {
			registry,
			resolver,
			protected: isProtected,
			authProtection,
		} = this.options;
		if (
			this.stopped ||
			registry.reclaimEpoch() !== selectionEpoch ||
			registry.get(root.tabId) !== root
		)
			return null;
		const now = (this.options.now ?? Date.now)();
		const all = registry.list();
		const closure: TabRecord[] = [];
		const seen = new Set<number>();
		const check = (record: TabRecord): boolean => {
			const before = selection.get(record.tabId);
			return (
				!!before &&
				record.owner === "agent" &&
				record.sessionId === owner &&
				before.sessionId === owner &&
				!!record.nonce &&
				record.nonce === before.nonce &&
				record.epoch === before.epoch &&
				record.documentEpoch === before.documentEpoch &&
				record.activityEpoch === before.activityEpoch &&
				record.openedByTab === before.openedByTab &&
				record.allocationId === before.allocationId &&
				!record.humanOrigin &&
				!record.adopted &&
				!record.restored &&
				record.handedFrom === null &&
				record.handedTo === null &&
				!record.presented &&
				registry.activeTab !== record &&
				!registry.isBusy(record.tabId) &&
				now - record.lastUsedAt >= RECLAIM_QUIET_MS &&
				(record.lastHumanUseAt === null ||
					now - record.lastHumanUseAt >= RECLAIM_QUIET_MS) &&
				!isProtected(record) &&
				authProtection?.(resourceOf(record)) === "non_auth"
			);
		};
		// Start at the top: an orphaned/unknown opener, or an opener that is in
		// human custody, must not be bypassed by selecting one of its children.
		let top = root;
		while (top.openedByTab !== null) {
			if (seen.has(top.tabId)) return null;
			seen.add(top.tabId);
			const opener = registry.get(top.openedByTab);
			if (!opener) return null;
			top = opener;
		}
		seen.clear();
		const visit = (record: TabRecord): boolean => {
			if (seen.has(record.tabId) || !check(record)) return false;
			seen.add(record.tabId);
			closure.push(record);
			return all
				.filter((child) => child.openedByTab === record.tabId)
				.every(visit);
		};
		// Independently allocated children belong to their scope, not the opener.
		// Until that relationship is resolved, don't remove either side of it.
		if (
			top !== root ||
			!visit(root) ||
			closure.slice(1).some((record) => record.allocationId) ||
			resolver?.currentGeneration(owner, closure.map(resourceOf)) !== generation
		)
			return null;
		return closure;
	}
}
