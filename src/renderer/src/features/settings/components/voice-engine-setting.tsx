/**
 * Which engine hears and speaks, under the Session voice switch.
 *
 * Three options. Local is what exists (speech models on this computer). Bring
 * your own key sends speech through the person's own ElevenLabs account, held
 * by the daemon, and loads nothing locally. Radient cloud is a PLACEHOLDER:
 * listed so the shape is visible, disabled, and never reaches main.
 *
 * The value is main's (`voice.qwen.engine.*`); this row reads it and asks main
 * to change it, and shows what main answers. There is deliberately no key
 * field: the key lives in the daemon's own credential store (`/login
 * elevenlabs`), so there is one place a secret can be and one thing that can
 * disagree with the speech service that actually runs.
 */

import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import { useId } from "react";
import type { QwenVoiceEngine } from "../../../../../shared/desktop-contract";
import { useVoiceStatus } from "../../voice/use-voice-status";
import {
	bridge,
	setVoiceEngine,
	useVoiceEngine,
	useVoiceEngineSync,
} from "../../voice/use-voice-switch";

type EngineOption = {
	value: QwenVoiceEngine;
	label: () => string;
	description: () => string;
	/** A placeholder: shown, disabled, never sent to main. */
	soon?: boolean;
};

const OPTIONS: EngineOption[] = [
	{
		value: "local",
		label: () => t("ui.settings.voice.engine.local.label"),
		description: () => t("ui.settings.voice.engine.local.description"),
	},
	{
		value: "byok",
		label: () => t("ui.settings.voice.engine.byok.label"),
		description: () => t("ui.settings.voice.engine.byok.description"),
	},
	{
		value: "radient",
		label: () => t("ui.settings.voice.engine.radient.label"),
		description: () => t("ui.settings.voice.engine.radient.description"),
		soon: true,
	},
];

export const VoiceEngineSetting: FC = () => {
	useI18nLocale();
	useVoiceEngineSync();
	const engine = useVoiceEngine();
	const { state } = useVoiceStatus();
	const name = useId();
	if (!bridge()?.getEngine) return null;
	const byok = state?.byok;
	return (
		<fieldset
			data-voice-engine=""
			aria-describedby={`${name}-help`}
			className="flex flex-col gap-2 border-0 p-0"
		>
			<legend className="text-body font-medium text-ink">
				{t("ui.settings.voice.engine.label")}
			</legend>
			<p id={`${name}-help`} className="text-meta text-ink-dim">
				{t("ui.settings.voice.engine.description")}
			</p>
			{OPTIONS.map((option) => (
				<label
					key={option.value}
					className="flex items-start gap-2 text-body text-ink aria-disabled:text-ink-dim"
					aria-disabled={option.soon === true}
				>
					<input
						type="radio"
						name={name}
						value={option.value}
						checked={engine === option.value}
						disabled={option.soon === true}
						onChange={() => {
							if (!option.soon) void setVoiceEngine(option.value);
						}}
						className="mt-1"
					/>
					<span className="flex flex-col">
						<span>
							{option.label()}
							{option.soon && (
								<span className="ml-2 text-meta text-ink-dim">
									{t("ui.settings.voice.engine.soon")}
								</span>
							)}
						</span>
						<span className="text-meta text-ink-dim">
							{option.description()}
						</span>
						{option.value === "byok" && engine === "byok" && byok && (
							<span
								data-voice-engine-key={byok.ready ? "ready" : "missing"}
								className="text-meta text-ink-muted"
							>
								{byok.ready
									? t("ui.settings.voice.engine.byok.ready")
									: t("ui.settings.voice.engine.byok.missing")}
							</span>
						)}
					</span>
				</label>
			))}
		</fieldset>
	);
};
