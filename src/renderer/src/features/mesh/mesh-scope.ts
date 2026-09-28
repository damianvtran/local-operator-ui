/**
 * The canvas's second layer of meaning: what the published ADDRESSES can and cannot
 * say about which devices are on the same network.
 *
 * ## Why almost nothing is drawn, and in three tiers
 *
 * The wire publishes, per membership, `endpoints: string[]` - the addresses the
 * OWNING device chose to advertise (`local_operator/network/addresses.py`'s
 * `local_ipv4_addresses()` via `relay.advertise_endpoints`). Everything this file
 * does is arithmetic on those strings, and the arithmetic is weak in a way the
 * renderer must not paper over:
 *
 * ```
 * 192.168.1.40   a home LAN
 * 10.88.0.7      a WireGuard tunnel - ITS DEFAULT SUBNET, 10.88.0.0/24
 * 100.64.0.9     CGNAT, e.g. a Tailscale address
 * 203.0.113.9    a public address on a colo box
 * ```
 *
 * `10.88.0.0/24` is WireGuard's default and **collides across unrelated installs**:
 * two machines on two different WireGuard tunnels share a prefix while sharing no
 * path at all. So a shared prefix is evidence of nothing on its own, and this file
 * reports it as what it is - a probable grouping, drawn dashed, labelled `same
 * prefix` rather than with a claim about the network's shape.
 *
 * | tier | what it rests on | drawn as |
 * |---|---|---|
 * | `shared` | one side of the comparison is an interface THIS process runs on | **solid** enclosure, `shared with this device` |
 * | `probable` | two peers' published octets agree | **dashed** enclosure, `same prefix` |
 * | `declared` | the operator authored it (no wire field yet - see `scope` below) | **solid** enclosure, `declared` |
 * | anything else | - | **nothing at all** |
 *
 * ## What this file refuses to draw, and why each refusal is load-bearing
 *
 * 1. **A solid enclosure asserting a shared path (LAN/VPN/WAN) from a prefix.** The
 *    WireGuard collision above makes it indistinguishable from a home LAN, so a
 *    solid boundary there would be a confident lie about the network's shape.
 * 2. **"local" vs "remote" inferred from private-looking octets.** `100.64/10` and
 *    `10.88/24` are not "your LAN", and a colo box's public address may be a shorter
 *    path than either. Nothing here distinguishes local from remote by octet.
 * 3. **Latency, quality or link speed.** `rtt_ms` is documented always-`null`; a
 *    dashed "slow link" would be a lie.
 * 4. **A public-internet boundary as a shape around nodes.** The internet is not a
 *    container, it is the ABSENCE of one: nodes whose prefixes match nothing are
 *    simply not grouped.
 * 5. **Subnet masks.** The wire publishes addresses, not masks. `/24` is a TEST
 *    APPLIED HERE and the label says `x` rather than `/24`, because drawing
 *    `10.88.0.4/24` would assert a mask nobody sent.
 * 6. **A boundary produced by a duplicate address.** Two devices publishing one
 *    address is a DATA ANOMALY (a copied config, a stale record) rather than a
 *    shared path - it is exactly the class of thing `NetworkMember.suspect` exists
 *    for, and the shipped fixtures contain it: every member advertises
 *    `10.0.0.4:4097`, over two devices that cannot both hold one address. An address
 *    carried by more than one device contributes to **no group at all**.
 */

import type { MeshDevice } from "./mesh-graph";

/** The three tiers that are drawn. Everything else is not drawn. */
export type ScopeTier = "shared" | "probable" | "declared";

/** One drawn enclosure: the devices it covers, and the words that say what it is. */
export type PrefixGroup = {
	/** `a.b.c.x`, the prefix with the host octet elided - never a `/24`, see refusal 5. */
	prefix: string;
	tier: ScopeTier;
	/** The devices inside the enclosure, in the order the graph draws them. */
	deviceIds: string[];
	/** The tier said in words, for the label and the accessible name. */
	words: string;
};

/**
 * A `host:port` split, and deliberately a shallow one.
 *
 * The published strings are `host:port` on IPv4 in every install this ships to, but
 * the port is not this file's business: it is kept because the caller may want it
 * and because dropping it silently would be a second guess about a string the
 * backend wrote. A BRACKETED IPv6 literal parses (so a caller can read its host) and
 * then groups with nothing - a `/24` is not a thing on IPv6, and this file has no
 * second address family to fall back on. A bare host with no port parses too, since
 * the wire's own examples carry both shapes.
 */
export function parseEndpoint(
	endpoint: string,
): { host: string; port: number | null } | null {
	const token = endpoint.trim();
	if (!token) return null;
	if (token.startsWith("[")) {
		const close = token.indexOf("]");
		if (close <= 1) return null;
		const host = token.slice(1, close);
		const rest = token.slice(close + 1);
		if (!rest) return { host, port: null };
		if (!rest.startsWith(":")) return null;
		const port = Number(rest.slice(1));
		return { host, port: Number.isInteger(port) ? port : null };
	}
	const cut = token.lastIndexOf(":");
	if (cut > 0) {
		const tail = token.slice(cut + 1);
		if (/^\d+$/.test(tail)) {
			return { host: token.slice(0, cut), port: Number(tail) };
		}
	}
	return { host: token, port: null };
}

/**
 * The `/24` prefix a host belongs to, or `null` when the host is not an IPv4
 * address this test can be applied to.
 *
 * Octet-validated rather than regex-loose: `10.0.0.4:4097` reaching here as a host
 * with the port still attached is the mistake this refuses, because `"4:4097"` as
 * an octet would group addresses that share nothing.
 */
