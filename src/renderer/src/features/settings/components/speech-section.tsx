/**
 * The Speech voicing group: how the assistant sounds when it speaks aloud.
 *
 * WHY THIS SURFACE EXISTS. The daemon owns seven settings that shape a spoken
 * reply (`speech.voice.*`: gender, tone, expressiveness, pace, language, accent
 * and free-text delivery instructions), and until now the only way a reader met
 * them was inside the whole 112-row Backend registry, where they are seven
 * `[redacted]` rows among thirty sections — a reader tuning how the assistant
 * SOUNDS had to know the keys' names to find them. The daemon's own registry
 * makes the case for a section rather than scattered keys ("they are one object
 * — the descriptor — and a user tuning how the assistant sounds is doing one
 * thing"), and this group is that section on the desktop side.
 *
 * WHAT IT IS NOT. It is not a second editor with its own wire: the rows are
 * SELECTED from the same `/v1/settings` projection the Backend section reads
 * (one query key, so one cache entry and one refetch), rendered by the same row
 * component, and written through the same `settings.edit`/`settings.reset` ops.
 * And it offers NO credential field of any kind: a voice provider's key is a row
 * in the daemon's own encrypted credential store, reached by `/login <provider>`
 * (the cascade's rungs read PERSISTED rows only), so a field here would be a
 * second home for a secret and a second thing that could disagree with the
 * cascade that actually serves a synthesis.
 *
 * WHAT IT ADDS. Two things the registry cannot state for a reader:
 *
 *   1. AVAILABILITY — `GET /v1/tts/paths`, the resolver's report: which rung
 *      would serve, every rung's availability with the daemon's own sentence for
 *      it, and `servable`. This is the same read the speak control's gate is
 *      built on, so a reader asking "why did nothing come out?" gets the answer
 *      where they are standing rather than a tooltip on a transcript.
 *   2. THE REMEDY — when nothing can speak, the reader is told which act changes
 *      that, in the same classification the disabled control renders from
 *      (`useRadientCredentialProbe` → `speechBlock` → `speechSettingsNote`). One
 *      reading, two sentences: the tooltip is written for a reader on a
 *      transcript and so names the destination, while this group can name the
 *      exact route (`/login radient`).
 *
 * The rows stay EDITABLE in every one of those states, deliberately: these are
 * the daemon's settings on a `live` scope, a synthesis works through whichever
 * rung is available, and disabling a control the backend would happily store
 * would only stop a reader preparing for a sign-in they are about to make.
 */

import {
	desktopFeatureState,
	type DesktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { pairingCardCopy } from "@shared/api/local-operator/backend-error";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button } from "@shared/components/ui";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useSpeechPaths } from "@shared/hooks/use-speech-paths";
import { speechSettingsNote } from "@shared/lib/speech-gate";
import { useQuery } from "@tanstack/react-query";
import { AudioLines } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import { tierFor } from "../backend-settings-tiers";
import {
	speechAvailability,
	speechPathName,
	speechVoiceRows,
} from "../speech-settings-model";
import { backendSettingsKeys } from "./backend-settings-section";
import { BackendSettingRow } from "./backend-setting-row";
import {
	type SettingDraft,
	draftFromSetting,
	editOutcome,
} from "./backend-settings-drafts";
import { InfoGrid, InfoItem, SettingsSection } from "./settings-section";

type SpeechSectionProps = {
	/** Scroll target for the settings sidebar. */
	sectionRef?: RefObject<HTMLDivElement>;
};

/**
 * What the group says about a backend that does not serve voicing at all.
 *
 * Two absences, and they are not one sentence. `below-version` is the durable
 * one and names its own remedy: the surface arrived after the daemon installed
 * here, so updating it is the act that changes anything (the same imperative the
 * skills and references surfaces use). `unpaired` and `unknown` are pairing
 * facts, and the sentence for those comes from the pairing table rather than
 * from here, so this surface cannot disagree with the compatibility banner about
 * what is wrong with the server.
 */
