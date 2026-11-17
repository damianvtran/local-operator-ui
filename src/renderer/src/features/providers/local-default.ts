/**
 * Make a local runtime (Ollama, LM Studio, ...) the default for chats.
 *
 * ## Why (UX round 1, U1 - onboarding friction 2026-11)
 *
 * The largest D1/D4 cohort in the PostHog replays had Ollama RUNNING and a model
 * picked, and still could not send: the chat's send gate
 * (`use-provider-status.ts::providerStatusFrom`) counts a local runtime only when
 * it is the configured default `hosting`, and `first-time-user.ts::hasConnectedProvider`
 * deliberately never counts a local row (a keyless runtime reports `configured`
 * unconditionally). The one way to make it the default was the model picker's
 * "Set current model as default", which one replay found after 90 minutes.
 *
 * This is the same write that button makes - `writeModelDefaultSettings`, the
 * validated `settings.edit` of `hosting` then `model_name` - offered where the
 * user already is: the local panel's ready state and the composer's block line.
 * After it lands, the config read every gate shares is invalidated, so
 * `providerStatusFrom` sees `hosting: <runtime>`, counts the local row as usable
 * and the block clears by itself. No backend change.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { writeModelDefaultSettings } from "../chat/pickers/model-default-settings";
import { CONFIG_QUERY_KEY } from "./use-provider-status";

/** A model a local runtime serves, named as the config stores it. */
export type LocalModelChoice = { provider: string; model_id: string };

/** The write itself, injectable so the focused test can observe the two keys. */
export async function makeLocalDefault(
	model: LocalModelChoice,
	editSetting: (
		key: "hosting" | "model_name",
		value: string,
	) => Promise<unknown> = (key, value) =>
		desktopResult({ op: "settings.edit", key, value }),
): Promise<void> {
	await writeModelDefaultSettings(model, editSetting);
}

/**
 * The press, with its in-flight state and its failure sentence (the error's own
 * text: the settings registry's refusal names what it refused).
 */
export function useMakeLocalDefault(): {
	busy: boolean;
	error: string | null;
	run: (model: LocalModelChoice) => Promise<boolean>;
} {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = useCallback(
		async (model: LocalModelChoice) => {
			setBusy(true);
			setError(null);
			try {
				await makeLocalDefault(model);
				/*
				 * Awaited, so the caller's "done" lands on the frame the gate
				 * already reads the new default on: the composer line clears and the
				 * panel's receipt appears together, not one poll apart.
				 */
				await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
				return true;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				return false;
			} finally {
				setBusy(false);
			}
		},
		[queryClient],
	);
	return { busy, error, run };
}
