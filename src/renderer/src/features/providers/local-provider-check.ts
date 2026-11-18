/**
 * One local-model check, from the probe and the served list to a diagnosis -
 * and the single place it is reported to analytics.
 *
 * WHY A MODULE OF ITS OWN. Two lanes met here: PR #1962 (onboarding friction)
 * turned the probe into a diagnosis (`diagnoseLocal`), and PR #1963 (first-run
 * funnel events) reported every probe as `local_model_check`. Both edited the
 * panel's press handler, so the merge kept ONE probe and ONE emit, here, away
 * from the React panel, where a node test can drive it with fake I/O and count
 * the events (`scripts/first-run-analytics.test.mjs`).
 *
 * - No address configured: `no_address`, without asking (the core refuses the
 *   probe with a 422 that would otherwise read as the service being down; QA
 *   round 1, Q3). No probe ran, so no event is reported.
 * - The probe ROUTE fails: `check_failed`, because the check never reached the
 *   runtime (agent review round 1, M3) - not "isn't running, download it".
 * - A list that cannot be read is `null` (unknown), never 0, and an empty one
 *   is not trusted as "no models" either (see `LocalDiagnosis`, R2/Q1).
 */

import { categorizeSendFailure } from "@shared/analytics/first-run-reasons";
import { trackProductEvent } from "@shared/analytics/product-events";
import {
	type DesktopProvider,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { ModelsApi } from "@shared/api/local-operator/models-api";
import { type LocalDiagnosis, diagnoseLocal } from "./local-provider-diagnosis";

type Probe = { reachable: boolean; detail: string };

/** The check's two reads; injectable so a test can count events without a backend. */
export interface LocalCheckIo {
	probe(providerId: string): Promise<Probe>;
	/** The served model ids, or null when the listing gave no array. */
	listModels(providerId: string): Promise<string[] | null>;
}

const liveIo: LocalCheckIo = {
	probe: (providerId) =>
		desktopResult<Probe>({ op: "auth.probe", provider: providerId }),
	listModels: async (providerId) => {
		const listed = await ModelsApi.listModels("", providerId);
		return listed.result?.models?.map((model) => model.id) ?? null;
	},
};

export async function checkLocalProvider(
	provider: Pick<DesktopProvider, "id" | "base_url">,
	io: LocalCheckIo = liveIo,
): Promise<LocalDiagnosis> {
	if (!provider.base_url) return { kind: "no_address" };
	let probe: Probe;
	try {
		probe = await io.probe(provider.id);
	} catch (error) {
		const category = categorizeSendFailure(error);
		trackProductEvent("local_model_check", {
			provider: provider.id,
			result: "error",
			reason:
				category === "transport" || category === "backend_unreachable"
					? category
					: "unknown",
		});
		return { kind: "check_failed" };
	}
	/*
	 * Exactly one row per probe - the open-time probe and every "Check again"
	 * alike, the "every reachability probe" contract in
	 * docs/analytics-events.md. It answers reachability only: the listing below
	 * does not add or change a row.
	 */
	trackProductEvent("local_model_check", {
		provider: provider.id,
		result: probe.reachable ? "reachable" : "unreachable",
		reason: probe.reachable ? "none" : "not_answering",
	});
	let models: number | null = null;
	let firstModel: string | null = null;
	if (probe.reachable) {
		try {
			const ids = await io.listModels(provider.id);
			models = ids?.length ?? null;
			firstModel = ids?.[0] ?? null;
		} catch {
			models = null;
		}
	}
	return diagnoseLocal({
		providerId: provider.id,
		baseUrl: provider.base_url,
		probe,
		models,
		firstModel,
	});
}
