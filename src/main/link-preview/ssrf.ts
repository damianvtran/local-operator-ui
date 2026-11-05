/**
 * Which addresses this module is allowed to connect to.
 *
 * THE THREAT. A preview fetcher is an SSRF primitive by construction: it takes a
 * URL from a message - which may be written by somebody who is not the reader -
 * and performs a request from the user's machine, inside their network, with
 * their ambient trust. The interesting targets are not "the internet"; they are
 * the loopback interface, the LAN, and the cloud metadata endpoint on
 * 169.254.169.254 that hands out credentials.
 *
 * RESOLVE-THEN-PIN. Checking the hostname's addresses and then letting the HTTP
 * client resolve it again is not enough: the second lookup can answer a different
 * address (DNS rebinding), and the check becomes decoration. So the addresses are
 * resolved ONCE here, EVERY one of them is classified, and the caller connects to
 * the validated address through a `lookup` pin - the client never performs a
 * resolution of its own. That is why `pinnedLookup` exists and why the fetcher
 * passes it on every hop.
 *
 * FAIL CLOSED. An empty answer, a resolver error, or a name that resolves to a
 * mixture of public and private addresses is a refusal. The mixture case is
 * deliberate: a host that answers both is not a host with one public address and
 * one mistake, it is a host choosing its answer.
 */

import { type LookupFunction, isIP } from "node:net";

/** What a resolution may answer. Matches `dns.promises.lookup`'s all-addresses
 * form so the real resolver and a test double are interchangeable. */
export interface ResolvedAddress {
	address: string;
	family: number;
}

export type LookupAll = (
	hostname: string,
	options: { all: true; verbatim: true },
) => Promise<readonly ResolvedAddress[]>;

export type AddressClass = "public" | "blocked";

/** A decimal octet and a hexadecimal IPv6 group. Hoisted because both are used
 * inside loops that run per address fragment. */
const DECIMAL_OCTET = /^\d{1,3}$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

function v4ToInt(address: string): number | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	let value = 0;
	for (const part of parts) {
		if (!DECIMAL_OCTET.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		value = value * 256 + octet;
	}
	return value;
}

function inV4Range(value: number, base: string, bits: number): boolean {
	const baseValue = v4ToInt(base);
	if (baseValue === null) return false;
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
}

/**
 * The IPv4 ranges this module refuses.
 *
 * Beyond the obvious private/loopback/link-local trio it names the addresses that
 * are reserved for documentation or protocol plumbing: they are not someone's
 * server, they are someone's mistake, and a fetcher that dials 198.18.0.0/15 is
 * dialling a benchmarking range that a hostile DNS answer can point anywhere.
 */
const BLOCKED_V4: readonly { base: string; bits: number }[] = [
	{ base: "0.0.0.0", bits: 8 }, // "this network" / unspecified
	{ base: "10.0.0.0", bits: 8 }, // RFC1918
	{ base: "100.64.0.0", bits: 10 }, // CGNAT (RFC6598)
	{ base: "127.0.0.0", bits: 8 }, // loopback
	{ base: "169.254.0.0", bits: 16 }, // link-local, incl. 169.254.169.254 metadata
	{ base: "172.16.0.0", bits: 12 }, // RFC1918
	{ base: "192.0.0.0", bits: 24 }, // IETF protocol assignments
	{ base: "192.0.2.0", bits: 24 }, // TEST-NET-1
	{ base: "192.88.99.0", bits: 24 }, // 6to4 relay anycast
	{ base: "192.168.0.0", bits: 16 }, // RFC1918
	{ base: "198.18.0.0", bits: 15 }, // benchmarking
	{ base: "198.51.100.0", bits: 24 }, // TEST-NET-2
	{ base: "203.0.113.0", bits: 24 }, // TEST-NET-3
	{ base: "224.0.0.0", bits: 4 }, // multicast
	{ base: "240.0.0.0", bits: 4 }, // reserved, incl. 255.255.255.255
];

export function classifyIpv4(address: string): AddressClass {
	const value = v4ToInt(address);
	if (value === null) return "blocked";
	for (const range of BLOCKED_V4) {
		if (inV4Range(value, range.base, range.bits)) return "blocked";
	}
	return "public";
}

/** Expand an IPv6 literal to its eight 16-bit groups, or `null` if it is not one.
 * Embedded IPv4 tails (`::ffff:1.2.3.4`) are folded into two groups. */
function expandIpv6(address: string): number[] | null {
	let text = address.toLowerCase();
	const zone = text.indexOf("%");
	if (zone !== -1) text = text.slice(0, zone);
	if (!text.includes(":")) return null;
	const tail: number[] = [];
	const lastColon = text.lastIndexOf(":");
	const afterLast = text.slice(lastColon + 1);
	if (afterLast.includes(".")) {
		const value = v4ToInt(afterLast);
		if (value === null) return null;
		tail.push((value >>> 16) & 0xffff, value & 0xffff);
		text = text.slice(0, lastColon + 1);
		if (text.endsWith("::")) text = text.slice(0, -1);
		else if (text.endsWith(":")) text = text.slice(0, -1);
	}
	const [head, rest] = text.split("::") as [string, string | undefined];
	const headGroups = head === "" ? [] : head.split(":");
	const restGroups = rest === undefined || rest === "" ? [] : rest.split(":");
	if (
		rest !== undefined &&
		headGroups.length + restGroups.length + tail.length > 8
	) {
		return null;
	}
	if (rest === undefined && headGroups.length + tail.length !== 8) return null;
	const fill = 8 - headGroups.length - restGroups.length - tail.length;
	const groups: number[] = [];
	const push = (part: string): boolean => {
		if (part === "") return false;
		if (!HEX_GROUP.test(part)) return false;
		groups.push(Number.parseInt(part, 16));
		return true;
	};
	for (const part of headGroups) if (!push(part)) return null;
	for (let index = 0; index < fill; index += 1) groups.push(0);
	for (const part of restGroups) if (!push(part)) return null;
	groups.push(...tail);
	return groups.length === 8 ? groups : null;
}

