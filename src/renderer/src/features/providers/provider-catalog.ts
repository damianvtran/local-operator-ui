/**
 * @file provider-catalog.ts
 * @description
 * How a census row is PRESENTED: its brand, its method in plain words, its
 * monogram, which group it belongs to, and which rows count as connected.
 *
 * ## Why these are derived here rather than read off the wire
 *
 * The census names rows by their registry METHOD label ("xAI (Grok API key)",
 * "Anthropic (Claude Pro/Max)"), which is right for a terminal picker and wrong
 * for a list of brands: the settings page printed "Z.AI (GLM API key)" above a
 * "Sign in or API key" chip (design D3, UX U4). The design asks for a backend
 * `brand`/`label` pair (P1, backend-owned); until a backend sends one, the
 * brand is the registry name with its parenthetical removed, which is exactly
 * how every row is spelled today. When the backend field lands, `brandOf` is
 * the one place that starts preferring it.
 *
 * Pure functions only, so `scripts/provider-catalog.test.mjs` can pin them in
 * Node without a DOM.
 */

import type {
	DesktopProvider,
	ProviderMethod,
} from "@shared/api/local-operator/desktop-api";

/*
 * The patterns this module matches, hoisted so each is compiled once rather
 * than on every row render.
 */
const TRAILING_PARENTHETICAL = /\s*\([^)]*\)\s*$/;
const PARENTHETICAL_BODY = /\(([^)]+)\)\s*$/;
const NON_ALPHANUMERIC = /[^A-Za-z0-9]+/;
const UPPERCASE_LETTER = /[A-Z]/;
/** The older backend's device instruction, `Enter code: ABCD-EFGH`. */
const DEVICE_CODE_SENTENCE = /Enter code:\s*([A-Za-z0-9-]+)/;
const WWW_PREFIX = /^www\./;

/** The provider this app recommends to someone with nothing connected. */
export const RECOMMENDED_PROVIDER_ID = "radient";

/**
 * The rows onboarding shows before "More providers": the recommendation, the
 * two subscriptions most people already pay for, and one key provider so the
 * key route is visible without expanding anything (design § 5).
 */
export const FEATURED_PROVIDER_IDS = [
	"radient",
	"anthropic",
	"openai",
	"deepseek",
] as const;

/** "Anthropic (Claude Pro/Max)" -> "Anthropic"; a name without one is kept. */
export function brandOf(provider: {
	name: string;
	id?: string;
}): string {
	// A registry entry whose display name carries the PLAN rather than the brand
	// ("QwenCloud Token Plan"): the plan is the method, and this string is used
	// as a brand in the list, the tabs and the success sentence.
	const override = provider.id ? BRAND_OVERRIDES[provider.id] : undefined;
	if (override) return override;
	const stripped = provider.name.replace(TRAILING_PARENTHETICAL, "").trim();
	return stripped || provider.name;
}

/**
 * Brands whose registry display name is not the brand alone, keyed by id.
 *
 * One entry, and it is not cosmetic: "QwenCloud Token Plan" as a brand produced
 * "Sign in with your QwenCloud Token Plan account" and a tile reading "QT"
 * beside a tab that also says "Token Plan".
 */
const BRAND_OVERRIDES: Record<string, string> = {
	"alibaba-token-plan": "QwenCloud",
};

/** The parenthetical of a registry label, when it has one. */
function qualifierOf(label: string): string | null {
	const match = PARENTHETICAL_BODY.exec(label);
	return match ? match[1].trim() : null;
}

/**
 * Method names in the user's words, for the methods whose registry label is a
 * mechanism. Keyed by `method_id`, which the backend guarantees is stable.
 * Anything absent falls back to the label's own qualifier, then to the kind.
 */
const METHOD_NAMES: Record<string, string> = {
	anthropic: "Claude subscription",
	openai: "ChatGPT subscription",
	"openai-device": "ChatGPT, with a code",
	radient: "Browser sign-in",
	kimi: "Moonshot account",
	"xai-oauth": "SuperGrok account",
	"zai-oauth": "Browser sign-in",
	"alibaba-token-plan-oauth": "Token Plan account",
};

/**
 * One method's tab label. Never repeats the provider's name, so the tab and the
 * primary button below it can never share an accessible name (design D4).
 */
export function methodName(method: ProviderMethod): string {
	if (method.kind === "api_key") return "API key";
	const named = METHOD_NAMES[method.method_id];
	if (named) return named;
	const qualifier = qualifierOf(method.label);
	if (qualifier) return qualifier;
	return method.kind === "device" ? "Sign in with a code" : "Sign in";
}

