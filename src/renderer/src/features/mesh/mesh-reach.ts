/**
 * Two questions about a device that the shipped node conflated into one:
 * **can this device be talked to right now** (REACH), and **is anything happening
 * on it** (ACTIVITY).
 *
 * ## Why they are separate, and why the old spelling was a defect
 *
 * `DeviceState` (`mesh-graph.ts`) answers a third question - "is this device odd" -
 * and it is the right shape for that one. It is the wrong shape for reachability,
 * because it has no way to say **"we never asked"**. The relay reports three
 * different `false` cases (nothing was dialled; it was dialled and nothing answered;
 * the link is refused before the far device is involved) as one boolean plus a
 * glossed sentence, so a device this app never dialled arrives at the join looking
 * exactly like a device that did not answer - and the shipped node painted it amber
 * and told the reader a machine had failed when it had never been asked
 * (design round's D2, D3).
 *
 * ## Axis A - reach
 *
 * | state | node says | source |
 * |---|---|---|
 * | `self` | `this device` | `self_device_id`; a probe result for yourself is not a reading |
 * | `reached` | `reached` | `reachable: true`, not self |
 * | `unanswered` | `no answer` | `reachable: false` with any reason that is not a not-attempted sentence |
 * | `not-attempted` | `not asked` | a not-attempted sentence (see the debt below) |
 * | `unknown` | `unknown` | no read named the device: empty reason AND `sessionCount === null` |
 *
 * A **suspect identity is an overlay, not a reach state**: it is a fact about the
 * member record, and it outranks every probe result wherever it is rendered. It is
 * deliberately not a member of `DeviceReach`, so no surface can answer "how was it
 * reached" with a security verdict.
 *
 * ## Axis B - activity
 *
 * `working` when one of the conversation rows in hand reports `live_state: "busy"`,
 * silence when none does. There is **no third state and no heartbeat**: the wire has
 * no per-device activity field, so nothing else could fill one.
 *
 * ## THE DEBT THIS FILE MARKS RATHER THAN HIDES
 *
 * `not-attempted` is recognised by **string-matching the relay's own sentences**
 * ("THE PICTURE IS DRAWN FROM A SENTENCE WE DID NOT WRITE"). The relay knows which
 * of its three `false` cases it produced and flattens them anyway, so the token that
 * would make this structural does not exist on the wire: `reach` on `PeerRow` and
 * `NetworkMember` is the backend ask, and until it lands this match is the only path
 * in production. It is deliberately a CLOSED list of exact sentences rather than a
 * substring or a keyword scan, because the failure mode of a loose match is a real
 * refusal read as "we never asked" - the app taking the blame for a device that
 * stayed silent. An unrecognised sentence falls back to `unanswered`, which is the
 * reading that blames the device least: an unreadable sentence is likelier a refusal
 * nobody wrote down than a new spelling of "we never asked".
 */

import type { MeshDevice } from "./mesh-graph";
import type { MeshSessionRow } from "./mesh-types";
import { sessionIsBusy } from "./mesh-types";

/** Whether a device can be talked to right now. See this file's header. */
export type DeviceReach =
	| "self"
	| "reached"
	| "unanswered"
	| "not-attempted"
	| "unknown";

/** Whether anything is happening on a device. Absence of `working` is `idle`. */
export type DeviceActivity = "working" | "idle";

/**
 * How much confidence an activity reading is entitled to.
 *
 * `published` is what a backend `activity` field would arrive as (the backend ask);
 * `derived` is this app's own reading of the conversation rows it holds; `none` is
 * "no read named this device", where **no state at all** is rendered - drawing
 * `idle` for a device the read did not mention is the same defect as drawing `0`
 * conversations for it.
 */
export type ActivitySource = "published" | "derived" | "none";

/**
 * The sentences that mean "nothing was dialled", each with its producer.
 *
 * BOTH ARE THE RELAY'S OWN WORDS, carried through `resume.peer_reason_words`, which
 * strips a `stage: ` prefix and keeps the sentence behind it (and which never
 * returns empty - an empty reason glosses to "it did not answer", a sentence this
 * list deliberately does not contain). Pinned by name in `scripts/mesh-tab.test.mjs`
 * the way `MOVE_OP_DEADLINE_S` is pinned against the backend's published bounds: a
 * rename upstream has to fail a test here rather than quietly reclassify a peer.
 *
 *   - `relay.NOT_ATTEMPTED_REASON` - "not_attempted: the listing budget ran out
 *     before this member was probed" - glossed to the sentence below, which is what
 *     a member row carries once the stage word is dropped.
 *   - `server/utils/desktop_mesh.py`'s relay-down branch: the relay is not running,
 *     so no device was asked at all.
 */
export const NOT_ATTEMPTED_SENTENCES: readonly string[] = [
	// `local_operator/network/relay.py`: NOT_ATTEMPTED_REASON, asked of the member
	// table. The `not_attempted: ` stage word is what `peer_reason_words` removes.
	"the listing budget ran out before this member was probed",
	// `local_operator/server/utils/desktop_mesh.py`: the relay-down reason, verbatim.
	"the relay is not running, so no device was asked",
];

