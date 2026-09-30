/**
 * @file default-model-choice.ts
 * @description
 * What onboarding's "Your default model" step should show, decided from the
 * census and the config -- never from the legacy `/v1/credentials` key list.
 *
 * ## Why this exists (design D5, UX U2)
 *
 * The step filtered providers by `${ID}_API_KEY` in `credentials.env`. OAuth
 * sign-ins are stored in the auth store, not that file, so a user who had just
 * seen "Signed in to Anthropic" was told "No providers with credentials yet";
 * and when it did list models it saved `availableModels[0]`, whatever the
 * catalogue happened to list first. The census (`providers.list`) is the
 * source `first-time-user.ts` already moved the onboarding gate to for the
 * same defect, so this step reads it too.
 *
 * ## The four answers
 *
 * - `applied`: a default is configured (the backend applied one on sign-in, or
 *   the user already had one). Shown as chosen, with "Change".
 * - `proposed`: nothing is configured, and a connected provider has a
 *   backend suggestion. Shown preselected; Continue writes it. This is the
 *   older-backend path (no defaults applied on sign-in) and the one where the
 *   user connected more than one provider before this step.
 * - `choose`: a provider is connected but the backend states no suggestion
 *   (a backend before `suggested_model`). The user picks; nothing is guessed.
 * - `none`: nothing is connected. The step says so and points back.
 */

import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { FEATURED_PROVIDER_IDS, isConnectedRow } from "./provider-catalog";

export type DefaultModelChoice =
	| {
			kind: "applied";
			hosting: string;
			model: string | null;
			provider: DesktopProvider | null;
	  }
	| {
			kind: "proposed";
			provider: DesktopProvider;
			model: { id: string; name: string };
	  }
	| { kind: "choose"; provider: DesktopProvider }
	| { kind: "none" };

/**
 * The provider a proposal is about: the one the user most plausibly just
 * connected. Nothing in the census orders sign-ins by time, so the featured
 * order (the rows step 1 leads with) breaks ties, then registry order.
 */
function proposalProvider(
	connected: DesktopProvider[],
): DesktopProvider | null {
	for (const id of FEATURED_PROVIDER_IDS) {
		const row = connected.find((provider) => provider.id === id);
		if (row) return row;
	}
	return connected[0] ?? null;
}

export function chooseDefaultModel(
	census: DesktopProvider[],
	config: { hosting: string | null; model: string | null },
): DefaultModelChoice {
	if (config.hosting) {
		return {
			kind: "applied",
			hosting: config.hosting,
			model: config.model,
			provider: census.find((row) => row.id === config.hosting) ?? null,
		};
	}
	const connected = census.filter(
		(provider) => !provider.local && isConnectedRow(provider, null),
	);
	const withSuggestion = connected.filter(
		(provider) => provider.suggested_model,
	);
	const proposed = proposalProvider(withSuggestion);
	if (proposed?.suggested_model) {
		return {
			kind: "proposed",
			provider: proposed,
			model: proposed.suggested_model,
		};
	}
	const first = proposalProvider(connected);
	if (first) return { kind: "choose", provider: first };
	return { kind: "none" };
}
