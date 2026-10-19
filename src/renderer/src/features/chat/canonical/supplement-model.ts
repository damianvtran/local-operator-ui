/**
 * The turn-supplement ("Highlights") view model — this surface's ONE mapping
 * place (turn-supplements memo §2.8/§2.11/§4.1/§4.2, lane U-b).
 *
 * It sits beside `image-gen-card-model.ts` and for the same reason: the
 * feature's whole vocabulary has exactly one definition per surface, so a wire
 * rename or a copy change is an edit here and no renderer changes. What lives
 * here:
 *
 *   - the FROZEN READER RULE (`supplementDisposition`), the exact port of the
 *     core contract's `reader_disposition` (`local_operator/supplements/
 *     contract.py`): the state machine every surface must agree about, including
 *     the stale-row rule and the "files do not wait for the generator" arms;
 *   - the DISPLAY COPY, byte-identical to the TUI's constants
 *     (`local_operator/tui/supplements.py`): one spelling per line, because the
 *     two surfaces are reviewed against a shared copy table;
 *   - the paint-boundary string discipline (`displayText`, `fileSizeText`,
 *     `countClause`, `moreText`) — the same functions the TUI ports, so all
 *     surfaces agree on what a display string is;
 *   - the IFRAME MESSAGE WIRE (host-side half): the accepted shapes
 *     (`acceptFrameMessage`, the port of the core's reference implementation),
 *     the nonce rules, the watchdog bounds and the theme-token reader.
 *
 * WHAT IT MUST NOT DO. No component document is assembled or interpreted here;
 * documents arrive as `{ html }` from the media relay and are mounted as
 * `data:` URLs in a sandboxed frame. Nothing in this module executes frame
 * content, reads file bytes, or talks to the backend.
 */

import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CONTROL_SEQUENCES } from "../components/trace/receipt-row-model";
import type { TranscriptRecord } from "./transcript-reducer";

/** The `custom_type` of a supplement row (`contract.SUPPLEMENT_CUSTOM_TYPE`). */
export const SUPPLEMENT_CUSTOM_TYPE = "supplement_v1";

/** The `error` value of a row cut by a newer user turn; renders NOTHING (§2.8). */
export const SUPERSEDED_ERROR = "superseded";

/**
 * `height_hint` clamp, mirrored from the contract (`HEIGHT_HINT_MIN/MAX`): the
 * writer clamps at write time, and the reserved box, every `resize` and the
 * block's own budget all operate on this one range (round-1 R8).
 */
export const HEIGHT_HINT_MIN = 120;
export const HEIGHT_HINT_MAX = 480;

/** `more[]` disclosure bound (`contract.MORE_MAX`): the stored ≤ 20 paths. */
export const MORE_MAX = 20;

/** Components per job (`contract.MAX_COMPONENTS`), the aggregate budget's bound. */
export const MAX_COMPONENTS = 3;

/** The one-shot text bound for `supplement_steer` (`contract.STEER_TEXT_MAX_CHARS`). */
export const STEER_TEXT_MAX_CHARS = 500;

// ---------------------------------------------------------------------------
// Rows (the journal/wire shapes, read defensively)
// ---------------------------------------------------------------------------

export type SupplementFile = {
	/** Session-relative or `~/`-relative, NEVER absolute (memo S-R14). */
	path: string;
	name: string;
	kind: string;
	sizeBytes: number;
	mtime: number;
	why: string;
};

export type SupplementComponent = {
	/** The attachment digest the document route is addressed by. */
	attachment: string;
	/** The component's name for tooling and accessibility — never chrome. */
	title: string;
	source: string;
	mime: string;
	heightHint: number;
};

/**
 * One anchor's supplement row, as the transcript stores it.
 *
 * KEYED BY ANCHOR, NOT BY ENTRY ID (`supplement:<anchor>`, see
 * `supplementRecordKey`): versions of one job all resolve to ONE record, and
 * the newest wins by the contract's (version, rank) rule, so the block can
 * never paint twice under one answer.
 */
export type SupplementRecord = Extract<
	TranscriptRecord,
	{ kind: "supplement" }
>;

/** The record key one anchor's block lives under, in ONE spelling. */
export function supplementRecordKey(anchor: string): string {
	return `supplement:${anchor}`;
}

/**
 * The record key a history row resolves to, or null for any other entry.
 *
 * TWO ENVELOPES, ONE KEY. A durable page serves the row as
 * `type: "custom"` with `payload: {custom_type, details}`; a live
 * `history_delta` folds the same row as a message-row custom
 * (`payload: {kind: "custom", custom_type, details, ...}`). Both spell the
 * anchor in `details.anchor`, and that is the key the record must land under in
 * either case — which is why this reader checks the payload, not `entry.type`.
 */
export function supplementKeyForEntry(
	entry: Pick<DesktopHistoryPage["entries"][number], "payload">,
): string | null {
	const payload = entry.payload ?? {};
	if (String(payload.custom_type ?? "") !== SUPPLEMENT_CUSTOM_TYPE) return null;
	const details = (payload.details ?? {}) as Record<string, unknown>;
	const anchor = typeof details.anchor === "string" ? details.anchor : "";
	return anchor ? supplementRecordKey(anchor) : null;
}

/** A finite number from an untyped wire field, or `null`. */
function finiteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return null;
}

/** One file callout, read field-by-field; a malformed entry is dropped, never guessed. */
function fileFrom(value: unknown): SupplementFile | null {
	if (!value || typeof value !== "object") return null;
	const file = value as Record<string, unknown>;
	const path = typeof file.path === "string" ? file.path : "";
	const name = typeof file.name === "string" ? file.name : "";
	if (!path && !name) return null;
	return {
		path,
		name,
		kind: typeof file.kind === "string" ? file.kind : "",
		sizeBytes: finiteNumber(file.size_bytes) ?? 0,
		mtime: finiteNumber(file.mtime) ?? 0,
		why: typeof file.why === "string" ? file.why : "",
	};
}