/**
 * The one sentence under the primary action, saying what the method uses.
 * The browser's destination is appended by the caller once `auth_url` is
 * known, because naming a domain before the backend has chosen one is a guess.
 */
/*
 * One line per method, and the SUBSCRIPTION half of the app now says what it
 * costs relative to the other half. The two choices this panel offers are two
 * different billings - a plan the user already pays for, or a key billed per use
 * - and only the plan side was described at all: a reader could not tell whether
 * adding a key charged them again (UX round 1 U8).
 */
const METHOD_BLURBS: Record<string, string> = {
	anthropic: "Use your Claude Pro or Max plan. No extra charge.",
	openai: "Use your ChatGPT Plus or Pro plan. No extra charge.",
	"openai-device":
		"Use your ChatGPT plan, signing in with a one-time code. No extra charge.",
	radient: "One browser sign-in. Nothing to paste.",
};

export function methodBlurb(
	method: ProviderMethod,
	provider: { name: string },
): string {
	const blurb = METHOD_BLURBS[method.method_id];
	if (blurb) return blurb;
	if (method.kind === "device")
		return `Sign in to your ${brandOf(provider)} account with a one-time code.`;
	return `Sign in with your ${brandOf(provider)} account.`;
}

/** Two letters for the row's tile: word initials, inner capitals, or a prefix. */
export function monogramOf(brand: string): string {
	const words = brand.split(NON_ALPHANUMERIC).filter(Boolean);
	if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
	const word = words[0] ?? brand;
	const inner = UPPERCASE_LETTER.exec(word.slice(1));
	if (inner) return `${word[0]}${inner[0]}`.toUpperCase();
	/*
	 * TWO uppercase letters, one rule for the whole tile row: the fallback used to
	 * keep the second letter lower-case, so the tiles read "Ol" (Ollama), "Go",
	 * "Ra" beside "OA", "DS", "XA" - and in the tile's face Ollama's "Ol" is
	 * indistinguishable from "OI" (design round 1 D8).
	 */
	return `${word[0]?.toUpperCase() ?? ""}${word[1]?.toUpperCase() ?? ""}`;
}

/** The three ways to get model access, in the order the page lists them. */
export type ProviderGroup = "subscription" | "key" | "local";

export const GROUP_HEADINGS: Record<ProviderGroup, string> = {
	subscription: "Use a subscription",
	key: "Use an API key",
	local: "Run models on this computer",
};

export function providerGroup(provider: DesktopProvider): ProviderGroup {
	if (provider.local) return "local";
	const signIn = provider.auth_methods.some(
		(method) => method.kind === "browser" || method.kind === "device",
	);
	return signIn ? "subscription" : "key";
}

/** The row's one action, named for what it does. */
export function rowActionLabel(provider: DesktopProvider): string {
	const group = providerGroup(provider);
	if (group === "local") return "Set up";
	if (group === "key") return "Add key";
	return "Sign in";
}

/** The row's meta line in the Add block: the method in plain words. */
export function addRowMeta(provider: DesktopProvider): string {
	const group = providerGroup(provider);
	if (group === "local") return `Needs ${brandOf(provider)} running`;
	if (group === "key") return "Paste an API key";
	return `Sign in with your ${accountNameOf(provider)} account`;
}

/**
 * The account a subscription sign-in uses, when the provider's own brand is not
 * what the user sees on the provider's page.
 *
 * A per-provider name rather than the method TAB label, because the two answer
 * different questions: the tab has to be unique inside its chooser ("Browser
 * sign-in" beside "API key"), while this sentence names the account the reader
 * has -- and "Sign in with your Browser sign-in account" is what reading the
 * tab produced (design round 1 of this implementation).
 */
const ACCOUNT_NAMES: Record<string, string> = {
	anthropic: "Claude",
	openai: "ChatGPT",
	kimi: "Moonshot",
	xai: "SuperGrok",
	"xai-oauth": "SuperGrok",
	zai: "Z.AI",
	radient: "Radient",
	"alibaba-token-plan": "QwenCloud",
};

/** The account name for a provider, falling back to its brand. */
export function accountNameOf(provider: DesktopProvider): string {
	return ACCOUNT_NAMES[provider.id] ?? brandOf(provider);
}

/**
 * Whether a row belongs in the Connected block.
 *
 * A cloud row is connected when it has a credential (the census's own facts,
 * the same predicate `hasConnectedProvider` uses). A local row has no
 * credential to have, and this list does not probe servers on render, so a
 * local runtime is listed as connected only when it is the configured
 * default -- the one local fact this page already holds without a network
 * round trip.
 */
