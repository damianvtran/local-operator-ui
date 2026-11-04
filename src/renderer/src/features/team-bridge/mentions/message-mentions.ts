/**
 * Which names in a RECEIVED message body are mentions, and which one is the
 * reader.
 *
 * SOURCE ORDER, and why there are two. The hub does not return `mentions` on
 * message reads today; a hub change adding `mentions: [{kind, account_id,
 * endpoint_id?}]` (kind may also be `channel`) to the message view is in
 * flight. So:
 *  1. `message.mentions` present: it is authoritative. Each row is resolved to
 *     the label the reader sees (the same candidate labels the composer
 *     inserts), and only those `@label` runs are highlighted. A row whose
 *     label cannot be resolved highlights nothing rather than guessing.
 *  2. absent: fall back to matching `@<display name>` against the
 *     conversation's members and the directory. This is a heuristic. It can
 *     highlight an `@Name` typed without the popover, which is also what the
 *     reader would read as a mention, and it cannot see a mention the author
 *     spelled differently. The hub returns `mentions` on reads now, but only
 *     for messages SENT with them, so this path still answers for most
 *     messages (measured 2026-11-03 in a live tenant: 3 of 4 messages with an
 *     `@` carried no `mentions`).
 * `source` says which one answered, for tests and for the reader of this code.
 */
import { nameKey } from "../team-bridge-model";
import type { MentionCandidate } from "./matcher";

export type MessageMentionRun = {
	/** The text after `@`. */
	label: string;
	/** An authoritative account_id names the reader; display names never prove it. */
	viewer: boolean;
};

export type MessageMentionSpec = {
	source: "message" | "fallback";
	runs: MessageMentionRun[];
	/** Both sources match the exact spelling; kept explicit for the renderer. */
	caseSensitive: boolean;
};

type WireMention = { kind?: unknown; account_id?: unknown };

const CHANNEL_WORDS = ["channel", "here", "everyone"];

