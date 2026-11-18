/**
 * Which engine hears and speaks, under the Session voice switch.
 *
 * Three options. Local is what exists (speech models on this computer). Bring
 * your own key sends speech through the person's own ElevenLabs account, held
 * by the daemon, and loads nothing locally. Radient cloud is a PLACEHOLDER:
 * listed so the shape is visible, disabled, and never reaches main.
 *
 * The value is main's (`voice.qwen.engine.*`); this row reads it and asks main
 * to change it, and shows what main answers.
 *
 * THE KEY. With Bring your own key chosen the row offers one field. The key goes
 * to the daemon's own credential store through `auth.key` - the same route the
 * Providers page uses (and `/login elevenlabs` in the terminal) - so there is
 * still ONE place a secret lives and one thing the speech service reads. It is
 * a password field, is cleared the moment Save is pressed (saved or refused),
 * and is never rendered back, logged or kept.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useId, useState } from "react";
import type {
	QwenVoiceEngine,
	SaveKeyResult,
} from "../../../../../shared/desktop-contract";
import { useVoiceStatus, voiceKeys } from "../../voice/use-voice-status";
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

type KeyOutcome = "checked" | "unverified" | { error: string } | null;

/** The one field for the ElevenLabs key; see the file header for the rules. */
const ElevenLabsKeyField: FC = () => {
	const client = useQueryClient();
	const [value, setValue] = useState("");
	const [saving, setSaving] = useState(false);
	const [outcome, setOutcome] = useState<KeyOutcome>(null);
	const id = useId();
	const save = async () => {
		const key = value.trim();
		if (!key || saving) return;
		// Cleared BEFORE the request: the secret leaves the screen and this
		// component's state at once, whatever the answer is.
		setValue("");
		setSaving(true);
		setOutcome(null);
		try {
			const result = await desktopResult<SaveKeyResult | null>({
				op: "auth.key",
				provider: "elevenlabs",
				value: key,
			});
			setOutcome(result?.valid === true ? "checked" : "unverified");
			await client.invalidateQueries({ queryKey: voiceKeys.status });
		} catch (error) {
			setOutcome({
				error:
					error instanceof Error && error.message
						? error.message
						: t("ui.settings.voice.engine.key.failed"),
			});
		} finally {
			setSaving(false);
		}
	};
	return (
		<span className="mt-1 flex flex-col gap-1">
			<label htmlFor={id} className="text-meta text-ink-muted">
				{t("ui.settings.voice.engine.key.label")}
			</label>
			<span className="flex items-center gap-2">
				<input
					id={id}
					type="password"
					autoComplete="off"
					spellCheck={false}
					data-voice-engine-key-input=""
					value={value}
					onChange={(event) => setValue(event.target.value)}
					className="min-w-0 flex-1 rounded-sm border border-hairline bg-sunken px-2 py-1 text-body"
				/>
				<button
					type="button"
					data-voice-engine-key-save=""
					disabled={saving || value.trim() === ""}
					onClick={() => void save()}
					className="rounded-sm border border-hairline px-2 py-1 text-body disabled:opacity-50"
				>
					{t("ui.settings.voice.engine.key.save")}
				</button>
			</span>
			<span className="text-meta text-ink-dim">
				{t("ui.settings.voice.engine.key.hint")}
			</span>
			{outcome === "checked" && (
				<output className="text-meta text-ink-muted">
					{t("ui.settings.voice.engine.key.saved_checked")}
				</output>
			)}
			{outcome === "unverified" && (
				<output className="text-meta text-ink-muted">
					{t("ui.settings.voice.engine.key.saved_unverified")}
				</output>
			)}
			{outcome !== null && typeof outcome === "object" && (
				<span role="alert" className="text-meta text-danger">
					{outcome.error}
				</span>
			)}
		</span>
	);
};

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
						{option.value === "byok" && engine === "byok" && (
							<ElevenLabsKeyField />
						)}
					</span>
				</label>
			))}
		</fieldset>
	);
};
