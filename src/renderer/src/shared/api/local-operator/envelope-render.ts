/**
 * @file envelope-render.ts
 * @description The ONE renderer for backend-originated `{code, params, text}`
 * envelopes, per `docs/design/backend-originated-strings.md` §2, §3 and §6.
 *
 * WHY THIS EXISTS. The backend has emitted the structured envelope for a while;
 * this renderer read its `text` verbatim at two adapters (`desktopResult` and
 * `publicationProse`) and never consulted the catalogue. That made every
 * translation added to a `wire.*` identity inert on this surface, and it made
 * the client unable to tell the three states §6 defines. The rule is small and
 * deliberately not negotiable:
 *
 * 1. A KNOWN identity renders from the catalogue with `params` substituted —
 *    EVEN WHEN `text` is present. Preferring `text` would reproduce the exact
 *    defect inside its own fix, and would also mean a language switch could
 *    never re-render a message the server had already resolved.
 * 2. An UNKNOWN identity (a backend newer than this app) falls back to the
 *    envelope's own `text`/`message`. That sentence is the compatibility
 *    guarantee an older client runs on.
 * 3. A KNOWN identity whose params are malformed or missing produces the
 *    client's own generic error plus the identity for diagnostics. It does NOT
 *    fall back to `text`: the server's English sentence would make a genuine
 *    integration failure (a key/value mismatch across versions) look like a
 *    normal message, which is the failure §6 says must stay visible.
 *
 * WHAT IT MUST NEVER DO: change machine behaviour. The renderer returns a
 * sentence; every caller keeps its status, refusal code, retryability and
 * payload untouched. §6's last paragraph is binding — "No localization failure
 * may change HTTP status, approval outcome, retry policy, exit or job state."
 *
 * IDENTITY SELECTION. `message_code ?? code` (§3): `message_code` is the
 * optional render identity a producer adds when `code` had to carry a machine
 * category (`runtime_busy`) instead of a catalogue key. Reading it here is the
 * client half of the contract; PRODUCING it is a separate core change, so no
 * code in this repository adds it.
 *
 * FALLBACK CHAIN, stated because the doc and code must not disagree (§6).
 * `messageFor` answers in this order: the served catalogue for the ACTIVE
 * locale, the bundled catalogue for that locale, then the BUNDLED English
 * source. A registered English catalogue is deliberately NOT consulted for a
 * non-English locale: the served `en` namespace is not a compatibility lane,
 * and making it one would let the words depend on which catalogues a cache
 * happened to fetch. For a `wire.*` identity the effective fallback is
 * therefore the envelope's own `text`, which is the backend's English source
 * with its params already substituted — the same sentence the bundled English
 * would carry, from the process that owns it. That is why this path is
 * equivalent without a second lookup; the alternative (consulting any
 * registered `en` map) is rejected above.
 */

/*
 * Relative, not the `@shared/i18n` alias: this module is pulled into the
 * transport bundle that dozens of `scripts/*.test.mjs` build with their own
 * esbuild alias maps, and not every harness declares that alias. The core has
 * no DOM dependency, so reaching it directly is safe here (the same depth as
 * `desktop-api.ts`'s contract imports).
 */
import { currentLocale, renderMessage, translate } from "../../../../../i18n";

/** Where the sentence a reader sees came from. Read by tests and diagnostics. */
export type EnvelopeSink = "catalogue" | "wire-text" | "generic";

export type RenderedEnvelope = {
	/** The sentence to display — never a raw key and never a placeholder. */
	text: string;
	/** Which rule in the module docblock produced `text`. */
	via: EnvelopeSink;
	/** The identity that was tried, when the payload carried one. Diagnostics. */
	identity?: string;
	/** Why the generic error replaced a known identity. */
	diagnostic?: "malformed-params";
};