export function filesFrom(value: unknown): SupplementFile[] {
	if (!Array.isArray(value)) return [];
	const files: SupplementFile[] = [];
	for (const entry of value) {
		const file = fileFrom(entry);
		if (file) files.push(file);
	}
	return files;
}

function componentFrom(value: unknown): SupplementComponent | null {
	if (!value || typeof value !== "object") return null;
	const component = value as Record<string, unknown>;
	const attachment =
		typeof component.attachment === "string" ? component.attachment : "";
	// The digest is the record's one routing key: a component without a valid
	// one could be painted but never loaded, so it is dropped rather than shown
	// as a reserved box that can never fill.
	if (!isDigest(attachment)) return null;
	const hint = finiteNumber(component.height_hint);
	return {
		attachment,
		title: typeof component.title === "string" ? component.title : "",
		source: typeof component.source === "string" ? component.source : "",
		mime: typeof component.mime === "string" ? component.mime : "text/html",
		heightHint:
			hint === null
				? HEIGHT_HINT_MIN
				: Math.min(
						HEIGHT_HINT_MAX,
						Math.max(HEIGHT_HINT_MIN, Math.round(hint)),
					),
	};
}

export function componentsFrom(value: unknown): SupplementComponent[] {
	if (!Array.isArray(value)) return [];
	const components: SupplementComponent[] = [];
	for (const entry of value) {
		const component = componentFrom(entry);
		if (component) components.push(component);
	}
	return components;
}

/**
 * One generated sound a highlight job referenced (`SupplementSound` on the
 * wire; sound phase, 2026-10-17).
 *
 * WHY THE SOUND IS REFERENCED BY DIGEST RATHER THAN BY PATH: a generated
 * sound's bytes live in the attachment store (the transcript's own media), so
 * the row addresses them the way every other canonical attachment does — and
 * the block's player mounts through the SAME resolver the transcript uses
 * (`useAttachmentSource` + `SoundPlayer`), which is the whole point of
 * referencing rather than carrying anything else.
 */
export type SupplementSound = {
	/** The attachment digest the player resolves. */
	attachment: string;
	mime: string;
	/** The sound's display title, from the producer; never chrome. */
	title: string;
	/** Seconds, from the record that wrote it; `null` when it stated none. */
	durationS: number | null;
};

/** One sound entry, read field-by-field; a malformed entry is dropped. */
function soundFrom(value: unknown): SupplementSound | null {
	if (!value || typeof value !== "object") return null;
	const sound = value as Record<string, unknown>;
	const attachment =
		typeof sound.attachment === "string" ? sound.attachment : "";
	// The digest is the entry's one routing key: a sound without a valid one
	// could be listed but never played, so it is dropped rather than shown as a
	// player that can never fill (the same rule `componentFrom` above states).
	if (!isDigest(attachment)) return null;
	return {
		attachment,
		mime: typeof sound.mime === "string" ? sound.mime : "audio/mpeg",
		title: typeof sound.title === "string" ? sound.title : "",
		durationS: finiteNumber(sound.duration_s),
	};
}

export function soundsFrom(value: unknown): SupplementSound[] {
	if (!Array.isArray(value)) return [];
	const sounds: SupplementSound[] = [];
	for (const entry of value) {
		const sound = soundFrom(entry);
		if (sound) sounds.push(sound);
	}
	return sounds;
}

/** The contract's digest shape: 32 lowercase hex characters. */
export const DIGEST_RE = /^[a-f0-9]{32}$/;

/** Every run of whitespace, the display boundary's collapse. */
const WHITESPACE_RUN = /\s+/;

/** The trailing `.0` a one-decimal size drops (`4.0 KB` reads `4 KB`). */
const TRAILING_ZERO_DECIMAL = /\.0$/;

export function isDigest(value: unknown): value is string {
	return typeof value === "string" && DIGEST_RE.test(value);
}

// ---------------------------------------------------------------------------
// The reader rule (contract.reader_disposition, ported byte-for-byte)
// ---------------------------------------------------------------------------

export type SupplementRowState =
	| "decided"
	| "queued"
	| "running"
	| "cancelling"
	| "done"
	| "failed"
	| "cancelled"
	| "skipped";

/** What a surface paints for the newest row of an anchor (`ReaderDisposition`). */
export type SupplementDisposition =
	| "preparing"
	| "files_preparing"
	| "block"
	| "cancelled_retry"
	| "files_cancelled_retry"
	| "failed_retry"
	| "files_failed_retry"
	| "nothing";

const WITH_FILES: Partial<
	Record<SupplementDisposition, SupplementDisposition>
> = {
	preparing: "files_preparing",
	cancelled_retry: "files_cancelled_retry",
	failed_retry: "files_failed_retry",
};

/**
 * How far along a state is, for "is this row newer than what we hold"
 * (`contract`/`tui.supplements.state_rank`): terminal arms tie, and an unknown
 * word reads as 0 — the fail-open direction for a READER (nothing dominates
 * what it cannot classify) is the core's own choice, kept here so the two
 * readers cannot disagree.
 */
export function stateRank(state: unknown): number {
	switch (state) {
		case "decided":
			return 0;
		case "queued":
			return 1;
		case "running":
			return 2;
		case "cancelling":
			return 3;
		case "done":
		case "failed":
		case "cancelled":
		case "skipped":
			return 4;
		default:
			return 0;
	}
}

