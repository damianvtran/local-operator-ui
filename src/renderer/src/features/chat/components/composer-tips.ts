/**
 * The composer's rotating tip pool, and the order a mount turns through.
 *
 * The desktop port of the TUI's welcome-row tips
 * (`~/local-operator/local_operator/tui/widgets/welcome.py`), which is the
 * nearest precedent in this product: one dim line under the composer that
 * names something the app can do. This module records the four properties the
 * TUI's own comments argue for, because every one of them is a decision a
 * later editor would otherwise make differently.
 *
 * ## 1. Twelve seconds
 *
 * `TIP_ROTATE_INTERVAL_S = 12.0` (`welcome.py:471`), unchanged and for the
 * same stated reasons: under about eight seconds the line turns while it is
 * still being read, and — worse — "a text change inside the peripheral field
 * pulls focus off the input the user is typing into"; over about fifteen
 * seconds a short session only ever meets the first entry, which makes the
 * pool pointless. Twelve splits that band.
 *
 * The desktop adds one departure, and it is deliberate rather than a drift:
 * the clock is SUSPENDED while the composer holds a non-empty draft. The TUI's
 * worry applies with more force here — this composer is where the user is
 * writing a prompt rather than running a command — so a row that changed under
 * a half-written sentence would be pulling at the exact thing the TUI's rule
 * exists to protect.
 *
 * ## 2. Presence is a function of width alone
 *
 * Never of the current entry's length (`welcome.py:491-495`): the row renders
 * for the whole pool or not at all, at the same threshold the prompt itself
 * uses. The alternative — a per-entry length test — makes the row appear and
 * vanish as the reel turns, which moves everything below it on every tick. The
 * row is a fixed 20px line for the same reason.
 *
 * ## 3. It is not a control
 *
 * No click handler, no hover ground, no tooltip, no `aria-live` and no
 * `role="status"`. It is ambient: it makes no claim about the turn and there
 * is nothing to answer. Asking assistive technology to announce it would
 * instead spam a reader with a sentence every rotation. If the row ever
 * acquires an affordance it has stopped being ambient, and it has entered the
 * accent budget as a fourth spend.
 *
 * ## 4. It carries no glyph of its own
 *
 * The TUI's mark is the app's own `info` glyph, not the word `tip:`
 * (`welcome.py:453-457`: a word "would cost five cells of the sentence to
 * label a line whose tone already says what it is"). The desktop borrows the
 * same idea from its own icon set — a lucide `Info` at 12px, the size the
 * icon ramp permits at `ink-dim` — rather than inventing a mark. The sentence
 * is prose, so it takes no monospace and no markup.
 *
 * ## The ring, and its opening frame
 *
 * The order opens on `pool[0]` and only then resumes at a random point in the
 * ring, exactly as the TUI does (`welcome.py:359-360`, `:1468-1549`). The
 * pinned opening frame is what makes a committed screenshot reproducible, and
 * it is the frame every capture of this surface therefore shows.
 *
 * Advancing one step per tick around a permutation cannot repeat the previous
 * entry — including across the wrap — because every entry is distinct and the
 * ring holds each of them exactly once. That guarantee therefore rests on this
 * pool's labels being distinct, which the module's own unit test asserts.
 */

export const COMPOSER_TIPS: readonly string[] = [
	"the chat list search finds sessions from months ago",
	"a team runs one request through several agents",
	"type /approvals to set whether tools ask first",
	"ask for parallel work and the agent fans out subagents",
	"the run panel shows the plan and its subagents",
	"the paperclip attaches a file, or paste one in",
	"settings connects MCP servers",
	"the canvas keeps a long document beside the chat",
	"schedules run a prompt on a timer",
	"ask for the mobile relay to drive this session from your phone",
];

/** Seconds one tip is held before the next takes its place. See the module comment. */
export const TIP_ROTATE_INTERVAL_S = 12;

/** The same interval as the timer reads it. */
export const TIP_ROTATE_INTERVAL_MS = TIP_ROTATE_INTERVAL_S * 1000;

/**
 * The order one mount turns through: `pool[0]` first, then the rest shuffled.
 *
 * Cold, this is the TUI's device — the opening frame is pinned and only the
 * frames behind it are random. A caller that wants the frame it is about to
 * capture to be reproducible should not seed anything; not seeding IS the
 * pinned opening frame, because the first entry is not drawn from the shuffle
 * at all.
 */
export const tipRotationOrder = (
	pool: readonly string[],
	random: () => number = Math.random,
): string[] => {
	if (pool.length <= 1) return [...pool];
	const rest = [...pool.slice(1)];
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return [pool[0], ...rest];
};

/** The entry at `index`, wrapping. `pool[index % pool.length]` named, for the component. */
export const tipAt = (pool: readonly string[], index: number): string =>
	pool[index % pool.length];

/** The next index around the ring. One step, so a repeat can only be the wrap. */
export const advanceTipIndex = (index: number, length: number): number =>
	length === 0 ? 0 : (index + 1) % length;
