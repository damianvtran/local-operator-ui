/**
 * Argument-list rows for the composer's slash popup, and the two formatters
 * that describe a model.
 *
 * The row shaping lives here rather than in the popup component so the popup
 * stays presentational and every rule below is unit-testable without React.
 * The formatters are verbatim ports of `local_operator/tui/widgets/model_picker.py`
 * (`format_window` `:161-176`, `format_price_pair` `:209-259`, `_trim_price`
 * `:277-...`), so the two hosts cannot drift: the TUI's price column and this
 * one have to say the same thing about the same model.
 *
 * The row vocabulary mirrors the TUI's `ArgumentChoice` (`autocomplete.py:88`):
 * a name, a prose description, and a machine-voice DETAIL column pinned to the
 * trailing edge. Detail is STATE, not explanation — "128k · $3/15",
 * "signed in", "role" — because the two columns answer different questions:
 * what this thing IS versus where it stands right now.
 */

/** The row a list renders. Mirrors `ArgumentChoice`. */
export type ArgumentRow = {
	value: string;
	name: string;
	description?: string;
	/** Trailing machine-voice detail: "128k · $3/15", "role", "usage-based". */
	detail?: string;
	/** Paints `detail` in the danger tint. */
	alert?: boolean;
	current?: boolean;
};

/**
 * Where an argument list's rows come from.
 *
 * The two halves are named separately because they are two KINDS of source and
 * one name for both is how a reader comes to believe every id is a backend
 * route (round 1 NIT-2).
 *
 * `BackendArgumentSource` is a `commands.entities` command id, pinned against
 * `desktop_catalogues.py:262-305` by `scripts/slash-row-format.test.mjs` — the
 * route answers exactly `model`, `effort`, `approvals`, `team` and `agent`, and
 * a stale id would silently render an empty list rather than fail.
 * `RendererArgumentSource` is the one source with no backend route: `theme` is
 * filled from the same `@shared/themes` table `/theme`'s dialog reads, so there
 * is no second theme vocabulary.
 */
export type BackendArgumentSource =
	| "model"
	| "effort"
	| "approvals"
	| "team"
	| "agent";
export type RendererArgumentSource = "theme";
export type ArgumentSource = BackendArgumentSource | RendererArgumentSource;

/**
 * The popup's one-word name for each argument list, and for the command list.
 *
 * Lives beside the source union so a new source cannot be added without the
 * label being decided: the record is exhaustive over `ArgumentSource`, so a
 * seventh source is a type error here rather than a list that renders under the
 * previous subject's name (round 1 D3 / UX U3). Sentence case, like every other
 * label in the app.
 */
export const ARGUMENT_SOURCE_LABEL: Record<ArgumentSource, string> = {
	model: "Models",
	effort: "Effort",
	approvals: "Approvals",
	team: "Teams",
	agent: "Agents",
	theme: "Themes",
};

/**
 * `400k` / `1.0m` / `""` when unknown.
 *
 * Empty rather than a placeholder: the column is right-aligned, so a blank
 * leaves the cell empty while a dash would draw the eye to the one row with
 * nothing to say. `tokens <= 0` is unknown (the backend's own convention: `-1`
 * means unknown and `0` also does, normalised once in `CatalogueEntry` so this
 * layer must not re-decide it).
 */