/** Whether a relay sentence is one of the two that mean "it was never asked". */
export function isNotAttemptedReason(reason: string): boolean {
	const token = reason.trim();
	return token !== "" && NOT_ATTEMPTED_SENTENCES.includes(token);
}

/**
 * A device's reach, from the facts the two reads already carry.
 *
 * THE ORDERING IS THE WHOLE CONTENT, and each step is why the one below it is not
 * asked instead:
 *
 *   1. **self** - the reader's own machine is reachable by definition, so a probe
 *      result about it is not a reading of anything; the shipped backend forces
 *      `reachable, reason = True, ""` for the table's own device for the same reason.
 *   2. **reached** - one positive answer outranks every silence, which is the
 *      existing join's rule and is kept here rather than restated.
 *   3. **not-attempted** - tested BEFORE the generic reason branch, because the two
 *      sentences above are the only ones that mean the app did not dial.
 *   4. **unanswered** - a reason nobody recognises is still "it did not answer".
 *   5. **unknown** - no reason and no session count: no read named this device. A
 *      device the peer catalogue DID name (a non-null count) with no reason falls to
 *      `unanswered` instead, because `unknown` claims nothing was read about it.
 */
export function deviceReach(
	device: Pick<MeshDevice, "state" | "reachable" | "reason" | "sessionCount">,
): DeviceReach {
	if (device.state === "self") return "self";
	if (device.reachable) return "reached";
	if (isNotAttemptedReason(device.reason)) return "not-attempted";
	if (device.reason) return "unanswered";
	if (device.sessionCount === null) return "unknown";
	return "unanswered";
}

/**
 * The suspect overlay's words, in one place because two surfaces say them.
 *
 * A suspect identity is the one member-record fact that outranks a probe result, so both
 * the node's accessible name and the panel's header line say it - and a second spelling
 * of it in either file would be two descriptions of one fact.
 */
export const SUSPECT_WORDS = "identity suspect";

/** The node's own word for each reach state, and nothing else. */
export function reachWords(reach: DeviceReach): string {
	switch (reach) {
		case "self":
			return "this device";
		case "reached":
			return "reached";
		case "unanswered":
			return "no answer";
		case "not-attempted":
			return "not asked";
		default:
			return "unknown";
	}
}

/**
 * The same reach where there is room for the relay's own sentence.
 *
 * No new vocabulary: it is `reachWords` plus the reason **verbatim**, because the
 * reason is the backend's sentence and this feature re-words it nowhere. A reason
 * that is already the not-attempted sentence is still printed - it is what tells the
 * reader whose limit ran out.
 */
export function reachSentence(device: {
	state: MeshDevice["state"];
	reachable: boolean;
	reason: string;
	sessionCount: number | null;
}): string {
	const reach = deviceReach(device);
	const words = reachWords(reach);
	return device.reason ? `${words} — ${device.reason}` : words;
}

/**
 * The ink each reach state takes, and the two neutral states are the point.
 *
 * `not-attempted` and `unknown` take NO HUE: neither is the device's fault or its
 * failure, and spending a semantic hue on either would put the app's own limit on
 * the same channel as a machine that did not answer. `reached` is `ink-muted` - the
 * ordinary case, kept quiet deliberately (the shipped code already measured why:
 * accent and success are ΔE00 5.07 apart on the dark brand palette and 2.22 on the
 * light, so a hue spent on the healthy case leaves the status channel with nothing
 * to say). `self` is the identity role, and its channel is the RING too - colour is
 * never the only channel here (`branding.md` § 2, WCAG 1.4.1).
 */
export const REACH_INK: Record<DeviceReach, string> = {
	self: "text-accent",
	reached: "text-ink-muted",
	unanswered: "text-warning",
	"not-attempted": "text-ink-dim",
	unknown: "text-ink-dim",
};

/**
 * The state line's dot glyph - the non-colour channel beside the word.
 *
 * Four distinct glyphs, so the two neutral states are still told apart from each
 * other and from the two that carry a hue: a filled dot for a device that answered
 * (or is this one), a fisheye for a device that did not, a hollow circle for one
 * nobody dialled, and a DOTTED circle for one no read named. `aria-hidden` at the
 * call site: the word beside it is the accessible channel, and glyph-plus-word is
 * two readings of one fact for a screen reader.
 */
export const REACH_DOT: Record<DeviceReach, string> = {
	self: "●",
	reached: "●",
	unanswered: "◉",
	"not-attempted": "○",
	unknown: "◌",
};

/**
 * A device's activity, and how much confidence the answer is entitled to.
 *
 * `rows` are the conversation rows IN HAND for this device, which is a page rather
 * than a census - so `working` is a TRUE positive (a busy conversation was read) and
 * `idle` is a reading of what was read, not a promise that nothing is running. The
 * `source` is what keeps a surface from stating that weaker reading with a published
 * answer's confidence, and `none` is the case where it must state nothing at all.
 */
export function deviceActivity(
	device: Pick<MeshDevice, "sessionCount">,
	rows: readonly MeshSessionRow[],
): { activity: DeviceActivity | null; source: ActivitySource } {
	if (device.sessionCount === null) return { activity: null, source: "none" };
	const working = rows.some((row) => sessionIsBusy(row));
	return { activity: working ? "working" : "idle", source: "derived" };
}
