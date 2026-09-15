/**
 * The empty-chat suggestion pool, and how a sample is drawn from it.
 *
 * ## What the pool is
 *
 * Eight requests the USER makes to the agent, each naming something THIS
 * product does — not the generic assistant errands (trending stocks, MNIST,
 * space invaders) that used to sit here. The one surface with no conversation
 * to be specific about is exactly the one where the copy has to be specific,
 * so every entry is a promise the app can keep; the verification citation for
 * each lives in the PR that introduced this pool.
 *
 * ## Why the first four are pinned and the rest sampled
 *
 * A new chat shows {@link MAX_SUGGESTIONS} of them. That sample is drawn when
 * the empty chat mounts, not on a timer, so nothing under the user's eye ever
 * changes while they read it.
 *
 * The FIRST sample of a session is the pool's own head rather than a random
 * draw, and that is the TUI's device (`tui/widgets/welcome.py:359-360`,
 * `:1468-1549`): the opening frame is deterministic and only later mounts
 * sample. Two things fall out of it that are worth more than the variety it
 * costs — the first empty chat of a session is the same screen for every user
 * and for every committed frame, and a screenshot of it is reproducible
 * instead of a different four labels each run.
 *
 * ## Why the sample is a real shuffle
 *
 * The pool shipped as `[...pool].sort(() => Math.random() - 0.5)`, which is not
 * a shuffle: a comparator that ignores its arguments gives each comparison a
 * coin flip, so the result is biased toward the input order and can differ
 * between engines. It is also untestable, because the permutation depends on
 * how many times the comparator happens to be called. Fisher-Yates is uniform
 * and takes its randomness from one injectable function, which is what lets
 * the unit test assert a permutation over a seeded source rather than assert
 * "some array came back".
 *
 * ## Length budget
 *
 * The labels are read on one line at the pool's first four (§ the design
 * record's `docs/design/composer-suggestions.md`, § 8.1): two rows is the
 * ceiling at the narrowest column the row renders in (550px), and a sample
 * that ever took three would mean the copy is too long — not that the count or
 * the padding should shrink.
 */

export const DEFAULT_MESSAGE_SUGGESTIONS: readonly string[] = [
	"Set up the Linear MCP server for me",
	"Set up the mobile relay and tunnel",
	"Create a team of agents",
	"Create a new agent",
	"Schedule a task that runs every morning",
	"Wake me tomorrow morning with a summary",
	"Show me what the agent did last turn",
	"Review this repo and open a pull request",
];

/**
 * How many of the pool an empty chat shows.
 *
 * Four rather than the seven this replaced: a chip's cost was never its width
 * but its boundary, and with the boundary gone what is left is HEIGHT. Four
 * chips are one or two lines at every window size and read as examples; seven
 * is a menu with a most-likely-answer problem.
 */
export const MAX_SUGGESTIONS = 4;

/**
 * Fisher-Yates, front to back, over a copy.
 *
 * `random` is a parameter rather than `Math.random` inline so the order is
 * reproducible under a seeded source — see the module comment.
 */
const shuffled = (items: readonly string[], random: () => number): string[] => {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
};

/**
 * Which `count` labels a later sample shows: a uniform draw from the whole
 * pool, in shuffled order so the visible order is not the pool's.
 *
 * A pool no larger than the sample is returned whole and untouched, which is
 * the behaviour the seven-chip version had for its short pools.
 */
export const pickSuggestions = (
	pool: readonly string[],
	count: number = MAX_SUGGESTIONS,
	random: () => number = Math.random,
): string[] => {
	if (pool.length <= count) return [...pool];
	return shuffled(pool, random).slice(0, count);
};

/**
 * Whether this session has already drawn its opening sample.
 *
 * A plain object rather than a module-level `let` so the state can be handed
 * in: the unit test supplies its own, and production takes the singleton
 * below. Module scope is what makes it once per APP RUN — the renderer process
 * is the session.
 */
export type SuggestionSampleState = { opening: boolean };

/** The renderer's own state. One module instance, one app run. */
export const sessionSuggestionSample: SuggestionSampleState = {
	opening: true,
};

/**
 * The sample for one empty-chat mount.
 *
 * The first call of a session returns the pool's head; every later call is a
 * {@link pickSuggestions} draw. `state` is defaulted so callers say only what
 * they mean, and passed explicitly by the test that has to pin both halves.
 *
 * CONSUMED DURING RENDER, deliberately, by the caller's `useMemo`. A React
 * render is supposed to be pure, so this is the one place in the change where
 * that rule is bent, and the alternative was worse: deciding the opening sample
 * in an effect means the first painted commit is a random draw that is then
 * replaced, which is exactly the non-reproducible opening frame this pin
 * exists to remove. The consequence is confined to a DEVELOPMENT build with
 * `<StrictMode>` (which double-invokes a render, and so consumes the pin one
 * render early); the shipped build is a production build, where StrictMode does
 * not double-invoke, and the Electron app's own StrictMode wrapper is therefore
 * unaffected. Storybook does not wrap in StrictMode at all, which is what keeps
 * a committed frame of this surface reproducible.
 */
export const sampleSuggestions = (
	pool: readonly string[],
	count: number = MAX_SUGGESTIONS,
	random: () => number = Math.random,
	state: SuggestionSampleState = sessionSuggestionSample,
): string[] => {
	if (pool.length === 0) return [];
	if (pool.length <= count) return [...pool];
	if (!state.opening) return pickSuggestions(pool, count, random);
	state.opening = false;
	return pool.slice(0, count);
};
