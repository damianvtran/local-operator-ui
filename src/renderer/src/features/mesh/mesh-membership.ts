/**
 * Whether this device is in a mesh AT ALL - the question the rail row and the palette
 * destination are gated on, and it is a MEMBERSHIP fact rather than a capability one.
 *
 * `features.peers` CANNOT answer it, which is what review round 1 caught (R1-1): lop
 * advertises that key unconditionally and on purpose - "the KEYS answer 'what can this
 * backend do' rather than 'is this machine in a mesh'"
 * (`local_operator/server/routes/capabilities.py`) - so a device in no network carries it
 * too. The backend names the answer instead: "a device in no network answers an empty
 * catalogue, and an empty catalogue mounts nothing". The catalogue's own emptiness is
 * therefore the fact, read here rather than inferred from the key.
 *
 * PURE, and in its own module, so the five cases can be executed by a test without a
 * query client, React or a router (`scripts/mesh-tab.test.mjs` bundles this file with
 * esbuild). The hook that feeds it lives in `mesh-store.ts`, beside the query it reads.
 *
 * THE COST, stated precisely because the architecture brief asserted the opposite and
 * review round 2 (R2-1) measured what the code actually did: a mesh-capable daemon
 * serves ONE `networks.list` per window for this row, issued when the window starts. It
 * is a real fan-out - the backend's listing dials every peer - so the RAIL ASKS FOR NO
 * INTERVAL, no window-focus refetch and an infinite `staleTime` (`mesh-store.ts`'s
 * `poll: false`), and it rides the page's own 30 s observer through the shared cache
 * entry while the tab is open. Nothing polls because a rail row is on screen: the
 * always-mounted component is exactly why this read is one-shot, and "one catalogue read"
 * with no cadence attached is what three sentences in this change claimed before the
 * measurement was made. A daemon that does not advertise `peers` issues nothing at all.
 *
 * That read is safe by construction - the backend short-circuits it on
 * `has_any_network()`, an `is_dir` test whose `_networks()` returns `[]` "so nothing else
 * mkdirs" - so a machine that has never joined a network creates nothing. What the
 * brief's "no call is issued" line was protecting is the byte-for-byte chrome, and
 * membership gating protects that BETTER than the key did: the row is absent until the
 * device is KNOWN to be in a mesh, where the key alone put a rail item on every
 * mesh-capable install.
 *
 * `unknown` is a real answer and it mounts nothing: no capability, no answer yet, or a
 * first read that failed all mean "not known to be in a mesh", and a row for an unknown
 * mesh is the dead end this gate exists to prevent. A device already known to be in one
 * keeps `member` through a failed refetch, because React Query retains the last good
 * `data` - so a relay hiccup does not make the row disappear under the user.
 */
export type MeshMembership = "unknown" | "none" | "member";

/**
 * The rule, as a pure function, so the cases can be tested without a query client.
 *
 * `networks` is `undefined` until an answer lands, which is what separates "we have not
 * asked" from "the answer is none" - the distinction the row's gate turns on.
 */
export function meshMembership(state: {
	enabled: boolean;
	networks: { networks: unknown[] } | undefined;
}): MeshMembership {
	if (!state.enabled) return "unknown";
	if (!state.networks) return "unknown";
	return state.networks.networks.length > 0 ? "member" : "none";
}
