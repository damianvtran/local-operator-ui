/**
 * @file settings-search.fixtures.ts
 * @description
 * The queries the search STORIES claim return nothing.
 *
 * ## Why these are constants, and why they are asserted
 *
 * A no-result frame is a claim about the corpus: "these words match no setting".
 * The corpus is not fixed — round 1's choice-description folding grew the theme
 * row's searchable text from 571 to 3354 characters, and the long-query story's
 * sentence went from matching nothing to matching that row, so the frame's
 * caption became a caption the pixels did not carry (design round 2, D11).
 *
 * So the queries live here, one place, and are checked twice:
 *
 * - the STORY asserts its own query returns zero against the exact index it
 *   renders — with the page's real sidebar sections — and refuses to clear the
 *   shutter if it does not;
 * - `scripts/settings-search-index.test.mjs` asserts the same constants return
 *   zero against the registry fixture, so a corpus change fails in CI before a
 *   shoot is needed.
 *
 * The letters are deliberate: no token appears in any label, help sentence,
 * choice label or choice description in the fixture, and none is spellable as a
 * subsequence of the long help sentences (every token is three characters or
 * more, so the loose tier is genuinely exercised). `zzq` leads because a `z` is
 * absent from the whole registry payload.
 */

/** The short query the `NoResults` story renders. */
export const NO_MATCH_QUERY = "zzq wxv jjq vvz qqx";

/**
 * The long query the `LongQuery` story renders — long enough that its quoted
 * form must wrap inside a narrow column rather than widening the panel.
 */
export const LONG_NO_MATCH_QUERY =
	"zzq wxv jjq vvz qqx zzj wwx qqz vvx jjj uuu";
