/**
 * The two receipt rows: an inbound peer message, and a wake delivery.
 *
 * Both are the same defect class — MODEL-FACING MARKUP PAINTED ON A HUMAN
 * SURFACE — and both were reported from the live app:
 *
 * - a cross-session `lop send` rendered as its own card type whose body was the
 *   provenance envelope verbatim, `<peer-session-message from_pid=92064
 *   conversation='…' model='…'>…</peer-session-message>`;
 * - a scheduled wake rendered `(alarm) Scheduled wake w-9 (1, every 6h) — cancel
 *   with wake({op:"cancel",id:"w-9"})`, an instruction addressed to the model.
 *
 * The TUI paints both as ordinary ledger rows (`PeerMessageBlock`, `WakeBlock` in
 * `local_operator/tui/widgets/transcript.py`), and the phone's fold does the same
 * (`local_operator/mobile/projection.py`), which is the precedent this ports.
 * Nothing here is new behaviour: it is the derivation those two surfaces already
 * share, expressed once so the app's row cannot drift from theirs.
 *
 * Pure, and separate from the row component, for the reason `tool-row-model.ts`
 * is separate from `tool-row.tsx`: every rule below has a right answer, and there
 * is no React test host in this repo. `scripts/receipt-rows.test.mjs` asserts
 * them.
 *
 * THE SENDER FIELDS ARE UNTRUSTED. They cross a process boundary from another
 * session, and a conversation name is free text the peer chose. The TUI treats
 * them as the least trusted data it renders and sanitises every one of them
 * (`_sanitize_sender_field`), which is why nothing here prints a raw field: a
 * newline in a name split a pinned one-row card into three rows, and an
 * unterminated RTL override in a pid visibly scrambled the one field a reader
 * uses to address the peer back. React escapes the text and cannot be re-inked
 * from a label the way a terminal can, but the SHAPE and SIZE hazards port
 * exactly — a name is still one line, and it is still bounded.
 */

/**
 * How much of one advisory sender field is printed.
 *
 * `_SENDER_FIELD_MAX_CHARS` (transcript.py:2242), ported: generous enough that
 * no honest conversation name, model label or directory basename is clipped,
 * small enough that a hostile one cannot own the row.
 */
const SENDER_FIELD_MAX_CHARS = 120;

/**
 * How much of a peer body is read to build the collapsed row's preview.
 *
 * `_SNIPPET_SOURCE_MAX_CHARS`, ported — and NOT a display cap. The wire allows a
 * peer message up to `PEER_MESSAGE_MAX_BYTES` (256 KiB), and both the collapse
 * and the split walk the string they are handed, so this bounds the WORK. It sits
 * four orders of magnitude above any reachable row, so it can never be the thing
 * that decides what a reader sees.
 */
const SNIPPET_SOURCE_MAX_CHARS = 4096;

/**
 * The one-line, bounded, whitespace-collapsed form of an advisory sender field.
 *
 * Offending characters are removed rather than escaped, because this is an
 * identity LABEL: the point is to say which session reached in, not to display
 * what an odd name contained. Whitespace runs (newlines and tabs included)
 * collapse to single spaces so a name stays one paragraph and the row stays one
 * row.
 */
export function senderField(value: unknown): string {
	if (value === null || value === undefined) return "";
	const text = typeof value === "string" ? value : String(value);
	return text
		.split(/\s+/)
		.filter(Boolean)
		.join(" ")
		.slice(0, SENDER_FIELD_MAX_CHARS);
}

/**
 * The sender identity a receipt row carries.
 *
 * Every field is advisory and every one can be absent: `details["sender"]` is
 * whatever the sending session put on the wire, and a row recovered from an
 * envelope alone has three of the five.
 */
export type PeerSender = {
	/** `pid` of the sending session, as text. Never a number in, never coerced. */
	pid: string;
	/** The name the sender's conversation chose, if it has one. */
	conversationName: string;
	/** The sender's working directory, used for its basename when unnamed. */
	cwd: string;
	/** The sender's session id, used for a short prefix when unnamed. */
	sessionId: string;
	/** The sender's model label, shown last and shed first in a terminal. */
	modelLabel: string;
};

