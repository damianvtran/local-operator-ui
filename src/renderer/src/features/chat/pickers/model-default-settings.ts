/**
 * Persist a model selection as the machine default through the validated local
 * settings registry. The backend's `/model default` command intentionally refuses
 * this write because commands may be routed to a non-local session owner.
 */
import type { DesktopModelSelection } from "../../../../../shared/desktop-contract";

export async function writeModelDefaultSettings(
	model: Pick<DesktopModelSelection, "provider" | "model_id">,
	editSetting: (
		key: "hosting" | "model_name",
		value: string,
	) => Promise<unknown>,
): Promise<void> {
	// Keep the established two-key config contract and surface either write error.
	await editSetting("hosting", model.provider);
	await editSetting("model_name", model.model_id);
}

/** A direct row must name a real model before it can write global defaults. */
export function activeModelForDefault(
	model:
		| Pick<DesktopModelSelection, "provider" | "model_id">
		| null
		| undefined,
): Pick<DesktopModelSelection, "provider" | "model_id"> | null {
	return model?.provider && model.model_id
		? { provider: model.provider, model_id: model.model_id }
		: null;
}

/**
 * The effort owner reports accepted rungs as an informational notice. Refused
 * values are warning notices, so checking only the result kind would persist a
 * default the session itself did not accept.
 */
export function effortCommandSucceeded(
	outcome: { kind?: unknown; style?: unknown } | null | undefined,
): boolean {
	return outcome?.kind === "notice" && outcome.style === "info";
}
