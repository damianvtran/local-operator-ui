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
 *
 * ## What "by name" means, because it is narrower than it looks
 *
 * The raw key survives in exactly two places: text a reader is meant to match
 * against the HUB's own spelling, and the ROSTER SLOTS a team's document stores
 * (`qa-tester`, `manager`) — a slot is a role the team composition names, and
 * the hub's own team pages spell those raw, so deriving them here would invent a
 * convention the catalogue does not have. It does NOT survive in the prose about
 * a NAME — an alert, a confirmation or a button's accessible name paints the
 * derived form, or one row reads two ways on one screen (design round 1 asked
 * for this explicitly; agent review round 1, m4). What is NOT such a site is the
 * PULL's own reporting: `team-pull-report.ts` and the download mutation quote the
 * name the local registry STORED, which is the hub's own spelling and the thing a
 * reader may need to match against `lop teams list` (agent review round 2, m2
 * added the boundary, after this paragraph claimed the toasts too).
 */

/**
 * Tokens whose display form is upper-case rather than Title Case.
 *
 * Copied from `display_labels.DEFAULT_LABEL_INITIALISMS`, and it stays small
 * for that module's own reason: every entry is a bet on how a token reads, and
 * Title Case remains the rule.
 */
const INITIALISMS = new Set(["qa", "ai", "api", "tui", "ux", "ui"]);

/**
 * The separators the runtime's name grammar allows between tokens.
 *
 * The core matches these with `str.casefold()` where this uses
 * `toLowerCase()`; the two agree on every ASCII key the hub can publish and
 * diverge only outside it (`straße` casefolds to `strasse`), which is recorded
 * rather than papered over because this module's whole value is being the SAME
 * rule as the runtime's (agent review round 1, n1).
 */
const TOKEN_SEPARATORS = /[._-]+/;

/**
 * A key or a query folded to the shape {@link hubDisplayName} produces.
 *
 * One spelling for searching: the display form separates tokens with spaces, so
 * a reader pasting the hub's own `data-quality` has to find it — normalising the
 * QUERY (rather than matching twice, once per spelling) is what lets the filter
 * read as one rule (agent review round 1, n2).
 */
export const normalizeHubKey = (text: string): string =>
	text.toLowerCase().replace(TOKEN_SEPARATORS, " ");

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