/** An all-absent sender, so the record shape is never a nullable pair. */
export const EMPTY_SENDER: PeerSender = {
	pid: "",
	conversationName: "",
	cwd: "",
	sessionId: "",
	modelLabel: "",
};

/**
 * `(name, quoted)` for the sending session, or `("", false)`.
 *
 * The ladder — conversation name, then cwd basename, then a short session id —
 * is why a peer receipt never degrades to a bare pid: a row naming `pid 1` names
 * nothing a reader can act on, and the whole point of the row is to say WHICH
 * session reached in.
 *
 * `quoted` is false for the two fallbacks. A name the peer CHOSE is quoted; a
 * directory basename and an id prefix are the app guessing, and rendering them
 * identically told the reader nothing about which they were looking at — two
 * sessions in sibling checkouts would both read as "user-dashboard".
 */
export function peerName(sender: PeerSender): {
	name: string;
	quoted: boolean;
} {
	if (sender.conversationName) {
		return { name: sender.conversationName, quoted: true };
	}
	const cwd = sender.cwd.replace(/[\\/]+$/, "");
	if (cwd) {
		// Split on both separators rather than one: the app runs on Windows too,
		// where the TUI's `os.path.basename` would keep the whole path as a name.
		const base = cwd.split(/[\\/]/).pop() ?? "";
		// A trailing slash says "this is a directory", which is the only thing
		// that distinguishes a guessed name from a chosen one when both are
		// unquoted.
		if (base) return { name: `${base}/`, quoted: false };
	}
	if (sender.sessionId) {
		// A short prefix: a full ULID is 26 characters of entropy that pushes the
		// message preview off the row without helping the eye.
		return { name: sender.sessionId.slice(0, 8), quoted: false };
	}
	return { name: "", quoted: false };
}

/**
 * The identity a collapsed receipt row leads with.
 *
 * The name alone, not a `peer message from …` sentence: the `peer` name column
 * and the inbound glyph already say what kind of row this is, and repeating it
 * in the summary is a caption where a label belongs. When the ladder finds
 * nothing at all, the pid is the last thing that identifies the sender, and
 * "another session" is the same fallback vocabulary `harness/comms.py` uses —
 * kept identical so a reader meeting one in a transcript and one in a tool
 * result does not think they are two different states.
 */
export function peerIdentity(sender: PeerSender): string {
	const { name, quoted } = peerName(sender);
	if (name) return quoted ? `"${name}"` : name;
	return sender.pid ? `pid ${sender.pid}` : "another session";
}

/**
 * The expansion's identity line: `"<name>" · pid N · <model>`.
 *
 * This is the information the collapsed row cannot hold, and the reason the row
 * is always expandable: the pid and the model are what a reader needs in order
 * to address the peer back, and no snippet can carry them.
 *
 * The TUI attaches the model only when the composed line still fits on one row,
 * because a terminal has to shed something (`_header`). A paragraph has no such
 * budget — it wraps — so the shedding does not port; the ORDER does, and it is
 * the shed order: name, then pid, then model, the model last because it is
 * context rather than an address.
 */
export function peerIdentityLine(sender: PeerSender): string {
	const { name, quoted } = peerName(sender);
	const parts: string[] = [];
	if (sender.pid) parts.push(`pid ${sender.pid}`);
	if (sender.modelLabel) parts.push(sender.modelLabel);
	if (name) return [quoted ? `"${name}"` : name, ...parts].join(" · ");
	if (parts.length > 0) return parts.join(" · ");
	// Nothing identifying at all: the one case that still needs prose, because a
	// bare "·"-joined empty list says nothing.
	return "another session";
}