/**
 * The frozen reader rule: what every surface must paint for one row.
 *
 * `jobLive` is whether THIS runtime's job registry holds the job — in this
 * view, whether a live non-terminal beat has been seen. A cold reader (history
 * reload, reopened app) or a reaper-cut job has no live job, and then a
 * non-terminal row renders as `cancelled · Retry` instead of spinning forever
 * (the stale-row rule; the shared `queued_stale` fixture pins it). Precedence
 * is the memo's: a superseded or dismissed row renders nothing whatever its
 * state; then the committed state decides; then a non-`done` row that carries
 * files paints them above its line (the decision wrote them first so they need
 * not wait, §2.4).
 */
export function supplementDisposition(
	record: SupplementRecord,
	jobLive: boolean,
): SupplementDisposition {
	const state = record.state;
	if (
		record.error === SUPERSEDED_ERROR ||
		record.dismissed ||
		state === "skipped"
	)
		return "nothing";
	if (state === "done") {
		// What a settled row SHOWS: the files it features and the components it
		// carries. The core's own rule also counts `images`, but this lane renders
		// none of them (no v1 producer generates one, §3.4) — a row whose only
		// content were images would paint an empty block, so the clause returns
		// with their renderer rather than admitting a block that shows nothing.
		// A sounds-only highlight is content too; otherwise its player never mounts.
		return record.files.length ||
			record.components.length ||
			record.sounds?.length
			? "block"
			: "nothing";
	}
	let line: SupplementDisposition;
	if (state === "failed") line = "failed_retry";
	else if (state === "cancelled") line = "cancelled_retry";
	else if (
		state === "decided" ||
		state === "queued" ||
		state === "running" ||
		state === "cancelling"
	)
		line = jobLive ? "preparing" : "cancelled_retry";
	else return "nothing";
	return record.files.length ? (WITH_FILES[line] ?? line) : line;
}

// ---------------------------------------------------------------------------
// Display copy and the paint boundary (ported from tui/supplements.py)
// ---------------------------------------------------------------------------

/** The loading line's fixed sentence (memo §2.8 copy table). */
export const COPY_PREPARING = "Preparing highlights…";
export const COPY_CANCELLED = "Highlights cancelled";
export const COPY_FAILED = "Couldn't prepare highlights";
/** The frame-level fallback (§2.8): shown in place of a frame that died or hung. */
export const COPY_FRAME_FALLBACK = "Couldn't render this graphic";
/** The two control labels of the pointer-surface action pair (D10). */
export const COPY_ADJUST = "Adjust…";
export const COPY_CANCEL = "Cancel";
/** The retry affordance the cancelled/failed/frame lines carry. */
export const COPY_RETRY = "Retry";

/**
 * The longest `cause` a reader keeps. The vocabulary is short allowlisted
 * tokens (`provider_<kind>`), so the bound guards against a runaway wire
 * value rather than a display limit: a truncated token stops matching the
 * table below and paints the bare sentence, which is the hostile-value rule
 * anyway. Same bound as the core's phone reader (`CAUSE_MAX_CHARS` in
 * `mobile/web/src/lib/supplement.ts`).
 */
export const CAUSE_MAX_CHARS = 64;

/**
 * The failed line's typed-cause phrases: the ONE word list every surface
 * transcribes (memo §2.8 as amended by core #2557; the TUI's
 * `_CAUSE_PHRASES` and the phone's `causePhrase` carry the same words). The
 * line names the wall a Retry would meet (operator ask, 2026-10-17).
 * `provider_unknown` — and any token this build does not know — renders NO
 * phrase: the catch-all folds `aborted` in, and inventing a failure mode for
 * it is worse than the bare sentence (design round 1, D2).
 */
export const CAUSE_PHRASES: Record<string, string> = {
	provider_quota: "provider limit reached",
	provider_auth: "provider sign-in needed",
	provider_transient: "provider temporarily unavailable",
	provider_timeout: "provider timed out",
	provider_request: "provider refused the request",
	provider_content: "provider blocked the content",
	provider_context: "provider context limit",
};

/** The muted phrase for a failed row's typed `cause`; `""` when absent/unknown. */
export function causePhrase(cause: unknown): string {
	return typeof cause === "string" && cause ? (CAUSE_PHRASES[cause] ?? "") : "";
}

/**
 * One host-rendered string, safe to paint on one line (the TUI's
 * `display_text`): control sequences stripped, every whitespace run — newlines
 * included — collapsed to a single space. Non-strings read as `""` so a
 * malformed row paints nothing rather than throwing on a render path.
 *
 * The alphabet is the trace rows' own shared port of `local_operator/ansi.py`
 * (`receipt-row-model.ts::CONTROL_SEQUENCES`), NOT a second pattern: a name
 * that is safe in a peer row must be safe in a file callout by construction.
 */
export function displayText(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.replace(CONTROL_SEQUENCES, "")
		.split(WHITESPACE_RUN)
		.filter(Boolean)
		.join(" ");
}
/** The disclosure's words: `3 more files` (memo §2.8). */
export function moreText(count: number): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? "1 more file" : `${bounded} more files`;
}

/**
 * A byte count as the short column the file rows carry (`912 B` / `4.1 KB` /
 * `1.2 MB`): one decimal on the scaled units, a trailing `.0` dropped. A value
 * that is not a non-negative number reads as `""` — the column is simply
 * absent, never a wrong number.
 */
export function fileSizeText(sizeBytes: unknown): string {
	if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) return "";
	if (sizeBytes < 0) return "";
	if (sizeBytes < 1024) return `${Math.trunc(sizeBytes)} B`;
	const units: ReadonlyArray<readonly [string, number]> = [
		["KB", 1024],
		["MB", 1024 ** 2],
		["GB", 1024 ** 3],
	];
	for (const [unit, scale] of units) {
		if (sizeBytes < scale * 1024 || unit === "GB") {
			const value = sizeBytes / scale;
			const text = value.toFixed(1).replace(TRAILING_ZERO_DECIMAL, "");
			return `${text} ${unit}`;
		}
	}
	return "";
}