/**
 * The generic error shown when a KNOWN identity cannot be formatted.
 *
 * Reuses the client's existing calm failure statement rather than adding copy:
 * this branch means "the backend and this app disagree about a message", not
 * "the operation failed", and inventing a second sentence here would make that
 * distinction read as two different severities. The identity travels beside it
 * in `RenderedEnvelope.identity` for diagnostics; §6 forbids displaying the raw
 * key when any prose exists, so it is not appended to the sentence.
 */
const GENERIC_MESSAGE = "ui.common.errors.error_boundary.something_went_wrong";

function objectDetail(detail: unknown): Record<string, unknown> | null {
	if (typeof detail !== "object" || detail === null || Array.isArray(detail))
		return null;
	return detail as Record<string, unknown>;
}

/** A non-blank string, or `null`. */
function sentence(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * `params` as the named-scalar record ICU expects.
 *
 * Anything that is not a plain object is an empty record, so a missing or
 * corrupt `params` reaches the formatter as "no arguments": a message that
 * needs one then throws, which is the malformed branch. `renderMessage` rejects
 * non-scalar VALUES (an object param would otherwise paint `[object Object]`).
 */
function paramsOf(value: unknown): Record<string, unknown> {
	const object = objectDetail(value);
	return object ?? {};
}

/**
 * Render one envelope's human sentence, or `null` when the payload carries
 * neither a renderable identity nor any usable text.
 *
 * `null` is deliberate and means exactly that: the two adapters each own a
 * different, already-established fallback for the state
 * (`DESKTOP_REFUSAL_PLACEHOLDER`, `"The agent could not be published."`, a bare
 * `detail` string), and reproducing those here would give the app two
 * authorities for the same fact (§6's last row: "existing client-owned generic
 * error/status"). The generic `via` is returned only for a KNOWN identity that
 * cannot be formatted, where §6 requires the client's own error rather than
 * falling through to the wire text — so both branches of this function agree
 * with this comment.
 *
 * The locale is resolved at CALL time: an envelope is rendered where it is
 * consumed, so a language switch takes effect for the next refusal without the
 * producer ever re-sending anything.
 */
export function renderEnvelopeDetail(
	detail: unknown,
	locale: string = currentLocale(),
): RenderedEnvelope | null {
	/*
	 * Three detail shapes have crossed this wire (see `desktopResult`): a bare
	 * string (oldest), `{message}` (older object), and the i18n envelope
	 * `{code, params, text}` (RFC §2.6). Only the object shapes can carry an
	 * identity; a bare string is always wire text.
	 */
	const object = objectDetail(detail);
	const wireText =
		sentence(object?.text) ?? sentence(object?.message) ?? sentence(detail);
	const identity = sentence(object?.message_code) ?? sentence(object?.code);
	if (!identity) {
		return wireText ? { text: wireText, via: "wire-text" } : null;
	}

	const rendered = renderMessage(identity, paramsOf(object?.params), locale);
	if (rendered.status === "rendered") {
		return { text: rendered.text, via: "catalogue", identity };
	}
	if (rendered.status === "unknown") {
		/*
		 * A newer backend's identity. Its own `text` is the compatibility lane;
		 * when it supplied none there is nothing to show and the CALLER's existing
		 * generic/status fallback takes over (`null`), not a new sentence from here.
		 */
		return wireText ? { text: wireText, via: "wire-text", identity } : null;
	}
	/*
	 * Known identity, unrenderable params. The diagnostic is emitted rather
	 * than the English fallback so the mismatch is not silently hidden (§6).
	 * It is a catalogue key, never user data, so it is safe to log.
	 */
	console.warn(
		`[i18n] envelope identity "${identity}" could not be formatted; showing the client's generic error.`,
	);
	return {
		text: genericMessage(locale),
		via: "generic",
		identity,
		diagnostic: "malformed-params",
	};
}

function genericMessage(locale: string): string {
	return translate(GENERIC_MESSAGE, {}, locale);
}
