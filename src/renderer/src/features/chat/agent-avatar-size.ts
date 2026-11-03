/**
 * How large the agent's picture is drawn in the chat window: the reader's
 * choice, the default, and the one place a stored value is judged.
 *
 * AN APP-LEVEL PREFERENCE, NOT AN AGENT'S. The size is how this reader likes
 * their transcript to look, so it lives in Settings > Appearance beside the
 * transcript display mode and follows the same pattern
 * (`transcript-display-mode.ts`): `localStorage` is not the setter's path out -
 * zustand rehydrates PAST the setters, so a token written by an older build, by
 * hand, or by a build that renamed one arrives unvalidated, and
 * `parseAgentAvatarSize` is the single judge.
 *
 * THE DEFAULT IS TODAY'S SIZE. `small` is the 20px the turn head and the chat
 * header already draw, so a reader who never opens the setting sees no change.
 *
 * TWO SURFACES, TWO TABLES. The setting names a step, and each surface maps it
 * to the pixels it can hold:
 *
 *   - the TURN HEAD sits on a line of its own above the first line of a turn,
 *     so it can grow freely - the cost is vertical, and the transcript's height
 *     estimate reads the same table (`turnMarkHeight`);
 *   - the HEADER is a 40px bar (`min-h-10`) shared with the sidebar's brand row
 *     (they sit on one line), so its largest step is 32px: 4px of air above and
 *     below, and the bar never grows.
 *
 * The class strings are literal because Tailwind finds a class by scanning the
 * source; `size-${n}` built at runtime would never be generated. The unit test
 * asserts every class spells the pixels beside it.
 *
 * THE SIDEBAR ROWS AND THE SESSION ROW ARE NOT HERE: they are 16px in a fixed
 * 32px row, and a row that grows with a preference would move every row under
 * the pointer. The setting is the chat window's.
 */

/** The three steps the control offers. */
export type AgentAvatarSize = "small" | "medium" | "large";

/** Today's size, and the fallback for anything else. */
export const DEFAULT_AGENT_AVATAR_SIZE: AgentAvatarSize = "small";

/** Every step in the order the control draws them. */
export const AGENT_AVATAR_SIZE_OPTIONS: readonly AgentAvatarSize[] = [
	"small",
	"medium",
	"large",
];

/** One surface's pixels and the Tailwind class that draws them. */
export type AvatarBox = {
	px: number;
	className: string;
	glyphClassName: string;
	/**
	 * Extra classes for a DOOR on this box. The 20px mark is under the 24px target
	 * floor, so its link grows an invisible 2px margin on every side (a
	 * pseudo-element, so no layout box moves); the larger steps already clear it.
	 */
	hitClassName: string;
};

/** The 2px halo that lifts a 20px door to a 24px target. Literal for Tailwind. */
const HIT_HALO = "before:absolute before:-inset-0.5 before:content-['']";

/** The header's box also names the height of the title line that holds it. */
export type HeaderAvatarBox = AvatarBox & { rowClassName: string };

/** The turn head's box per step. */
export const TURN_AVATAR_BOX: Record<AgentAvatarSize, AvatarBox> = {
	small: {
		px: 20,
		className: "size-5",
		glyphClassName: "size-2.5",
		hitClassName: HIT_HALO,
	},
	medium: {
		px: 28,
		className: "size-7",
		glyphClassName: "size-3.5",
		hitClassName: "",
	},
	large: {
		px: 36,
		className: "size-9",
		glyphClassName: "size-4",
		hitClassName: "",
	},
};

/**
 * The gap under the turn-head mark per step, in px, with the class that draws
 * it (D5). A fixed 4px under a 36px face reads as a mark stuck to its line, so
 * the air grows with the box. One table: the component's class and the
 * transcript's height estimate both read it. Literal classes for Tailwind.
 */
export const TURN_AVATAR_GAP: Record<
	AgentAvatarSize,
	{ px: number; className: string }
> = {
	small: { px: 4, className: "mb-1" },
	medium: { px: 6, className: "mb-1.5" },
	large: { px: 8, className: "mb-2" },
};

/** The header's box per step; capped at 32 so the 40px bar does not grow. */
export const HEADER_AVATAR_BOX: Record<AgentAvatarSize, HeaderAvatarBox> = {
	small: {
		px: 20,
		className: "size-5",
		glyphClassName: "size-2.5",
		hitClassName: HIT_HALO,
		rowClassName: "h-5",
	},
	medium: {
		px: 24,
		className: "size-6",
		glyphClassName: "size-3",
		hitClassName: "",
		rowClassName: "h-6",
	},
	large: {
		px: 32,
		className: "size-8",
		glyphClassName: "size-4",
		hitClassName: "",
		rowClassName: "h-8",
	},
};

/**
 * Judge a stored or hand-built value, answering the default for anything that is
 * not a step this build knows. Unknown is the default, deliberately, for the
 * reason `parseTranscriptDisplayMode` states: a renamed token or a tampered blob
 * must land on the shipped look rather than on an error.
 */
export function parseAgentAvatarSize(value: unknown): AgentAvatarSize {
	for (const option of AGENT_AVATAR_SIZE_OPTIONS) {
		if (value === option) return option;
	}
	return DEFAULT_AGENT_AVATAR_SIZE;
}

/**
 * The height the turn-head mark adds to the entry it opens, in px - the box
 * plus the gap under it. The transcript's DOM window estimates an entry it has
 * not mounted from this, so the estimate follows the setting.
 */
export function turnMarkHeight(size: AgentAvatarSize): number {
	return TURN_AVATAR_BOX[size].px + TURN_AVATAR_GAP[size].px;
}