function embeddedIpv4(high: number, low: number): string {
	return `${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
}

export function classifyIpv6(address: string): AddressClass {
	const groups = expandIpv6(address);
	if (groups === null) return "blocked";
	// ::ffff:0:0/96 (IPv4-mapped) and 64:ff9b::/96 (NAT64) both carry a v4
	// address in their low 32 bits; classify the address actually dialled.
	if (
		groups[0] === 0 &&
		groups[1] === 0 &&
		groups[2] === 0 &&
		groups[3] === 0 &&
		groups[4] === 0
	) {
		if (groups[5] === 0xffff) {
			return classifyIpv4(
				embeddedIpv4(groups[6] as number, groups[7] as number),
			);
		}
		// :: unspecified, ::1 loopback, and every other ::/96 target - which is a
		// deprecated form no public server answers on.
		return "blocked";
	}
	if (groups[0] === 0x64 && groups[1] === 0xff9b) {
		return classifyIpv4(embeddedIpv4(groups[6] as number, groups[7] as number));
	}
	if (groups[0] === 0x2002) {
		// 6to4 embeds the v4 address in groups 1-2.
		return classifyIpv4(embeddedIpv4(groups[1] as number, groups[2] as number));
	}
	const high = groups[0] as number;
	if ((high & 0xffc0) === 0xfe80) return "blocked"; // link-local fe80::/10
	if ((high & 0xfe00) === 0xfc00) return "blocked"; // ULA fc00::/7
	if ((high & 0xff00) === 0xff00) return "blocked"; // multicast
	if (high === 0x2001 && groups[1] === 0x0db8) return "blocked"; // documentation
	if (
		high === 0x0100 &&
		groups[1] === 0 &&
		groups[2] === 0 &&
		groups[3] === 0
	) {
		return "blocked"; // 100::/64 discard-only
	}
	return "public";
}

/** Classify one textual address of either family. Anything that is not an IP
 * literal at all is `blocked`: it should never reach here, and a resolver answer
 * that is not an address is a resolver we do not trust. */
export function classifyAddress(address: string): AddressClass {
	const family = isIP(address);
	if (family === 4) return classifyIpv4(address);
	if (family === 6) return classifyIpv6(address);
	return "blocked";
}

export type AddressVerification =
	| { ok: true; address: string; family: 4 | 6 }
	| { ok: false; reason: "blocked-host" | "local-or-private" };

/**
 * Resolve a host ONCE and decide whether the module may connect to it.
 *
 * Every answer is classified, not just the first: a host answering
 * `[1.2.3.4, 127.0.0.1]` is refused as `local-or-private` even though its first
 * address is public, because the client could have been handed the second.
 */
export async function verifyHostAddress(
	hostname: string,
	lookup: LookupAll,
): Promise<AddressVerification> {
	if (hostname === "") return { ok: false, reason: "blocked-host" };
	let answers: readonly ResolvedAddress[];
	try {
		answers = await lookup(hostname, { all: true, verbatim: true });
	} catch {
		// A resolver failure is a host we cannot vouch for. It is a refusal, and the
		// error's own text is never surfaced: it can quote the name asked for.
		return { ok: false, reason: "blocked-host" };
	}
	if (answers.length === 0) return { ok: false, reason: "blocked-host" };
	let first: { address: string; family: 4 | 6 } | null = null;
	for (const answer of answers) {
		if (classifyAddress(answer.address) === "blocked") {
			return { ok: false, reason: "local-or-private" };
		}
		if (first === null) {
			first = { address: answer.address, family: answer.family === 6 ? 6 : 4 };
		}
	}
	if (first === null) return { ok: false, reason: "blocked-host" };
	return { ok: true, address: first.address, family: first.family };
}

/**
 * The `lookup` callback that PINS a connection to an address already verified.
 *
 * `node:http`/`node:https` pass this straight to `net.connect`, so the client
 * performs no resolution of its own and a rebinding answer cannot redirect the
 * connection after the check. It answers only the validated address and only on
 * the validated family; a caller asking for the other family gets that address
 * anyway (the check was done on it), because refusing here would fail the request
 * for a reason the guard already considered.
 */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
	return ((_hostname, options, callback) => {
		const done = callback as (
			error: Error | null,
			value: string | ResolvedAddress[],
			answerFamily?: number,
		) => void;
		if (options.all) {
			done(null, [{ address, family }]);
			return;
		}
		done(null, address, family);
	}) as LookupFunction;
}