/** `(name, path, size)` for one callout row, each display-stripped. */
export function fileRowParts(file: SupplementFile): {
	name: string;
	path: string;
	size: string;
} {
	const name = displayText(file.name) || displayText(file.path);
	const rawPath = displayText(file.path);
	return {
		name,
		path: rawPath === name ? "" : rawPath,
		size: fileSizeText(file.sizeBytes),
	};
}

/**
 * One count clause, singular/plural: `1 file` / `2 files`, `1 graphic` /
 * `2 graphics` (design D1's copy table). Reveal copy reuses this noun/count
 * grammar; it does not change the overflow tail's separate Show all meaning.
 */
export function countClause(count: number, noun: "file" | "graphic"): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? `1 ${noun}` : `${bounded} ${noun}s`;
}

/**
 * Closed copy names the budgeted head precisely: "Show 1 of 3 graphics" does
 * not promise the off-budget tail. Open copy names the whole group being hidden,
 * including a tail explicitly opened inside it. Equal counts keep the singular
 * grammar ("Show 1 graphic") without an unnecessary "1 of 1".
 */
export function graphicRevealText(
	count: number,
	open: boolean,
	headCount = count,
): string {
	if (open) return `Hide ${countClause(count, "graphic")}`;
	return headCount < count
		? `Show ${Math.max(0, Math.floor(headCount))} of ${countClause(count, "graphic")}`
		: `Show ${countClause(count, "graphic")}`;
}

/**
 * The overflow tail's own words: `Show all 2 graphics` — singularized for one
 * (`Show all 1 graphic`), matching `moreText`'s singular arm (UX round 1, U7).
 */
export function showAllText(count: number): string {
	const bounded = Math.max(0, Math.floor(count));
	return bounded === 1 ? "Show all 1 graphic" : `Show all ${bounded} graphics`;
}

/** `Source: …` — the block's one caption line (§2.10). */
export function sourceLine(source: string): string {
	return `Source: ${displayText(source)}`;
}

// ---------------------------------------------------------------------------
// The frame message wire (§4.1/§4.2)
// ---------------------------------------------------------------------------

export const FRAME_MESSAGE_TAG = "supplement";
export const HOST_MESSAGE_TAG = "supplement-host";
export const FRAME_PROTOCOL_VERSION = 1;

/** The ONLY frame -> host shapes a host accepts. */
export const FRAME_MESSAGE_TYPES = [
	"ready",
	"resize",
	"error",
	"pong",
] as const;
export type FrameMessageType = (typeof FRAME_MESSAGE_TYPES)[number];

/**
 * Those that can move host state and so MUST echo the per-frame nonce.
 * `ready` precedes the first theme push (which is what delivers the nonce) and
 * moves nothing.
 */
export const NONCE_REQUIRED_TYPES: readonly FrameMessageType[] = [
	"resize",
	"error",
	"pong",
];

/** The longest nonce a host may mint (`contract.NONCE_MAX_CHARS`). */
export const NONCE_MAX_CHARS = 64;
/** The longest `msg` an `error` may carry (`contract.ERROR_MSG_MAX_CHARS`). */
export const ERROR_MSG_MAX_CHARS = 300;
/** The watchdog bound (`contract.WATCHDOG_S`), in ms. */
export const WATCHDOG_MS = 5000;
/**
 * How often the host pings a ready frame. ONE OUTSTANDING AT A TIME, never
 * coalesced away (round-2 S-R2-5): the ping is the liveness probe, and a frame
 * whose main thread is wedged (a `while(1)` in component script — S12) fails
 * to answer within the watchdog and is unmounted into the frame-level fallback
 * line. 20 s is a calm cadence: a healthy frame answers in microseconds, and a
 * wedged one is caught within watchdog + interval.
 */
export const PING_INTERVAL_MS = 20_000;

/** One accepted frame -> host message. */
export type FrameMessage = {
	lo: "supplement";
	v: 1;
	t: FrameMessageType;
	n?: string;
	h?: number;
	msg?: string;
};

/**
 * The SHAPE half of the host's acceptance rule (the port of the core's
 * `accept_frame_message`, which every host mirrors). Returns the message when
 * it is one of the four accepted shapes and, for a state-moving type, carries
 * the live `nonce`; everything else — wrong tag or version, an unknown `t`, a
 * missing or stale nonce, a non-finite or negative `h`, an `error` whose `msg`
 * is not a string of at most `ERROR_MSG_MAX_CHARS` — is `null`.
 *
 * NOT the whole check: `event.source === frame.contentWindow`,
 * `event.origin === "null"`, the navigation counter and the
 * one-message-per-animation-frame coalescing are the frame component's, beside
 * this call.
 */
export function acceptFrameMessage(
	message: unknown,
	nonce: string | null,
): FrameMessage | null {
	if (!message || typeof message !== "object") return null;
	const frame = message as Record<string, unknown>;
	if (frame.lo !== FRAME_MESSAGE_TAG) return null;
	if (frame.v !== FRAME_PROTOCOL_VERSION) return null;
	const kind = frame.t;
	if (
		typeof kind !== "string" ||
		!(FRAME_MESSAGE_TYPES as readonly string[]).includes(kind)
	)
		return null;
	const type = kind as FrameMessageType;
	if (
		NONCE_REQUIRED_TYPES.includes(type) &&
		(!nonce || nonce.length > NONCE_MAX_CHARS || frame.n !== nonce)
	)
		return null;
	if (type === "error") {
		const text = frame.msg;
		if (typeof text !== "string" || text.length > ERROR_MSG_MAX_CHARS)
			return null;
	}
	if (type === "resize") {
		const height = frame.h;
		if (typeof height !== "number" || !Number.isFinite(height) || height < 0)
			return null;
	}
	return {
		lo: "supplement",
		v: 1,
		t: type,
		...(typeof frame.n === "string" ? { n: frame.n } : {}),
		...(typeof frame.h === "number" ? { h: frame.h } : {}),
		...(typeof frame.msg === "string" ? { msg: frame.msg } : {}),
	};
}

