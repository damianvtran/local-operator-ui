import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { t } from "@shared/i18n";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";

export const MIN_HUB_MUTATION_CORE = "0.72.1";
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type BackendBridge = NonNullable<Window["api"]["backend"]>;

/** Only published triples prove these fixes. Prefix comparators accept rc/dev
 * stamps and therefore cannot certify the first fixed release. No capability
 * changed for the core policy/merge fixes, so existing feature bits are not proof. */
export function hubMutationVersionSafe(version: string | null | undefined) {
	const match =
		typeof version === "string" ? RELEASE_VERSION.exec(version) : null;
	if (!match) return false;
	const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (!parts.every(Number.isSafeInteger)) return false;
	const minimum = [0, 72, 1];
	for (let index = 0; index < minimum.length; index++) {
		if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
	}
	return true;
}

export function hubMutationSnapshotSafe(
	snapshot: DaemonStatusSnapshot | null | undefined,
) {
	return (
		!!snapshot &&
		snapshot.state === "attached" &&
		!!snapshot.url &&
		!!snapshot.instanceId &&
		Number.isSafeInteger(snapshot.pid) &&
		(snapshot.pid ?? 0) > 0 &&
		hubMutationVersionSafe(snapshot.version)
	);
}

export const hubMutationUpgradeMessage = () =>
	t("ui.hub.status.core_update_required", { minimum: MIN_HUB_MUTATION_CORE });

export class HubMutationUpgradeRequired extends Error {
	constructor() {
		super(hubMutationUpgradeMessage());
		this.name = "HubMutationUpgradeRequired";
	}
}

const sameIdentity = (a: DaemonStatusSnapshot, b: DaemonStatusSnapshot) =>
	a.url === b.url && a.instanceId === b.instanceId && a.pid === b.pid;

/** Subscribe BEFORE the fresh MAIN pull. A newer push wins a delayed positive
 * pull; a target replacement cannot authorize an intent reviewed on another
 * daemon. MAIN's snapshot and desktop transport share BackendServiceManager's
 * admitted identity/url, never the renderer's configured apiConfig origin.
 * Accepted in-flight work is not replayed/aborted on a later push. Every new
 * invocation rechecks; the listener is removed even when the transport refuses. */
export async function guardHubMutation<T>(
	run: () => Promise<T>,
	expected: DaemonStatusSnapshot | null | undefined,
	bridge: BackendBridge | undefined = typeof window === "undefined"
		? undefined
		: window.api?.backend,
): Promise<T> {
	if (
		!hubMutationSnapshotSafe(expected) ||
		!bridge?.getStatus ||
		!bridge.onStatusChange
	)
		throw new HubMutationUpgradeRequired();
	let pushed: DaemonStatusSnapshot | null = null;
	let changedIdentity = false;
	const off = bridge.onStatusChange((snapshot) => {
		pushed = snapshot;
		if (expected && !sameIdentity(expected, snapshot)) changedIdentity = true;
	});
	try {
		let pulled: DaemonStatusSnapshot;
		try {
			pulled = await bridge.getStatus();
		} catch {
			throw new HubMutationUpgradeRequired();
		}
		const latest = pushed ?? pulled;
		if (
			changedIdentity ||
			!hubMutationSnapshotSafe(latest) ||
			!sameIdentity(expected as DaemonStatusSnapshot, latest)
		)
			throw new HubMutationUpgradeRequired();
		return await run();
	} finally {
		off();
	}
}

/** Keep reads and global connectivity unchanged. Writes are temporarily disabled
 * while this existing health query is refreshing (including its normal poll),
 * not enabled from a stale/placeholder/error snapshot. Cancel/close stays usable.
 * Browser health fallback is deliberately insufficient: only MAIN knows which
 * identity its desktop transport currently targets. */
export function useHubMutationSafety() {
	const health = useServerHealth();
	const snapshot = health.data?.snapshot;
	const canWrite =
		!!window.api?.backend &&
		!health.isFetching &&
		!health.isError &&
		!health.isPlaceholderData &&
		hubMutationSnapshotSafe(snapshot);
	// A normal poll disables writes briefly, but must not flash an upgrade notice
	// over an already verified version. Unknown/failed/old snapshots name the rule.
	return {
		canWrite,
		snapshot,
		upgradeMessage:
			hubMutationSnapshotSafe(snapshot) && !health.isError
				? null
				: hubMutationUpgradeMessage(),
	};
}
