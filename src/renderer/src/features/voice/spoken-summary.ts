/**
 * THE SPOKEN SUMMARY'S DETECTION: which paragraph of a reply the agent wrote
 * for the ear, found by the SAME rule the server speaks it by.
 *
 * The backend (`local_operator/voice/speakable.py`, `select_spoken`; design
 * `docs/design/voice-spoken-summary.md`) picks the LAST paragraph that opens with
 * `Spoken:` (or `**Spoken:**`) and speaks it. The paragraph stays in the stored
 * message, so the transcript has to find the same paragraph to draw it as a
 * labelled block: a block drawn from a different paragraph than the one spoken
 * would be the screen disagreeing with the audio. Hence ONE pure function, and
 * the rule written out here so a divergence is a diff against the server's, not
 * a surprise.
 *
 * THE RULE
 *   - Fenced code (``` and a `~~~` that opens its own line, as the server's
 *     `_DISPLAY_FENCE`) is masked first: a `Spoken:` inside one is an example of
 *     the protocol, not a marker, and a blank line inside one ends nothing.
 *     An unclosed fence runs to the end, so a streaming fence never leaks.
 *   - A paragraph runs to the next blank line. It is a marker only when its first
 *     non-space token is the label: at most THREE leading spaces (four is an
 *     indented code block, which is not a marker), case-insensitive, optionally
 *     wrapped in emphasis (`**Spoken:**`, `**Spoken**:`, `_Spoken:_`).
 *   - The LAST marker wins. A label alone on its own line takes the NEXT
 *     paragraph as its words (models put a bold label on a line of its own).
 *   - `**Spoken: ...**` wraps the whole paragraph: its closing marker has no
 *     opener left and is dropped, as the server drops it.
 *
 * WHAT THE RENDERER DOES NOT DO: it never composes spoken text. The words the
 * rig says come from the server; this module only decides what to DRAW, and
 * `body` (everything else) is the reply without the paragraph.
 *
 * STREAMING: the paragraph is written last, so a half-written reply ends in it.
 * With `streaming` the block is drawn the moment a paragraph starts with the
 * label, and a final paragraph that is only the first letters of the label
 * (`Spo`) is held back so the raw label never flashes; with it off, a marker
 * with nothing after it yields null (the server falls back to the whole reply
 * for an empty one, so there is nothing to draw).
 */

/** Fences masked out of the scan; both forms the server hides. */
const FENCE =
	/```[\s\S]*?(?:```|$)|(?:(?<=\n)|^)[ \t]{0,3}~~~[\s\S]*?(?:~~~|$)/g;
/** A blank line, however many follow: the end of a paragraph. */
const PARAGRAPH_BREAK = /\n[ \t\r]*\n(?:[ \t\r]*\n)*/g;
/**
 * The label. Group 1 is the opening emphasis so a wrapping `**Spoken: ...**` can
 * drop its closing marker. Four spaces would be an indented code block.
 */
const LABEL = /^ {0,3}(\*\*|__|\*|_)?spoken(?:\1)?[ \t]*:(?:\1)?[ \t]*/i;
/** What a label looks like before its colon has arrived, for the streaming hold. */
const LABEL_FORMS = ["spoken:", "**spoken:**", "__spoken:__"];
/** The shortest label prefix worth holding back; one letter is just prose. */
const HOLD_MIN_CHARS = 2;
const MASK = "\ue002";
const CRLF = /\r\n?/g;
const LEADING_SPACES = /^ {0,3}/;
const HAS_WORD = /spoken/i;

export type SpokenSplit = {
	/** The reply without the summary paragraph, ready for the markdown renderer. */
	body: string;
	/** The paragraph's words, label removed; empty while it has only just begun. */
	summary: string;
	/**
	 * Nothing follows the paragraph: it is the last thing written. While a reply
	 * streams this is the paragraph still being written.
	 */
	last: boolean;
};

type Paragraph = { start: number; stop: number };

function paragraphsOf(masked: string): Paragraph[] {
	const out: Paragraph[] = [];
	let start = 0;
	for (const match of masked.matchAll(PARAGRAPH_BREAK)) {
		out.push({ start, stop: match.index });
		start = match.index + match[0].length;
	}
	out.push({ start, stop: masked.length });
	return out;
}

/** True when `text` (trimmed on the left) is the start of a label, not yet whole. */
function isLabelPrefix(text: string): boolean {
	const lead = text.replace(LEADING_SPACES, "").toLowerCase();
	if (lead.length < HOLD_MIN_CHARS) return false;
	return LABEL_FORMS.some((form) => form.startsWith(lead) && lead !== form);
}

export function splitSpokenSummary(
	text: string,
	options: { streaming?: boolean } = {},
): SpokenSplit | null {
	// Most replies have no marker; settled text without the word skips the scan.
	if (!options.streaming && !HAS_WORD.test(text)) return null;
	const normalised = text.replace(CRLF, "\n");
	const masked = normalised.replace(FENCE, (m) => MASK.repeat(m.length));
	const paragraphs = paragraphsOf(masked);

	let found = -1;
	let label: RegExpMatchArray | null = null;
	paragraphs.forEach((paragraph, index) => {
		const match = masked.slice(paragraph.start, paragraph.stop).match(LABEL);
		if (match) {
			found = index;
			label = match;
		}
	});

	if (found < 0 || label === null) {
		if (!options.streaming) return null;
		const tail = paragraphs[paragraphs.length - 1];
		if (!tail || !isLabelPrefix(normalised.slice(tail.start, tail.stop)))
			return null;
		return {
			body: normalised.slice(0, tail.start).trimEnd(),
			summary: "",
			last: true,
		};
	}

	const matched: RegExpMatchArray = label;
	const first = paragraphs[found];
	let end = first.stop;
	let summary = normalised
		.slice(first.start + matched[0].length, first.stop)
		.trim();
	// A label on a line of its own takes the paragraph after it.
	if (summary === "" && found + 1 < paragraphs.length) {
		const next = paragraphs[found + 1];
		summary = normalised.slice(next.start, next.stop).trim();
		end = next.stop;
	}
	const opener = matched[1];
	if (
		opener &&
		(matched[0].split(opener).length - 1) % 2 === 1 &&
		summary.endsWith(opener)
	)
		summary = summary.slice(0, -opener.length).trimEnd();

	// `**Spoken:*` mid-stream: the closing emphasis is arriving, not words yet.
	if (
		options.streaming &&
		opener &&
		summary !== "" &&
		opener.startsWith(summary)
	)
		summary = "";
	if (summary === "" && !options.streaming) return null;

	const before = normalised.slice(0, first.start).trimEnd();
	const after = normalised.slice(end).trim();
	return {
		body: after ? (before ? `${before}\n\n${after}` : after) : before,
		summary,
		last: after === "",
	};
}