/** A per-frame nonce, within `NONCE_MAX_CHARS`: 32 hex characters. */
export function mintNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
}

// ---------------------------------------------------------------------------
// The theme channel (§2.6, §4.1; live switches, §3.3 U11)
// ---------------------------------------------------------------------------

/**
 * The variables the prelude consumes, as the ONE list this host reads.
 *
 * `prelude.css` styles every helper through these names, so the host sends
 * exactly them: a fixed list rather than a CSS-properties enumeration (there
 * is no way to enumerate custom properties, and sending the app's whole
 * variable surface would leak unrelated tokens into a frame the memo keeps
 * token-scoped). The frame's own whitelist (`^--(lo|font)-[a-z0-9-]+$`) admits
 * these and drops anything else.
 */
export const THEME_VARIABLE_NAMES: readonly string[] = [
	"--lo-accent",
	"--lo-accent-wash",
	"--lo-border-control",
	"--lo-canvas",
	"--lo-danger",
	"--lo-hairline",
	"--lo-info",
	"--lo-ink",
	"--lo-ink-dim",
	"--lo-ink-muted",
	"--lo-success",
	"--lo-sunken",
	"--lo-surface",
	"--lo-warning",
	"--font-mono",
	"--font-sans",
];

/** The longest value the wire carries per variable (the prelude slices to 120). */
export const THEME_VALUE_MAX_CHARS = 120;

export type SupplementTheme = {
	mode: "light" | "dark";
	vars: Record<string, string>;
};

/**
 * The theme as the frame is owed it: RESOLVED values, never a palette id
 * (`ThemeMessage`'s contract). Read from the document element the app already
 * publishes its `[data-theme]` blocks onto, so this is correct for every one of
 * the shipped themes without the frame knowing any of them — and because the
 * read happens at message time, a live theme switch is one more push, not a
 * reload.
 */
export function readSupplementTheme(
	root: HTMLElement | null = typeof document === "undefined"
		? null
		: document.documentElement,
): SupplementTheme {
	if (!root || typeof getComputedStyle !== "function")
		return { mode: "dark", vars: {} };
	const style = getComputedStyle(root);
	const vars: Record<string, string> = {};
	for (const name of THEME_VARIABLE_NAMES) {
		const value = style.getPropertyValue(name).trim();
		if (value) vars[name] = value.slice(0, THEME_VALUE_MAX_CHARS);
	}
	const mode = root.classList.contains("dark") ? "dark" : "light";
	return { mode, vars };
}

/**
 * Call `onChange` whenever the document's theme re-inks (the attribute the
 * `[data-theme]` blocks select on, or the `dark` class the mode toggle rides).
 * The frame component subscribes while mounted and pushes a fresh theme message
 * on every change — the live-theme-switch requirement (round-1 D3/U11).
 */
export function subscribeSupplementTheme(
	onChange: (theme: SupplementTheme) => void,
): () => void {
	if (
		typeof MutationObserver === "undefined" ||
		typeof document === "undefined"
	)
		return () => {};
	// The observer re-READS the tokens rather than carrying them: the change it
	// fires on IS a mutation of the document element, so the fresh read is the
	// post-mutation truth by construction, and `onChange` decides whether the new
	// reading differs.
	const observer = new MutationObserver(() => onChange(readSupplementTheme()));
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "class"],
	});
	return () => observer.disconnect();
}

// ---------------------------------------------------------------------------
// The frame's mount URL and the aggregate budget (§2.11, §4.1)
// ---------------------------------------------------------------------------

/**
 * The `data:` URL, kept for the hosts that have NO `lo-supplement:` handler:
 * Storybook and a plain development browser (the arm channel's absence is the
 * same signal the frame component reads). In the built app this form is never
 * mounted — the app's own CSP is inherited by local-scheme child documents, so
 * the vendored prelude would be blocked (measured, UX round 1 U1) — and the
 * app mounts the digest-addressed `lo-supplement:` URL
 * (`shared/supplement-frame-url.ts`) instead, served by the main process.
 *
 * Base64, not percent-encoding: one code path, and 64 KB documents are fine in
 * it (§4.1). The encoding is UTF-8-safe (`btoa` alone throws on non-Latin-1),
 * which matters because component prose is arbitrary text.
 */
export function supplementFrameUrl(html: string): string {
	return `data:text/html;base64,${base64Utf8(html)}`;
}

/** UTF-8 bytes -> base64, without `unescape` or a TextEncoder dependency. */
function base64Utf8(text: string): string {
	const bytes = utf8Bytes(text);
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i] ?? 0;
		const b1 = bytes[i + 1] ?? 0;
		const b2 = bytes[i + 2] ?? 0;
		out += alphabet[b0 >> 2];
		out += alphabet[((b0 & 3) << 4) | (b1 >> 4)];
		out += i + 1 < bytes.length ? alphabet[((b1 & 15) << 2) | (b2 >> 6)] : "=";
		out += i + 2 < bytes.length ? alphabet[b2 & 63] : "=";
	}
	return out;
}

/** The UTF-8 encoding of `text`, computed without a TextEncoder in scope. */
function utf8Bytes(text: string): number[] {
	const bytes: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code <= 0x7f) bytes.push(code);
		else if (code <= 0x7ff) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code <= 0xffff) {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return bytes;
}

