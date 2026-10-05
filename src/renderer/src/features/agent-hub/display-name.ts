/**
 * The display name a hub listing paints for a hub KEY.
 *
 * ## Why this exists at all
 *
 * The hub's public documents carry NO label field: a published team or agent is
 * addressed by a lowercase key (`data-quality`, `content-writer`,
 * `mathematician`) and `name` is the only spelling the wire has. The core
 * runtime has a richer story for its LOCAL rows — a stored `label` beside the
 * key — and a listing that painted the raw key would be the app disagreeing
 * with the CLI about what the same document is called.
 *
 * ## The rule, and where it is copied from
 *
 * `local_operator/display_labels.py` (`default_label`) derives the human form
 * from the key: split on the separators the key grammar allows, up-case each
 * token's first character, and keep six common INITIALISMS upper-cased
 * (`qa-tester` reading `Qa Tester` is the defect that allowlist closes).
 * `local_operator/teams.py` (`display_form`) then composes that derived form
 * with the key, and its arms are the ones mirrored here:
 *
 * - the derived form casefolds to the key -> the RAW KEY. Title case no human
 *   chose is noise (`mathematician` stays `mathematician`);
 * - otherwise -> the derived form, because the separator is information the
 *   key cannot carry (`data-quality` reads `Data Quality`).
 *
 * The runtime's AGENT arm deliberately differs (it prefers a canonical
 * single-token label so `aida` paints `Aida`); that arm needs a STORED label,
 * which the hub does not send, so the TEAMS composition is the one that
 * applies to every hub row. Mirroring it keeps one spelling across the
 * product rather than inventing a second one in the desktop.
 *
 * `toLowerCase` rather than Python's `casefold`: the keys are ASCII slugs by
 * construction (the runtime's own name grammar), where the two agree.
 */

/**
 * Tokens whose display form is upper-case rather than Title Case.
 *
 * Copied from `display_labels.DEFAULT_LABEL_INITIALISMS`, and it stays small
 * for that module's own reason: every entry is a bet on how a token reads, and
 * Title Case remains the rule.
 */
const INITIALISMS = new Set(["qa", "ai", "api", "tui", "ux", "ui"]);

/** The separators the runtime's name grammar allows between tokens. */
const TOKEN_SEPARATORS = /[._-]+/;

/**
 * The derived default for a key: `data-quality` -> `Data Quality`.
 *
 * Exported for the tests that pin it token for token against the runtime's
 * module; callers want {@link hubDisplayName}.
 */
export const deriveHubDisplayName = (key: string): string =>
	key
		.split(TOKEN_SEPARATORS)
		.filter(Boolean)
		.map((token) =>
			INITIALISMS.has(token.toLowerCase())
				? token.toUpperCase()
				: token.charAt(0).toUpperCase() + token.slice(1),
		)
		.join(" ");

/**
 * What a hub listing paints for one key.
 *
 * The teams composition (`display_form`'s arms with the derived label): a
 * derived form that differs from the key only in case is dropped in favour of
 * the key, and a derived form that differs by more is the name.
 */
export const hubDisplayName = (key: string): string => {
	const derived = deriveHubDisplayName(key);
	return derived.toLowerCase() === key.toLowerCase() ? key : derived;
};
