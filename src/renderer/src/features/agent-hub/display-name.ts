/**
 * The display name a hub listing paints for a hub KEY.
 *
 * ## Why this exists at all
 *
 * The hub's public documents carry NO label field: a published team or agent is
 * addressed by a lowercase key (`data-quality`, `content-writer`,
 * `mathematician`) and `name` is the only spelling the wire has. Every listing
 * therefore DERIVES the human form, and one place owns that derivation so a team
 * cannot read two ways a tab apart.
 *
 * ## The derivation, copied from the core runtime
 *
 * `local_operator/display_labels.py` (`default_label`) splits the key on the
 * separators its grammar allows, up-cases each token's first character, and
 * keeps six common INITIALISMS upper-cased (`qa-tester` reading `Qa Tester` is
 * the defect that allowlist closes).
 *
 * ## The divergence from the core's composition, and why
 *
 * The core composes that derivation with a STORED label, and one of its arms
 * falls back to the raw key when the derived form differs from it only in case
 * (`mathematician` stays lowercase there). That arm exists to protect a LOCAL
 * row, whose key is the only spelling anybody ever chose and which has a label
 * field for the case a human does choose — inventing typography for it would be
 * noise.
 *
 * THE HUB HAS NO LABEL FIELD AT ALL, so the derived form IS the canonical
 * display: a lowercase `content` sitting between `Data Quality` and `Support
 * Desk` reads as a defect rather than as restraint, and there is no stored label
 * for a reader to have chosen instead. This surface therefore paints the derived
 * form for EVERY published key — teams and agents alike, which is why one helper
 * serves both — and keeps the KEY where the surface addresses it by name (the
 * pull's own reporting and the brief's header name the document the hub holds).
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
 * What every hub listing paints for one published key.
 *
 * The derived form, always — see the divergence note above; a key the hub has
 * never been given a label for has no other spelling to fall back to.
 */
export const hubDisplayName = (key: string): string =>
	deriveHubDisplayName(key);