/**
 * The collapsed row's preview of the message body.
 *
 * The FIRST non-empty line, whitespace-collapsed.
 *
 * The TUI collapses the WHOLE body instead (`_snippet`) and lets the row
 * truncate it, which is the right shape for a fixed-width cell: the row sheds
 * the tail either way, so starting from the whole body shows strictly more of a
 * multi-paragraph note. This row truncates too, so the wider rule would be
 * defensible here — the narrower one is kept because "the first line" is what a
 * one-line preview claims to be, and nothing is lost: the full text is one click
 * away in the expansion rather than shed.
 */
export function peerSnippet(body: string): string {
	for (const line of body.slice(0, SNIPPET_SOURCE_MAX_CHARS).split("\n")) {
		const collapsed = senderField(line);
		if (collapsed) return collapsed;
	}
	return "";
}

/** The collapsed row's summary: who sent it, then a preview of what they said. */
export function peerSummary(sender: PeerSender, body: string): string {
	const identity = peerIdentity(sender);
	const snippet = peerSnippet(body);
	return snippet ? `${identity} · ${snippet}` : identity;
}

/**
 * Do two senders print identically?
 *
 * The reducer keeps a record's OBJECT IDENTITY stable when a replayed history
 * page teaches nothing new, because the transcript's equality gate compares
 * record fields by reference and a freshly built sender would report every
 * replayed peer row as changed (`extractImages` makes the same bargain for the
 * `images` array). This is the comparison that lets the previous object be
 * reused.
 */
export function sameSender(a: PeerSender, b: PeerSender): boolean {
	return (
		a.pid === b.pid &&
		a.conversationName === b.conversationName &&
		a.cwd === b.cwd &&
		a.sessionId === b.sessionId &&
		a.modelLabel === b.modelLabel
	);
}

/**
 * The provenance envelope a peer delivery is wrapped in for the model.
 *
 * Built by `Session._peer_custom_message` (`session/session.py`) as
 * `<peer-session-message from_pid=<pid> conversation=<name> model=<label>>\n
 * <message>\n</peer-session-message>`, with the three attributes written through
 * Python's `repr` — so a name containing an apostrophe comes back in DOUBLE
 * quotes and both spellings have to parse.
 */
const PEER_ENVELOPE =
	/^<peer-session-message\s+([^>]*)>([\s\S]*?)<\/peer-session-message>\s*$/;

/** Any envelope tag, wherever it sits — see `peerFields`. */
const PEER_ENVELOPE_TAG = /<\/?peer-session-message[^>]*>/g;

/**
 * One `key=value` attribute of an envelope's open tag.
 *
 * All three spellings are real. `_peer_custom_message` writes the three values
 * through Python's `repr`: a string lands in single quotes, a string CONTAINING
 * an apostrophe lands in double quotes, and `pid` — which is an integer — lands
 * BARE (`from_pid=92064`). A parser that only knew the quoted forms silently
 * dropped the pid of every peer that ever sent a message.
 */
const PEER_ENVELOPE_ATTR =
	/([a-zA-Z_]+)\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/g;

/**
 * The human-facing fields of one peer delivery: what was said, and by whom.
 *
 * `details` is the wire payload of a `peer_message` custom row, which carries
 * THREE things: `text` is the model-facing envelope, `body` is the raw message
 * and `sender` is the advisory identity. The UIs are supposed to render the
 * second and third (the mobile fold does exactly that, `mobile/projection.py`),
 * and the first must never reach a human surface.
 *
 * The envelope is still parsed, for the rows that carry ONLY it: a transcript
 * written by an older producer, or one whose `details` were dropped by a
 * delivery path that was never updated. Recovering `from_pid`, `conversation`
 * and `model` from the open tag means such a row still names its sender instead
 * of degrading to "another session", and recovering the body from inside the
 * wrapper means it still has something to say.
 *
 * `details.sender` WINS field by field rather than wholesale: the two sources
 * carry overlapping but not identical facts, and a row that has a `sender` dict
 * missing only `model_label` should take that one field from the envelope rather
 * than lose the other four.
 */