/**
 * The block's automatic-mount budget: `min(480 px, 40 vh)` (round-1 D1).
 * Frames mount automatically only while their cumulative RENDERED heights stay
 * inside this; anything beyond sits behind one disclosure.
 */
export function frameBudgetPx(viewportHeight: number): number {
	return Math.min(480, Math.round(0.4 * Math.max(0, viewportHeight)));
}

/** One component's clamped mount height (the reserved box measures the same). */
export function clampedHeightHint(component: SupplementComponent): number {
	return Math.min(
		HEIGHT_HINT_MAX,
		Math.max(HEIGHT_HINT_MIN, component.heightHint),
	);
}

/**
 * A resize's height, clamped into the contract's [120, 480] range.
 *
 * The accept step validates SHAPE only (the contract's own reader); the CLAMP
 * is the host's, per the contract's note that "a host clamps `h` to its own
 * range regardless" — the nonce binds the browsing context, not the code in
 * it, so a hostile successor document would otherwise pick its own size.
 */
export function clampFrameHeight(height: number): number {
	return Math.min(HEIGHT_HINT_MAX, Math.max(HEIGHT_HINT_MIN, height));
}

/**
 * Which components mount automatically, and whether a disclosure is owed.
 *
 * The walk takes components in order while the cumulative RENDERED height stays
 * within the budget; whatever remains is behind `Show all N graphics`. The
 * FIRST frame is admitted regardless of the budget, deliberately: a block
 * whose single graphic sat behind `Show all 1 graphic` would open on an
 * empty-looking row, and the design's "anything beyond [the budget] sits
 * behind one disclosure" reads as the frames beyond the first that fits — a
 * taller-than-budget first frame (a short window, a 480 px component) is
 * exactly what the reader came for. The rest still respect the budget, so a
 * short window shows one frame and discloses the others.
 *
 * THE ACCRUAL IS MADE OF RENDERED HEIGHTS (design D5), which is why the walk
 * HOLDS at the first unmeasured predecessor: `measured` carries each mounted
 * frame's ACTUAL box height, by digest, once its resize has landed — and a
 * frame whose height is still unknown is the reserved box, NOT a rendered
 * height. A later frame therefore mounts only when every earlier one has
 * reported AND the sum fits; the reserved box of a just-mounted frame is never
 * counted as if it were the document. This is the fix for the measured
 * 758 px auto-mount against a ~408 px budget: hint-only accrual admitted two
 * frames whose documents rendered nearly twice their hints.
 *
 * `measured` absent (a pure caller, a test) means NOTHING has rendered yet, so
 * only the first frame is admitted — the honest reading of "no frame has
 * reported a height", not a second rule.
 *
 * The stickiness — "an already-mounted frame stays" — lives at the CALLER (the
 * row keeps the count it has reached): this function answers only "what would
 * mount given what is known now", and unmounting a frame the reader is looking
 * at because a document overran its hint is exactly the behaviour the design's
 * "leave the already-mounted ones alone" forbids.
 *
 * A zero budget (a not-yet-measured viewport) still admits the first: the
 * frame's own reserved box is within the contract's [120, 480] clamp, and
 * "mount nothing" would make a measurement lag read as "no graphics".
 */
export function planComponentMounts(
	components: readonly SupplementComponent[],
	budgetPx: number,
	measured?: ReadonlyMap<string, number>,
): { visible: SupplementComponent[]; hidden: SupplementComponent[] } {
	let used = 0;
	const visible: SupplementComponent[] = [];
	for (let index = 0; index < components.length; index += 1) {
		const component = components[index];
		const rendered = measured?.get(component.attachment);
		const height =
			rendered !== undefined
				? clampFrameHeight(rendered)
				: clampedHeightHint(component);
		if (index > 0) {
			// The accrual must be rendered heights: a predecessor that has not
			// reported yet holds the walk (see the header).
			const settled = visible.every(
				(earlier) => measured?.get(earlier.attachment) !== undefined,
			);
			if (!settled) break;
			if (used + height > budgetPx) break;
		}
		// The first frame is admitted regardless of the budget, on its own
		// estimate alone.
		used += height;
		visible.push(component);
	}
	return { visible, hidden: components.slice(visible.length) };
}

// ---------------------------------------------------------------------------
// Parsing the two envelopes
// ---------------------------------------------------------------------------

/**
 * A patch built from a `details` object (`supplement_v1` row or a live
 * `supplement_progress` event — the same vocabulary). `undefined` fields mean
 * "the beat did not state one"; the merge below never invents a value.
 */
export type SupplementPatch = {
	anchor: string;
	job: string;
	version: number;
	state: SupplementRowState;
	files?: SupplementFile[];
	filesMore?: number;
	more?: string[];
	components?: SupplementComponent[];
	/** Present only on a beat that stated the list (the `done` beat, or a durable row's `details`). */
	sounds?: SupplementSound[];
	error?: string;
	/** The failed line's typed cause (`provider_<kind>`); the reader bounds it. */
	cause?: string;
	model?: string;
	attempts?: string[];
	detail?: string[];
	dismissed?: boolean;
	/**
	 * Whether a NON-TERMINAL live beat has been observed for this row in this
	 * view (`job_live` for the reader rule). `true` only from the live event
	 * path; a durable row never sets it, which is the stale-row rule.
	 */
	live?: boolean;
};

const DIAGNOSTIC_SELECTOR = /^[a-z][a-z0-9-]*\/[a-zA-Z0-9._:/-]{1,160}$/;
const DIAGNOSTIC_DETAIL =
	/^turn \d{1,2}: ProviderError status=(?:None|[1-5]\d{2}) kind=(?:auth|quota|transient|timeout|request|content|context|unknown)$/;