export function subnet24(host: string): string | null {
	const parts = host.trim().split(".");
	if (parts.length !== 4) return null;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const value = Number(part);
		if (value > 255) return null;
	}
	return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/** `a.b.c.x` - the prefix as the label spells it, the host octet elided. */
export function prefixLabel(prefix: string): string {
	return `${prefix}.${
		/*
		 * `x`, not `*` or a fourth octet: the label says a TEST was applied to a
		 * published address, and `10.88.0.x` reads as "the addresses in this range"
		 * rather than as a mask or as a wildcard someone could dial.
		 */
		"x"
	}`;
}

/**
 * Every address that more than one device publishes - refusal 6's set.
 *
 * Counted per DEVICE rather than per membership: one laptop in two networks that
 * advertises the same address in both is one device holding one address, not a
 * collision, and this must not quietly erase its own honest grouping.
 */
function duplicatedAddresses(
	owners: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
	const seen = new Map<string, number>();
	for (const addresses of owners.values()) {
		for (const address of addresses) {
			seen.set(address, (seen.get(address) ?? 0) + 1);
		}
	}
	const duplicated = new Set<string>();
	for (const [address, count] of seen) {
		if (count > 1) duplicated.add(address);
	}
	return duplicated;
}

/** The device's own addresses, as `host:port` strings, duplicates dropped later. */
function deviceAddresses(device: MeshDevice): ReadonlySet<string> {
	return new Set(
		device.endpoints.map((endpoint) => endpoint.trim()).filter(Boolean),
	);
}

/**
 * The enclosures to draw, from the addresses in hand.
 *
 * `selfDeviceId` is the device the solid tier is measured AGAINST, and it is
 * deliberately not a member of any group: the boundary's claim is about the peers
 * ("shared with this device" names the reference), and the self node already carries
 * the identity ring - boxing the reference point would draw a boundary around the
 * thing the label compares to.
 */
export function prefixGroups(
	devices: readonly MeshDevice[],
	selfDeviceId: string | null,
): PrefixGroup[] {
	const peers = devices.filter((device) => device.id !== selfDeviceId);
	const self = devices.find((device) => device.id === selfDeviceId) ?? null;

	const owners = new Map<string, ReadonlySet<string>>();
	for (const device of devices) owners.set(device.id, deviceAddresses(device));
	const duplicated = duplicatedAddresses(owners);

	/** The prefixes this process runs on, from ITS OWN published addresses. */
	const own = new Set<string>();
	for (const endpoint of self ? deviceAddresses(self) : []) {
		if (duplicated.has(endpoint)) continue;
		const parsed = parseEndpoint(endpoint);
		const prefix = parsed ? subnet24(parsed.host) : null;
		if (prefix) own.add(prefix);
	}

	const prefixesOf = (device: MeshDevice): Set<string> => {
		const prefixes = new Set<string>();
		for (const endpoint of deviceAddresses(device)) {
			// AN ADDRESS TWO DEVICES CLAIM CONTRIBUTES TO NO GROUP (refusal 6).
			if (duplicated.has(endpoint)) continue;
			const parsed = parseEndpoint(endpoint);
			const prefix = parsed ? subnet24(parsed.host) : null;
			if (prefix) prefixes.add(prefix);
		}
		return prefixes;
	};

	const declared = new Map<string, string[]>();
	const byPrefix = new Map<string, string[]>();
	for (const device of peers) {
		const scope = declaredScope(device);
		if (scope) {
			declared.set(scope, [...(declared.get(scope) ?? []), device.id]);
			// A DECLARED MEMBERSHIP IS NOT ALSO GUESSED AT: the operator's word wins
			// over the arithmetic for this device, so one machine is never inside two
			// boundaries that disagree about why it is there.
			continue;
		}
		for (const prefix of prefixesOf(device)) {
			byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), device.id]);
		}
	}

	const order = new Map(devices.map((device, index) => [device.id, index]));
	const sortIds = (ids: string[]) =>
		[...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

	const groups: PrefixGroup[] = [];
	for (const [scope, ids] of declared) {
		groups.push({
			prefix: scope,
			tier: "declared",
			deviceIds: sortIds(ids),
			words: "declared",
		});
	}
	for (const [prefix, ids] of byPrefix) {
		if (own.has(prefix))
			groups.push({
				prefix,
				tier: "shared",
				deviceIds: sortIds(ids),
				words: "shared with this device",
			});
		// TWO devices, because one device's prefix is not a grouping: this tier is
		// arithmetic on two published values, and one value is not a comparison.
		else if (ids.length > 1)
			groups.push({
				prefix,
				tier: "probable",
				deviceIds: sortIds(ids),
				words: "same prefix",
			});
	}
	return groups.sort(
		(a, b) => a.tier.localeCompare(b.tier) || a.prefix.localeCompare(b.prefix),
	);
}

/**
 * The operator's DECLARED scope for a device, or `""` when none was authored.
 *
 * THE BACKEND ASK. There is no per-member or per-network scope field today -
 * `network.trust` exists and is not a scope - so this is empty in every install and
 * the `declared` tier renders never. The client half is built anyway, on the rule the
 * rest of this feature follows for a missing answer: the day the field arrives, the
 * boundary appears with the operator's own word on it and no renderer change. What
 * must NOT happen is a guessed boundary wearing the declared word, so the read is
 * this narrow: a non-empty string on a membership, nothing else.
 */
export function declaredScope(device: MeshDevice): string {
	for (const membership of device.memberships) {
		const scope = membership.scope.trim();
		if (scope) return scope;
	}
	return "";
}

/** The label above an enclosure: the prefix and the tier's own words. */
export function prefixWords(group: PrefixGroup): string {
	const head =
		group.tier === "declared" ? group.prefix : prefixLabel(group.prefix);
	return `${head} · ${group.words}`;
}
