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
 * THE COST, stated because the architecture brief asserted the opposite: a device in no
 * network now issues ONE catalogue read it would not have. That read is safe by
 * construction - the backend short-circuits it on `has_any_network()`, an `is_dir` test
 * whose `_networks()` returns `[]` "so nothing else mkdirs" - so a machine that has never
 * joined a network creates nothing. What the brief's "no call is issued" line was
 * protecting is the byte-for-byte chrome, and membership gating protects that BETTER than
 * the key did: the row is absent until the device is KNOWN to be in a mesh, where the key
 * alone put a rail item on every mesh-capable install.
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
