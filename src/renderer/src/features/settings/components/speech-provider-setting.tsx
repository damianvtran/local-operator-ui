/**
 * WHO LISTENS AND SPEAKS: the one speech provider, in the Speech section.
 *
 * Two choices and no third: Radient cloud (billed to the person's Radient
 * credit) or their own ElevenLabs key. There is no order and no fallback - the
 * daemon refuses a request for a provider that was not chosen, so a stored login
 * for the other one never serves or bills anything. Hands-free voice and the
 * Speak button on messages both follow this one choice.
 *
 * THE VALUE IS THE DAEMON'S (`speech.provider`), written through the same
 * `settings.edit` op the rows beside it use, and READ back from `voice.status`
 * together with each provider's readiness (`ready`, and the backend's own
 * sentence when it is not). This row shows that sentence as written and offers
 * the way to fix it - the Providers page - rather than describing the problem in
 * words of its own. It offers no credential field: a key lives in one place, the
 * Providers page.
 *
 * "None chosen" is not an option here on purpose. It is where everyone starts,
 * and it is shown as a plain line while neither radio is on; once a provider is
 * picked the person moves between the two.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useId, useState } from "react";
import type { SpeechProvider } from "../../../../../shared/desktop-control-contract";
import { useVoiceProviders, voiceKeys } from "../../voice/use-voice-status";
import { backendSettingsKeys } from "./backend-settings-section";

/** The daemon's key for the choice. */
export const SPEECH_PROVIDER_KEY = "speech.provider";

type Option = {
	value: SpeechProvider;
	label: () => string;
	description: () => string;
};

const OPTIONS: Option[] = [
	{
		value: "radient",
		label: () => t("ui.settings.speech.provider.radient.label"),
		description: () => t("ui.settings.speech.provider.radient.description"),
	},
	{
		value: "elevenlabs",
		label: () => t("ui.settings.speech.provider.elevenlabs.label"),
		description: () => t("ui.settings.speech.provider.elevenlabs.description"),
	},
];

type Props = {
	/** Take the person to the Providers page for this provider. */
	onOpenProviders?: (provider: SpeechProvider) => void;
};

export const SpeechProviderSetting: FC<Props> = ({ onOpenProviders }) => {
	useI18nLocale();
	const client = useQueryClient();
	const { available, provider, providers } = useVoiceProviders();
	/** The choice just made, shown at once and dropped when the status agrees. */
	const [pending, setPending] = useState<SpeechProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const name = useId();
	// A backend that does not serve voice has no provider to choose.
	if (!available) return null;
	const chosen = pending ?? provider;

	const choose = async (next: SpeechProvider) => {
		if (pending !== null || next === provider) return;
		setPending(next);
		setError(null);
		try {
			await desktopResult({
				op: "settings.edit",
				key: SPEECH_PROVIDER_KEY,
				value: next,
			});
			// Awaited, so the radio does not fall back to the old choice between the
			// write and the read that says the new one. Main learns the same answer
			// from this read, which is what lets hands-free voice start.
			await client.invalidateQueries({ queryKey: voiceKeys.status });
			void client.invalidateQueries({ queryKey: backendSettingsKeys.all });
		} catch (cause) {
			setError(
				cause instanceof Error && cause.message
					? cause.message
					: t("ui.settings.speech.provider.save_failed"),
			);
		} finally {
			setPending(null);
		}
	};

	return (
		<fieldset
			data-speech-provider=""
			aria-describedby={`${name}-help`}
			className="flex flex-col gap-3 border-0 p-0"
		>
			<legend className="text-body font-medium text-ink">
				{t("ui.settings.speech.provider.label")}
			</legend>
			<p id={`${name}-help`} className="text-meta text-ink-dim">
				{t("ui.settings.speech.provider.description")}
			</p>
			{chosen === null && (
				<p data-speech-provider-none="" className="text-meta text-ink-muted">
					{t("ui.settings.speech.provider.none_chosen")}
				</p>
			)}
			{OPTIONS.map((option) => {
				const readiness = providers?.[option.value] ?? null;
				return (
					<div
						key={option.value}
						data-speech-provider-option={option.value}
						className="flex flex-col gap-1"
					>
						<label className="flex items-start gap-2 text-body text-ink">
							<input
								type="radio"
								name={name}
								value={option.value}
								checked={chosen === option.value}
								disabled={pending !== null}
								onChange={() => void choose(option.value)}
								className="mt-1"
							/>
							<span className="flex flex-col">
								<span>{option.label()}</span>
								<span className="text-meta text-ink-dim">
									{option.description()}
								</span>
							</span>
						</label>
						{readiness?.ready === true && (
							<output
								data-speech-provider-status="ready"
								className="pl-6 text-meta text-ink-muted"
							>
								{t("ui.settings.speech.provider.ready")}
							</output>
						)}
						{readiness !== null && !readiness.ready && (
							<span
								data-speech-provider-status="not_ready"
								className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-meta text-ink-muted"
							>
								{/* The backend's sentence, as written. */}
								<span>
									{readiness.reason ??
										t("ui.settings.speech.provider.not_ready")}
								</span>
								{onOpenProviders && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										data-speech-provider-setup={option.value}
										className="text-meta text-ink"
										onClick={() => onOpenProviders(option.value)}
									>
										{t("ui.settings.speech.provider.setup")}
									</Button>
								)}
							</span>
						)}
					</div>
				);
			})}
			{error !== null && (
				<span role="alert" className="text-meta text-danger">
					{error}
				</span>
			)}
		</fieldset>
	);
};
