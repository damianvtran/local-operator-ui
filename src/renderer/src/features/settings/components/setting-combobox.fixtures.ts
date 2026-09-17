/**
 * The payloads the settings combobox stories answer with.
 *
 * Two sources, and the difference is stated rather than smoothed over.
 *
 * - The PROVIDER registry is the committed real projection
 *   (`scripts/fixtures/auth-providers-0.50.0.json`, `/v1/auth/providers`
 *   serialized as the route does it), so the frames show the seventeen rows the
 *   shipped backend actually returns — including the five local servers that
 *   need no key and the twelve that do.
 * - The MODEL catalogue is HAND-BUILT, because no committed fixture of the
 *   wire's `models.catalogue` answer exists. It is shaped like the answer a real
 *   backend gives (checked against an isolated `local-operator serve` on this
 *   host, whose initial listing is 120 rows across 10 providers), and the one
 *   thing it adds deliberately is a MIX of `connected` values: the real initial
 *   listing answers `connected: false` for every row, which is one group and
 *   therefore no evidence at all about the grouping.
 *
 * What these frames are evidence about, and their limit: they are pictures of
 * the RENDERER over a payload shaped like the wire. Whether the real backend
 * serves that payload is the driver scene's job and QA's, not a frame's.
 */
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import providersJson from "../../../../../../scripts/fixtures/auth-providers-0.50.0.json";
import type { DesktopModelCatalogue } from "../../../../../shared/desktop-control-contract";

/** The registry as `/v1/auth/providers` serves it, in the registry's order. */
export const PROVIDER_ROWS = (
	providersJson as unknown as { result: { providers: DesktopProvider[] } }
).result.providers;

type Row = DesktopModelCatalogue["models"][number];

const row = (
	over: Partial<Row> & { provider: string; model_id: string },
): Row => ({
	selector: `${over.provider}/${over.model_id}`,
	label: over.model_id,
	connected: true,
	context_window: 200_000,
	input_price: 3,
	output_price: 15,
	default_context_window: null,
	max_context_window: null,
	aggregated: false,
	...over,
});

/**
 * A listing with one aggregator row, one provider the credential store does not
 * have, and a local server — the three shapes the grouping and the sub-lines
 * have to survive.
 */
export const MODEL_ROWS: Row[] = [
	row({
		provider: "anthropic",
		model_id: "claude-opus-5",
		label: "Claude Opus 5",
	}),
	row({
		provider: "anthropic",
		model_id: "claude-haiku-4-5",
		label: "Claude Haiku 4.5",
		connected: false,
	}),
	row({ provider: "openai", model_id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }),
	row({ provider: "ollama", model_id: "qwen3:8b", label: "Qwen3 8B" }),
	row({
		provider: "openrouter",
		model_id: "anthropic/claude-haiku-4-5",
		label: "Anthropic: Claude Haiku 4.5",
		aggregated: true,
	}),
	row({
		provider: "deepseek",
		model_id: "deepseek-chat",
		label: "DeepSeek Chat",
		connected: false,
	}),
];

/** The answer, with the two degradations this surface has to survive kept reachable. */
export const catalogue = (
	over: Partial<DesktopModelCatalogue> = {},
): DesktopModelCatalogue => ({
	models: MODEL_ROWS,
	source: "initial",
	errors: {},
	credentials_known: true,
	...over,
});