export function messageMentionSpec(input: {
	body: string | null;
	mentions: unknown;
	candidates: readonly Pick<MentionCandidate, "kind" | "accountId" | "label">[];
	self: { accountId: string; label: string; labelUnique?: boolean } | null;
}): MessageMentionSpec | null {
	const { body, candidates, self } = input;
	if (!body || !body.includes("@")) return null;
	const people = self
		? [
				...candidates,
				{
					kind: "human" as const,
					accountId: self.accountId,
					label: self.label,
				},
			]
		: candidates;
	const isViewer = (accountId: unknown) =>
		self !== null && accountId === self.accountId;
	if (Array.isArray(input.mentions)) {
		const runs: MessageMentionRun[] = [];
		for (const row of input.mentions as WireMention[]) {
			if (!row || typeof row !== "object") continue;
			/*
			 * A `channel` row names no word, and the hub has ONE channel kind, so
			 * guessing which of @channel/@here/@everyone it recorded would
			 * highlight words the hub never treated as mentions (review R1-06).
			 * Highlight only the one word actually present, first in this order.
			 */
			if (row.kind === "channel") {
				const word = CHANNEL_WORDS.find((w) =>
					splitMentions(body, [{ label: w, viewer: false }], true).some(
						(seg) => seg.kind === "mention",
					),
				);
				if (word) runs.push({ label: word, viewer: false });
				continue;
			}
			const match = people.find(
				(p) => p.kind === row.kind && p.accountId === row.account_id,
			);
			// An identity with no label (the reader before any roster names them)
			// has no spelling to find; "" would otherwise highlight a bare "@".
			if (match && match.label !== "")
				runs.push({
					label: match.label,
					viewer: isViewer(row.account_id),
				});
		}
		return runs.length > 0
			? { source: "message", runs, caseSensitive: true }
			: null;
	}
	/*
	 * THE VIEWER IN THE FALLBACK. A display name alone is not proof of
	 * identity, so #1589 made this path never choose the viewer treatment. But
	 * messages without `mentions[]` are the common case (3 of 4 measured, see
	 * the header), and that blanket `viewer: false` turned the reader's own
	 * mentions the "other" blue (operator report, 2026-11-03). The name may
	 * stand in for identity only when it cannot mean anyone else: the label is
	 * the one resolved from the AUTHENTICATED account's own row (never a
	 * spelling the author typed), the provider found no other account in the
	 * directory or this conversation showing it (`labelUnique`), and no other
	 * candidate here carries it either (compared by `nameKey`, and never
	 * counting the reader's own rows: see `mentionSelf`). A namesake therefore
	 * still renders as "other" for both of them. Agents keep #1589's rule: only a wire
	 * account_id selects the viewer for the reader's own agent, because its
	 * composed label ("Aida (Damian Tran)") names the owner, not the reader.
	 */
	const fallbackViewer = (p: (typeof people)[number]) =>
		self !== null &&
		self.labelUnique === true &&
		p.kind === "human" &&
		p.accountId === self.accountId &&
		!candidates.some(
			(c) =>
				c.accountId !== self.accountId && nameKey(c.label) === nameKey(p.label),
		);
	/*
	 * ONE RUN PER LABEL. The reader's own legacy agent member can carry the
	 * owner's bare name, so it and the reader share a label; `splitMentions`
	 * takes the first equal-length run, and the agent's `viewer: false` (it
	 * sits before `self` in `people`) hid the reader's yellow (review R1 M2).
	 * Letting a viewer run win is safe because `fallbackViewer` is true only
	 * when no OTHER account carries the label.
	 */
	const byLabel = new Map<string, boolean>();
	for (const p of people) {
		if (p.label === "" || !body.includes(`@${p.label}`)) continue;
		byLabel.set(p.label, (byLabel.get(p.label) ?? false) || fallbackViewer(p));
	}
	const runs = [...byLabel].map(([label, viewer]) => ({ label, viewer }));
	/*
	 * The fallback is a HEURISTIC and says so: it matches `@<display name>`
	 * EXACTLY as the name is spelled (case-sensitive, review R1-06), which is
	 * what the composer inserts. Prose like "@ben tran" is not highlighted, and
	 * an `@Name` typed by hand without the popover is, because a reader would
	 * read it as a mention too. It cannot see a mention spelled differently.
	 */
	return runs.length > 0
		? { source: "fallback", runs, caseSensitive: true }
		: null;
}

export type BodySegment =
	| { kind: "text"; text: string }
	| { kind: "mention"; text: string; viewer: boolean };

/** A name character: a following one means "@Ben" was the start of "@Benjamin". */
const NAME_CONTINUES = /[\p{L}\p{N}_]/u;

/**
 * Split one text run into plain text and `@label` mentions. Longest label
 * first, so "@Ben Tran" wins over "@Ben", and a match must end at a non-name
 * character and start at a mention boundary (never inside an email).
 */
export function splitMentions(
	text: string,
	runs: readonly MessageMentionRun[],
	/** Exact spelling; the default because labels are what was inserted. */
	caseSensitive = true,
): BodySegment[] {
	const same = (a: string, b: string) =>
		caseSensitive ? a === b : a.toLocaleLowerCase() === b.toLocaleLowerCase();
	const ordered = [...runs].sort((a, b) => b.label.length - a.label.length);
	const segments: BodySegment[] = [];
	let plain = "";
	let at = 0;
	while (at < text.length) {
		const before = at === 0 ? "" : text.charAt(at - 1);
		const hit =
			text.charAt(at) === "@" && !NAME_CONTINUES.test(before) && before !== "."
				? ordered.find((run) => {
						const end = at + 1 + run.label.length;
						return (
							same(text.slice(at + 1, end), run.label) &&
							!NAME_CONTINUES.test(text.charAt(end))
						);
					})
				: undefined;
		if (!hit) {
			plain += text.charAt(at);
			at += 1;
			continue;
		}
		if (plain) segments.push({ kind: "text", text: plain });
		plain = "";
		const end = at + 1 + hit.label.length;
		segments.push({
			kind: "mention",
			text: text.slice(at, end),
			viewer: hit.viewer,
		});
		at = end;
	}
	if (plain) segments.push({ kind: "text", text: plain });
	return segments;
}