export function formatWindow(tokens: number): string {
	if (!(tokens > 0)) return "";
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}m`.replace(".0m", "m");
	}
	if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
	return String(tokens);
}

/**
 * Prices without trailing noise: `3`, `0.6`, `15`, `18.8`, `0.075`.
 *
 * Rounding is not free here. A flat two decimals printed `$0.07` for `0.075` —
 * a 6.7% under-quote on exactly the cheap models a user picks BECAUSE of the
 * price — and `$19` for `18.75`, which reads as a real quoted price the
 * provider does not charge. So: one decimal above ten, and THREE SIGNIFICANT
 * FIGURES below it, which is a relative bound and therefore says the same thing
 * about a $5 model and a $0.05 one.
 */
/** Trailing padding a rendered decimal does not need. */
const TRAILING_ZEROS = /0+$/;
const TRAILING_DOT = /\.$/;

export function trimPrice(value: number): string {
	if (value === Math.trunc(value)) return String(Math.trunc(value));
	if (value >= 10) return value.toFixed(1);
	const exponent = Math.floor(Math.log10(Math.abs(value)));
	const decimals = Math.max(0, 2 - exponent);
	return value
		.toFixed(decimals)
		.replace(TRAILING_ZEROS, "")
		.replace(TRAILING_DOT, "");
}

/**
 * `$3/15` per million, `free` (a stated pair of zeroes), `usage-based` for a
 * meta-route, else `""`.
 *
 * FOUR states, and the split matters. A provider that quotes no pricing is NOT
 * free — treating a missing price as zero would advertise a paid model as free,
 * which is the one error in this column a user would act on. So an absent price
 * (a negative sentinel) is blank, only a genuine pair of zeroes says `free`,
 * and a router says `usage-based`. `routed` is checked FIRST because it is a
 * statement about the endpoint rather than about a number, so it cannot be
 * outvoted by a zero a stale listing happens to quote.
 */
export function formatPricePair(
	input: number,
	output: number,
	routed: boolean,
): string {
	if (routed) return "usage-based";
	if (!(input >= 0) || !(output >= 0)) return "";
	if (input === 0 && output === 0) return "free";
	return `$${trimPrice(input)}/${trimPrice(output)}`;
}

type ModelEntity = {
	provider?: unknown;
	model_id?: unknown;
	selector?: unknown;
	value?: unknown;
	label?: unknown;
	connected?: unknown;
	aggregated?: unknown;
	routed?: unknown;
	context_window?: unknown;
	input_price?: unknown;
	output_price?: unknown;
};

type ProfileEntity = {
	value?: unknown;
	name?: unknown;
	description?: unknown;
	kind?: unknown;
	members?: unknown;
};

type ValueEntity = { value?: unknown };

const asText = (value: unknown): string =>
	typeof value === "string" ? value : "";

const asNumber = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : -1;

/** The row's own selector, in the one spelling the wire and the picker share. */
function modelSelectorOf(row: ModelEntity): string {
	const selector = asText(row.selector) || asText(row.value);
	if (selector) return selector;
	const provider = asText(row.provider);
	const modelId = asText(row.model_id);
	return provider && modelId ? `${provider}/${modelId}` : "";
}

/**
 * Shape a `commands.entities` payload into rows, discriminated on `command`.
 *
 * `current` is the payload's own `current` field for `model`, `effort`,
 * `approvals` and `theme`, and the canonical session's `active_team` /
 * `active_agent` for the profile commands. That split is deliberate: the
 * response's `current` for `team` is the resolved ORG CHART and for `agent` the
 * profile DETAIL, and both are only populated when `name` is passed
 * (`desktop_catalogues.py:283-300`) because they belong to the dialog's detail
 * pane, not to a one-line row. Reading them here would mark every row as
 * current on a response that happens to carry a chart.
 */
export function argumentRows(
	command: ArgumentSource,
	entities: readonly unknown[],
	current: unknown,
): ArgumentRow[] {
	switch (command) {
		case "model": {
			const selected = (current ?? null) as {
				provider?: unknown;
				model_id?: unknown;
			} | null;
			const selectedSelector = selected
				? `${asText(selected.provider)}/${asText(selected.model_id)}`
				: "";
			return entities.map((raw) => {
				const row = raw as ModelEntity;
				const value = modelSelectorOf(row);
				/*
				 * The route carries no `credentials_known` — that flag lives on
				 * `models.catalogue` — so an unresolved credential store cannot
				 * be told apart from a readable one here. The rule is applied as
				 * written: only an explicit `false` suppresses the caveat, and
				 * the per-row `connected` this route does send is already
				 * resolved on the store's own thread.
				 */
				const description = [
					asText(row.provider),
					row.aggregated ? "aggregated" : "",
					row.connected === false ? "no credential" : "",
				]
					.filter(Boolean)
					.join(", ");
				const detail = [
					formatWindow(asNumber(row.context_window)),
					formatPricePair(
						asNumber(row.input_price),
						asNumber(row.output_price),
						row.routed === true,
					),
				]
					.filter(Boolean)
					.join(" · ");
				return {
					value,
					name: asText(row.label) || asText(row.model_id),
					description,
					detail: detail || undefined,
					current: Boolean(selectedSelector) && selectedSelector === value,
				};
			});
		}
		case "team":
		case "agent":
			return entities.map((raw) => {
				const row = raw as ProfileEntity;
				const value = asText(row.value) || asText(row.name);
				return {
					value,
					name: asText(row.name) || value,
					description: asText(row.description),
					// The TUI's own row detail for these lists is the profile
					// KIND (role/specialist) — the fact a user picks a hat by. A
					// team row carries none, so its detail column is empty rather
					// than an invented count.
					detail: asText(row.kind) || undefined,
					current: Boolean(current) && current === value,
				};
			});
		case "effort":
		case "approvals":
			return entities.map((raw) => {
				const value = asText((raw as ValueEntity).value);
				return { value, name: value, current: current === value };
			});
		case "theme":
			return entities.map((raw) => {
				const row = raw as ProfileEntity;
				const value = asText(row.value);
				return {
					value,
					name: asText(row.name) || value,
					description: asText(row.description),
					current: current === value,
				};
			});
	}
}