const DIAGNOSTIC_ACCESS = /kind=(auth|quota)\b/;
const DIAGNOSTIC_SERVICE = /kind=(transient|timeout)\b/;

/**
 * Only selectors and typed status/kind survive; never display arbitrary
 * provider prose. The typed `cause` token is kept whole (bounded) because the
 * display gate is the word table, not this reader: an unknown token renders
 * the bare sentence, so no arbitrary value reaches a line.
 */
function diagnosticsFrom(
	value: Record<string, unknown>,
): Pick<SupplementPatch, "model" | "attempts" | "detail" | "cause"> {
	const selector = (item: unknown): string =>
		typeof item === "string" &&
		DIAGNOSTIC_SELECTOR.test(item) &&
		!item.includes("://")
			? item
			: "";
	const model = selector(value.model);
	const attempts = Array.isArray(value.attempts)
		? value.attempts.map(selector).filter(Boolean).slice(0, 8)
		: undefined;
	const detail = Array.isArray(value.detail)
		? value.detail
				.filter(
					(item): item is string =>
						typeof item === "string" &&
						(DIAGNOSTIC_DETAIL.test(item) || item === "prepared:unsupported"),
				)
				.slice(0, 8)
		: undefined;
	const cause =
		typeof value.cause === "string"
			? value.cause.slice(0, CAUSE_MAX_CHARS)
			: "";
	return {
		...(model ? { model } : {}),
		...(attempts ? { attempts } : {}),
		...(detail ? { detail } : {}),
		...(cause ? { cause } : {}),
	};
}

export function diagnosticDisplay(line: string): string {
	const match = DIAGNOSTIC_DETAIL.exec(line);
	if (!match) return "";
	const words = line.split(" ");
	const attempt = words[1].replace(":", "");
	const status = words[3].slice("status=".length);
	const kind = words[4].slice("kind=".length);
	return `Attempt ${attempt}: ${kind}${status === "None" ? "" : ` (HTTP ${status})`}`;
}

export function failureExplanation(record: SupplementRecord): string {
	const typed =
		record.error === "generator:ProviderError"
			? (record.detail?.at(-1) ?? "")
			: "";
	if (DIAGNOSTIC_ACCESS.test(typed))
		return "The highlights model is unavailable right now. Your answer and files are unchanged.";
	if (DIAGNOSTIC_SERVICE.test(typed))
		return "The highlights service did not respond. Your answer and files are unchanged.";
	if (record.error === "bound:cost")
		return "Highlights stopped at the spending limit or unavailable pricing. Your answer and files are unchanged.";
	if (record.error === "bound:time")
		return "Highlights reached the time limit. Your answer and files are unchanged.";
	return "Your answer and files are unchanged. You can retry the highlights.";
}

/** One `supplement_progress` event's payload -> a patch, or null if it names no anchor. */
export function supplementPatchFromEvent(
	event: Record<string, unknown>,
): SupplementPatch | null {
	const anchor = typeof event.anchor === "string" ? event.anchor : "";
	if (!anchor) return null;
	const state = String(event.state ?? "");
	if (!isRowState(state)) return null;
	const patch: SupplementPatch = {
		anchor,
		job: typeof event.job === "string" ? event.job : "",
		version:
			typeof event.version === "number" && Number.isInteger(event.version)
				? event.version
				: 0,
		state,
		// The wire carries `files` only on `decided`/`done` and `components` only
		// on `done` (memo §2.7); anything else leaves the held value in place.
		// `sounds` is the sound phase's sibling of `components`: the harness states
		// it on the same `done` beat (and on the durable row's `details`), and a
		// beat that does not state it leaves whatever the row already held.
		...(state === "decided" || state === "done"
			? { files: filesFrom(event.files) }
			: {}),
		...(state === "done"
			? {
					components: componentsFrom(event.components),
					sounds: soundsFrom(event.sounds),
				}
			: {}),
		...(typeof event.error === "string" && event.error
			? { error: event.error.slice(0, ERROR_MSG_MAX_CHARS) }
			: {}),
		...diagnosticsFrom(event),
		live: !isTerminalState(state),
	};
	return patch;
}

/** One durable row's `details` -> a patch, or null if it names no anchor. */
export function supplementPatchFromDetails(
	details: Record<string, unknown>,
): SupplementPatch | null {
	const anchor = typeof details.anchor === "string" ? details.anchor : "";
	if (!anchor) return null;
	const state = String(details.state ?? "");
	if (!isRowState(state)) return null;
	const filesMore =
		typeof details.files_more === "number" &&
		Number.isInteger(details.files_more) &&
		details.files_more >= 0
			? details.files_more
			: 0;
	const more = Array.isArray(details.more)
		? details.more
				.filter((item): item is string => typeof item === "string")
				.slice(0, MORE_MAX)
		: [];
	const patch: SupplementPatch = {
		anchor,
		job: typeof details.job === "string" ? details.job : "",
		version:
			typeof details.version === "number" && Number.isInteger(details.version)
				? details.version
				: 0,
		state,
		files: filesFrom(details.files),
		filesMore,
		more,
		components: componentsFrom(details.components),
		// Absent on every row older than the sound phase; `soundsFrom` answers an
		// empty list for those, and the merge below keeps a previous list when the
		// patch does not state one — the same rule `files`/`components` follow.
		sounds: soundsFrom(details.sounds),
		...diagnosticsFrom(details),
		...(details.dismissed === true ? { dismissed: true } : {}),
		...(typeof details.error === "string" && details.error
			? { error: details.error.slice(0, ERROR_MSG_MAX_CHARS) }
			: {}),
	};
	return patch;
}