export function peerFields(details: Record<string, unknown>): {
	body: string;
	sender: PeerSender;
} {
	const text = String(details.text ?? details.detail ?? "");
	const match = PEER_ENVELOPE.exec(text.trim());
	const attrs: Record<string, string> = {};
	if (match) {
		for (const attr of match[1].matchAll(PEER_ENVELOPE_ATTR)) {
			attrs[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? "";
		}
	}
	// The envelope must not survive the unwrap even when a body quoted one, so
	// any tag still standing is removed rather than trusted to be absent. This is
	// the "never let the envelope reach the view" rule expressed as a strip
	// instead of a check.
	const inner = (match ? match[2] : "").replace(PEER_ENVELOPE_TAG, "").trim();
	const body = String(details.body ?? "").trim() || inner;
	const raw = (details.sender ?? {}) as Record<string, unknown>;
	const field = (fromSender: unknown, fromEnvelope: string | undefined) =>
		senderField(fromSender) || senderField(fromEnvelope);
	return {
		body,
		sender: {
			pid: field(raw.pid, attrs.from_pid),
			conversationName: field(raw.conversation_name, attrs.conversation),
			cwd: field(raw.cwd, undefined),
			sessionId: field(raw.session_id, undefined),
			modelLabel: field(raw.model_label, attrs.model),
		},
	};
}

/**
 * Is this wake row the resume CATCH-UP rather than a receipt?
 *
 * The catch-up is the folded prompt for the wakes that came due while the
 * session was down, and BOTH shipping surfaces drop it on replay for the same
 * stated reason: it is user-attributed, so replaying it "would put a raw
 * '(alarm) The session resumed…' line in the transcript as if the user had typed
 * it" (`tui/session_presentation.py`, `mobile/projection.py`). Its own first
 * paragraph is addressed to the model — "handle them as missed wakes, checking
 * the CURRENT state rather than replaying each past occurrence" — so a receipt
 * row has nothing honest to show from it, and the API that renders a punctual
 * delivery must not be handed one.
 */
export function wakeIsCatchup(details: Record<string, unknown>): boolean {
	return Boolean(details.wake_catchup);
}

/**
 * The human-readable headline of a wake delivery.
 *
 * A wake's persisted text is `<envelope>\n\n<message>`, and the envelope is
 * MODEL-FACING markup: `(alarm) Scheduled wake w-9 (1, every 6h) — cancel with
 * wake({op:"cancel",id:"w-9"})`. The cancel how-to is an instruction for the
 * model, and the `(alarm)`/`Scheduled wake` markers restate what the row's own
 * clock glyph already says — so what the user wants from this line is WHICH wake
 * fired, not how to stop it.
 *
 * A verbatim port of `wake_receipt_headline`
 * (`local_operator/harness/rows.py:397`), comments included, because the phone
 * renders the same receipt from the same helper and a second implementation is
 * how the two drift. The doubled-prefix loop is not defensive padding: a single
 * strip leaves `(alarm) (alarm) …` on a human surface, which is the exact defect
 * the function exists to prevent surviving inside the function that prevents it.
 */
export function wakeReceiptHeadline(text: string): string {
	let head = text.split("\n\n")[0] ?? "";
	head = head.split(/\s+/).filter(Boolean).join(" ");
	head = head.split(" — cancel with wake(")[0];
	const alarm = "(alarm) ";
	while (head.startsWith(alarm)) head = head.slice(alarm.length);
	const prefix = "Scheduled wake ";
	if (head.startsWith(prefix)) head = head.slice(prefix.length);
	return head.trim();
}

/**
 * The prompt the wake actually delivered — everything after the envelope.
 *
 * The TUI's expansion is "the MESSAGE, not the verbatim text re-dumped: the
 * headline row already carries the envelope, so repeating it (cancel how-to
 * included) reads as a second, louder wake". Empty when the delivery carried no
 * envelope, which is the caller's signal that there is nothing to disclose.
 */
export function wakePromptBody(text: string): string {
	const separator = text.indexOf("\n\n");
	return separator === -1 ? "" : text.slice(separator + 2).trim();
}