const BACKEND_OLDER_SENTENCE =
	"This backend does not serve the voicing surface. Update the backend to tune how the assistant sounds.";

/** Which of the group's four renderings a feature state admits. */
function groupState(state: DesktopFeatureState): "ready" | "older" | "pairing" {
	if (state === "enabled") return "ready";
	if (state === "below-version") return "older";
	return "pairing";
}

export const SpeechSection: FC<SpeechSectionProps> = ({ sectionRef }) => {
	const capabilities = useDesktopCapabilities();
	const pairingCause = usePairingCause();
	const featureState = desktopFeatureState(capabilities.data, "tts");
	const state = groupState(featureState);

	/*
	 * The SAME registry read the Backend settings section takes, under the same
	 * query key: one cache entry, one refetch after a write, and a reader moving
	 * between the two destinations never sees two answers about one registry.
	 */
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: state === "ready",
		staleTime: 10_000,
	});

	const pathsQuery = useSpeechPaths(state === "ready");

	/*
	 * THE ACCOUNT TRANSITION IS THE ONE REFRESH THIS READ ALLOWED ITSELF.
	 *
	 * Availability is a statement about persisted credentials, and signing in or
	 * out moves it — the group is normally open WHILE that happens (a reader
	 * reads the reason here, runs `/login radient`, and comes back). Both
	 * branches of the probe are watched, the legacy key included, because either
	 * one lights the Radient rung. The alternatives are both wrong for this
	 * surface: an interval spends a credential-store probe (and on the canonical
	 * destination an OAuth round trip) on a page nobody is looking at, and no
	 * refresh at all leaves the panel describing the account the reader had
	 * before they fixed it.
	 */
	const { hasRadientApiKey, hasRadientSession, speechBlock } =
		useRadientCredentialProbe();
	const accountReading = `${hasRadientSession}:${hasRadientApiKey}`;
	const previousAccountReading = useRef(accountReading);
	const refetchPaths = pathsQuery.refetch;
	useEffect(() => {
		if (previousAccountReading.current === accountReading) return;
		previousAccountReading.current = accountReading;
		void refetchPaths();
	}, [accountReading, refetchPaths]);

	const settings = settingsQuery.data;
	const voiceRows = useMemo(
		() => speechVoiceRows(settings?.settings ?? []),
		[settings],
	);

	/* ----------------------------------------------------------- the drafts */

	const [drafts, setDrafts] = useState<Record<string, SettingDraft>>({});
	const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
	const [errors, setErrors] = useState<Record<string, string | null>>({});

	/*
	 * Seeded from the server on arrival, and re-seeded only for a row that is no
	 * longer dirty — the asymmetry the Backend section's own seeding states: a
	 * refetch must never overwrite what the reader typed, and a draft that
	 * already equals the server's value has to follow the server or a successful
	 * save would leave the row reading as unsaved forever.
	 */
	useEffect(() => {
		if (!settings) return;
		setDrafts((current) => {
			let changed = false;
			const next = { ...current };
			for (const setting of speechVoiceRows(settings.settings).rows) {
				const existing = current[setting.key];
				if (existing && existing.value !== draftFromSetting(setting).value) {
					continue;
				}
				const seeded = draftFromSetting(setting);
				if (
					existing &&
					existing.value === seeded.value &&
					existing.cascadeBase === seeded.cascadeBase
				) {
					continue;
				}
				next[setting.key] = seeded;
				changed = true;
			}
			return changed ? next : current;
		});
	}, [settings]);

	const markSaving = (key: string, saving: boolean) =>
		setSavingKeys((current) => ({ ...current, [key]: saving }));

	const setError = (key: string, error: string | null) =>
		setErrors((current) => ({ ...current, [key]: error }));

	const saveRow = async (setting: BackendSetting) => {
		const draft = drafts[setting.key];
		if (!draft) return;
		const outcome = editOutcome(setting, draft);
		if (!outcome.ok) {
			setError(setting.key, outcome.error);
			return;
		}
		markSaving(setting.key, true);
		setError(setting.key, null);
		try {
			await desktopResult(outcome.request);
			markSaving(setting.key, false);
			const refreshed = await settingsQuery.refetch();
			const fresh = refreshed.data?.settings.find(
				(candidate) => candidate.key === setting.key,
			);
			if (fresh) {
				setDrafts((current) => {
					const live = current[setting.key];
					const untouched =
						live &&
						live.value === draft.value &&
						live.cascadeBase === draft.cascadeBase;
					if (!untouched) return current;
					return { ...current, [setting.key]: draftFromSetting(fresh) };
				});
			}
		} catch (error) {
			markSaving(setting.key, false);
			setError(
				setting.key,
				error instanceof Error
					? error.message
					: "The setting could not be saved.",
			);
		}
	};

	const resetRow = async (setting: BackendSetting) => {
		markSaving(setting.key, true);
		setError(setting.key, null);
		try {
			await desktopResult({ op: "settings.reset", key: setting.key });
			setDrafts((current) => ({
				...current,
				[setting.key]: draftFromSetting({
					...setting,
					value: setting.default,
					is_default: true,
				}),
			}));
			markSaving(setting.key, false);
			await settingsQuery.refetch();
		} catch (error) {
			markSaving(setting.key, false);
			setError(
				setting.key,
				error instanceof Error
					? error.message
					: "The setting could not be reset.",
			);
		}
	};

	/* ------------------------------------------------- the availability read */

	const availability = pathsQuery.data
		? speechAvailability(pathsQuery.data)
		: null;

	/*
	 * The load failure both the registry and the capabilities read can produce,
	 * worded by the pairing table for the cause main published — the same
	 * authority the Backend section's card uses, so two surfaces cannot describe
	 * one daemon differently.
	 */
	const loadError = (capabilities.data ? null : capabilities.error) ?? null;
	const settingsError = settingsQuery.error;

	const title = "Speech voicing";
	const description = "How the assistant sounds when it speaks aloud.";

	if (state === "pairing") {
		const { sentence } = pairingCardCopy(
			pairingCause ?? null,
			"Speech settings could not be loaded.",
			loadError,
		);
		return (
			<SettingsSection
				title={title}
				icon={AudioLines}
				description={description}
				sectionRef={sectionRef}
			>
				<Alert variant="warning">{sentence}</Alert>
			</SettingsSection>
		);
	}

	if (state === "older") {
		return (
			<SettingsSection
				title={title}
				icon={AudioLines}
				description={description}
				sectionRef={sectionRef}
			>
				<Alert variant="warning">{BACKEND_OLDER_SENTENCE}</Alert>
			</SettingsSection>
		);
	}

	if (settingsError || !settings) {
		const { sentence, remedy } = pairingCardCopy(
			pairingCause ?? null,
			"Speech settings could not be loaded.",
			settingsError,
		);
		return (
			<SettingsSection
				title={title}
				icon={AudioLines}
				description={description}
				sectionRef={sectionRef}
			>
				<Alert variant="warning">
					<div className="flex items-center justify-between gap-3">
						<span>{sentence}</span>
						{remedy && (
							<Button
								variant="secondary"
								size="sm"
								className="shrink-0"
								onClick={() => {
									void settingsQuery.refetch();
								}}
							>
								Retry
							</Button>
						)}
					</div>
				</Alert>
			</SettingsSection>
		);
	}

	/*
	 * The note is rendered on the state that needs a remedy — nothing can speak —
	 * and not on the state where the account read is merely quiet: availability,
	 * not the account, is what decides whether the reader hears anything, and a
	 * machine served by a stored provider key speaks perfectly well to a signed-out
	 * Radient account. That is also the one combination a "sign-in required"
	 * notice would get wrong.
	 */
	const inert = availability
		? !availability.servable
		: /* No answer yet: the one reading that is already a definite statement without
		   * one is the local server being down, which the connectivity gate owns. Any
		   * other silence is the check's, and is rendered as such above rather than as a
		   * claim about speech. */
			speechBlock === "offline";

	return (
		<SettingsSection
			title={title}
			icon={AudioLines}
			description={description}
			sectionRef={sectionRef}
		>
			<div className="flex flex-col gap-6">
				<section className="flex flex-col gap-3">
					{pathsQuery.isPending && (
						<p className="flex items-center gap-2 text-body-sm text-ink-muted">
							<Spinner />
							{speechSettingsNote("checking")}
						</p>
					)}

					{pathsQuery.isError &&
						!availability &&
						/* The offline arm is stated by the note below, from the connectivity
						 * gate's own reading: an outage is not a failure of this read, and a
						 * surface that reported it as one would name the wrong cause and offer a
						 * Retry that cannot work. */
						speechBlock !== "offline" && (
						<Alert variant="warning">
							Speech availability could not be read.{" "}
							{pathsQuery.error instanceof Error
								? pathsQuery.error.message
								: ""}
						</Alert>
					)}

					{availability && (
						<>
							<InfoGrid>
								<InfoItem
									label="Speaks through"
									value={
										availability.serving
											? speechPathName(availability.serving)
											: "Nothing yet"
									}
								/>
								<InfoItem
									label="Availability"
									value={availability.servable ? "Ready" : "No provider"}
								/>
							</InfoGrid>
							{/*
							 * The daemon's own sentence, verbatim. It names what is missing
							 * (or what was found) in the register its resolver wrote it in, and
							 * restating it here in this file's words would be the second opinion
							 * about one cascade that the whole voicing family avoids.
							 */}
							<p className="text-body-sm text-ink-muted">
								{availability.reason}
							</p>
							{/*
							 * Every rung, in cascade order, because that order IS the answer to
							 * "which provider will this use, and why not the one above it" — the
							 * question a reader with one provider configured asks first.
							 */}
							<ul className="flex flex-col gap-1">
								{availability.rungs.map((rung) => (
									<li
										key={rung.path}
										className="flex flex-col gap-0.5 text-body-sm"
									>
										<span className="text-ink">
											{rung.name}
											<span className="text-ink-dim">
												{" "}
												{rung.available ? "(available)" : "(not available)"}
											</span>
										</span>
										<span className="text-meta text-ink-dim">{rung.reason}</span>
									</li>
								))}
							</ul>
						</>
					)}
				</section>

				{inert && (
					<Alert variant="warning">{speechSettingsNote(speechBlock)}</Alert>
				)}

				<div className="flex flex-col gap-1">
					{voiceRows.rows.map((setting) => (
						<BackendSettingRow
							key={setting.key}
							setting={setting}
							draft={drafts[setting.key] ?? draftFromSetting(setting)}
							tier={tierFor(setting)}
							saving={Boolean(savingKeys[setting.key])}
							error={errors[setting.key] ?? null}
							onDraftChange={(draft) =>
								setDrafts((current) => ({ ...current, [setting.key]: draft }))
							}
							onSave={() => {
								void saveRow(setting);
							}}
							onReset={() => {
								void resetRow(setting);
							}}
						/>
					))}
				</div>

				{/*
				 * The registry answered but does not carry a voicing key: this app is
				 * ahead of the daemon it is talking to, which is the one state in which
				 * the group would otherwise render a SHORTER list than it means to, and
				 * be read as a complete one. Named per key rather than counted, so the
				 * reader (and the next agent) can see which row moved.
				 */}
				{voiceRows.missing.length > 0 && (
					<p className="text-meta text-ink-dim">
						This backend does not register{" "}
						{voiceRows.missing.join(", ")} yet, so those rows are not shown.
					</p>
				)}
			</div>
		</SettingsSection>
	);
};