/**
 * Fold one durable supplement row onto the record this anchor holds.
 *
 * `previous` is the record already standing for the same anchor — the callers
 * look it up under `supplementRecordKey(anchor)` rather than under the journal
 * entry id, because one block is one record however many versions the journal
 * holds (and however many doors a version arrives through).
 */
export function supplementRecordFromDetails(
	ts: number,
	details: Record<string, unknown>,
	previous: TranscriptRecord | undefined,
): SupplementRecord | null {
	const patch = supplementPatchFromDetails(details);
	if (!patch) return null;
	const held =
		previous &&
		previous.kind === "supplement" &&
		previous.anchor === patch.anchor
			? previous
			: null;
	return mergeSupplement(held, patch, ts);
}

function isRowState(state: string): state is SupplementRowState {
	return (
		state === "decided" ||
		state === "queued" ||
		state === "running" ||
		state === "cancelling" ||
		state === "done" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "skipped"
	);
}

function isTerminalState(state: SupplementRowState): boolean {
	return (
		state === "done" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "skipped"
	);
}

function sameFiles(a: readonly SupplementFile[], b: readonly SupplementFile[]) {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((file, index) => {
		const other = b[index];
		return (
			file.path === other.path &&
			file.name === other.name &&
			file.kind === other.kind &&
			file.sizeBytes === other.sizeBytes &&
			file.mtime === other.mtime &&
			file.why === other.why
		);
	});
}

function sameComponents(
	a: readonly SupplementComponent[],
	b: readonly SupplementComponent[],
) {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((component, index) => {
		const other = b[index];
		return (
			component.attachment === other.attachment &&
			component.title === other.title &&
			component.source === other.source &&
			component.mime === other.mime &&
			component.heightHint === other.heightHint
		);
	});
}

/**
 * Whether two sound lists are the same list, for the merge's identity rule:
 * a patch that restates an identical list keeps the PREVIOUS array, so the
 * block's memoised children do not re-render for a beat that said nothing new.
 */
function sameSounds(
	a: readonly SupplementSound[],
	b: readonly SupplementSound[],
) {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((sound, index) => {
		const other = b[index];
		return (
			sound.attachment === other.attachment &&
			sound.mime === other.mime &&
			sound.title === other.title &&
			sound.durationS === other.durationS
		);
	});
}

/**
 * Fold one patch onto the record this anchor holds (or nothing, for a new
 * anchor). Returns the record to store, or `null` when the patch is OLDER than
 * what stands — the (version, rank) rule, plus the version-scoped error and
 * dismissal: a new version starts a clean slate for the fields the previous
 * row only carried because they were terminal.
 *
 * THE MERGE NEVER DROPS A STATED FACT. A live `running` beat carries no files
 * (the wire does not repeat them), so the files the `decided` row already
 * painted stay; a `done` beat restates both lists and replaces them.
 */
export function mergeSupplement(
	previous: SupplementRecord | null,
	patch: SupplementPatch,
	ts: number,
): SupplementRecord | null {
	if (previous) {
		if (patch.version < previous.version) return null;
		if (
			patch.version === previous.version &&
			stateRank(patch.state) < stateRank(previous.state)
		)
			return null;
	}
	const newVersion = !previous || patch.version > previous.version;
	const files =
		patch.files !== undefined ? patch.files : (previous?.files ?? []);
	const components =
		patch.components !== undefined
			? patch.components
			: (previous?.components ?? []);
	/*
	 * The sound list follows the components rule exactly: a patch that states one
	 * replaces it, a patch that does not keeps whatever the row held, and a row
	 * older than the sound phase holds an empty list that renders nothing.
	 */
	const sounds =
		patch.sounds !== undefined ? patch.sounds : (previous?.sounds ?? []);
	const filesMore =
		patch.filesMore !== undefined
			? patch.filesMore
			: (previous?.filesMore ?? 0);
	const more = patch.more !== undefined ? patch.more : (previous?.more ?? []);
	const error = patch.error ?? (newVersion ? "" : (previous?.error ?? ""));
	const cause = patch.cause ?? (newVersion ? "" : (previous?.cause ?? ""));
	const dismissed =
		patch.dismissed ?? (newVersion ? false : (previous?.dismissed ?? false));
	const live =
		patch.live !== undefined
			? patch.live === true
				? true
				: isTerminalState(patch.state)
					? false
					: (previous?.live ?? false)
			: (previous?.live ?? false);
	const record: SupplementRecord = {
		kind: "supplement",
		// Keyed by anchor: one record per answer, the newest version winning. The
		// entry-id a durable row arrives under is deliberately NOT the key — the
		// live beats and the durable rows of one job must land on ONE row.
		id: supplementRecordKey(patch.anchor),
		ts: previous?.ts ?? ts,
		anchor: patch.anchor,
		job: patch.job || previous?.job || "",
		version: patch.version,
		state: patch.state,
		files: sameFiles(files, previous?.files ?? [])
			? (previous?.files ?? [])
			: files,
		filesMore,
		more: sameFilesMore(more, previous?.more ?? [])
			? (previous?.more ?? [])
			: more,
		components: sameComponents(components, previous?.components ?? [])
			? (previous?.components ?? [])
			: components,
		sounds: sameSounds(sounds, previous?.sounds ?? [])
			? (previous?.sounds ?? [])
			: sounds,
		error,
		cause,
		model: patch.model ?? (newVersion ? "" : (previous?.model ?? "")),
		attempts: patch.attempts ?? (newVersion ? [] : (previous?.attempts ?? [])),
		detail: patch.detail ?? (newVersion ? [] : (previous?.detail ?? [])),
		dismissed,
		live,
	};
	return record;
}

function sameFilesMore(a: readonly string[], b: readonly string[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((item, index) => item === b[index]);
}