export function isConnectedRow(
	provider: DesktopProvider,
	defaultHosting: string | null,
): boolean {
	if (provider.local || provider.credential_optional)
		return defaultHosting !== null && provider.id === defaultHosting;
	return provider.has_credential || provider.configured;
}

/** Connected rows: the default first, then alphabetical by brand. */
export function connectedRows(
	rows: DesktopProvider[],
	defaultHosting: string | null,
): DesktopProvider[] {
	return rows
		.filter((provider) => isConnectedRow(provider, defaultHosting))
		.sort((a, b) => {
			if (a.id === defaultHosting) return -1;
			if (b.id === defaultHosting) return 1;
			return brandOf(a).localeCompare(brandOf(b));
		});
}

/** Rows not yet connected, grouped; the recommendation leads its group. */
export function addRowsByGroup(
	rows: DesktopProvider[],
	defaultHosting: string | null,
	query = "",
): Record<ProviderGroup, DesktopProvider[]> {
	const needle = query.trim().toLowerCase();
	const groups: Record<ProviderGroup, DesktopProvider[]> = {
		subscription: [],
		key: [],
		local: [],
	};
	for (const provider of rows) {
		if (isConnectedRow(provider, defaultHosting)) continue;
		if (
			needle &&
			![provider.name, provider.id, ...provider.search_aliases]
				.join(" ")
				.toLowerCase()
				.includes(needle)
		)
			continue;
		groups[providerGroup(provider)].push(provider);
	}
	const lead = groups.subscription.findIndex(
		(provider) => provider.id === RECOMMENDED_PROVIDER_ID,
	);
	if (lead > 0) {
		const [row] = groups.subscription.splice(lead, 1);
		groups.subscription.unshift(row);
	}
	return groups;
}

/** The connected row's meta line: how it is connected, then its model. */
export function connectedRowMeta(
	provider: DesktopProvider,
	defaultModelName: string | null,
): string {
	const group = providerGroup(provider);
	const how =
		group === "local"
			? "On this computer"
			: group === "key"
				? "API key saved"
				: "Signed in";
	return defaultModelName ? `${how} · ${defaultModelName}` : how;
}

/**
 * A model id's display name, from the one name source this page holds: the
 * provider's own suggestion. Any other id is shown as the id, which is what
 * the model settings select shows for it too.
 */
export function modelDisplayName(
	provider: Pick<DesktopProvider, "suggested_model"> | null | undefined,
	modelId: string | null | undefined,
): string | null {
	if (!modelId) return null;
	const suggested = provider?.suggested_model;
	if (suggested && suggested.id === modelId) return suggested.name;
	return modelId;
}

/**
 * The code a device flow asks the user to enter.
 *
 * A newer backend sends it as `user_code`; an older one only as the
 * `instructions` sentence ("Enter code: ABCD-EFGH"), which the panel used to
 * print inside a code box with a "Copy code" button that copied the whole
 * sentence (UX U4). Parsing that one fixed phrasing is the fallback.
 */
export function deviceCodeOf(operation: {
	user_code?: string | null;
	instructions: string | null;
}): string | null {
	if (operation.user_code) return operation.user_code;
	const match = DEVICE_CODE_SENTENCE.exec(operation.instructions ?? "");
	return match ? match[1] : null;
}

/** The host of a URL for prose ("We opened claude.ai"), or null. */
export function hostOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).host.replace(WWW_PREFIX, "") || null;
	} catch {
		return null;
	}
}

/** Whole minutes left, rounded up, for "Link expires in N min". */
export function minutesLeft(expiresIn: number): number | null {
	return expiresIn > 0 ? Math.ceil(expiresIn / 60) : null;
}

/** The backend's own supersede sentence (`DesktopAuth.start`). */
export const SUPERSEDED_MESSAGE = "Replaced by a new sign-in.";

/** Body copy for a sign-in that ended without succeeding. */
export function unfinishedMessage(
	operation: { state: string; message: string },
	brand: string,
): string {
	if (operation.state === "expired")
		return operation.message ===
			"This sign-in is no longer available. Start again."
			? "This sign-in is no longer available, so it was stopped."
			: "The sign-in link expired.";
	if (operation.state === "cancelled")
		return operation.message === SUPERSEDED_MESSAGE
			? "A newer sign-in replaced this one."
			: "You cancelled sign-in.";
	return operation.message && operation.message !== "Sign-in failed."
		? operation.message
		: `${brand} didn't confirm the sign-in.`;
}
