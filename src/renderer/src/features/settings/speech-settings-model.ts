/**
 * The Speech settings group's decisions, kept out of the render.
 *
 * WHY THIS IS ITS OWN MODULE. Two of the group's answers are judgements a
 * reviewer has to be able to read, and a test has to be able to bind, without a
 * DOM: WHICH rows the group owns, and how the daemon's availability report reads
 * in the reader's words. The render is a thin projection of both.
 *
 * THE KEYS ARE THE DAEMON'S, NOT THIS FILE'S INVENTION. `settings_io.py`'s
 * `speech` section registers exactly these seven, and they arrive in the same
 * `/v1/settings` projection every other row does — so the group carries no second
 * table of controls: it SELECTS its rows from the registry by key, renders them
 * with the same row component the Backend settings section uses, and writes them
 * through the same `settings.edit`/`settings.reset` ops. That is also why the
 * group offers no credential field of any kind: a voice provider's key is a row
 * in the daemon's own credential store, reached by `/login <provider>`, and a
 * field here would be a second place a secret could live and a second thing that
 * could disagree with the cascade that actually serves speech (see
 * `resolve_voice_path`).
 *
 * A key the daemon adds to that section is a key this group does not know about,
 * which is reported rather than silently dropped — the same failure mode the tier
 * map's drift test exists for, one surface over.
 */

import type {
	BackendSetting,
	VoicePath,
	VoicePathResolution,
} from "@shared/api/local-operator/desktop-api";

/**
 * The voicing keys, in the daemon's registry order.
 *
 * The order is the daemon's rather than alphabetical, because it is the order a
 * reader meets the rows in everywhere else the registry is rendered, and the
 * descriptor they edit is one object — the cascade's own module docstring makes
 * the same point about the section being one thing rather than seven.
 */
export const SPEECH_VOICE_KEYS = [
	"speech.voice.gender",
	"speech.voice.tone",
	"speech.voice.expressiveness",
	"speech.voice.pace",
	"speech.voice.language",
	"speech.voice.accent",
	"speech.voice.instructions",
] as const;

export type SpeechVoiceRows = {
	/** The registry's rows for the voicing keys, in `SPEECH_VOICE_KEYS` order. */
	rows: BackendSetting[];
	/**
	 * Voicing keys the registry did not carry at all.
	 *
	 * Reported rather than ignored: an empty group and a group whose rows are
	 * missing look the same to a reader, and they mean different things (a
	 * backend that does not register the section, versus one this file has fallen
	 * behind). The group renders the second as a sentence; the first is the
	 * capability's own state and is answered before this function is called.
	 */
	missing: string[];
};

/** The group's rows, selected from the registry by key. */
export function speechVoiceRows(
	settings: readonly BackendSetting[],
): SpeechVoiceRows {
	const byKey = new Map(settings.map((setting) => [setting.key, setting]));
	const rows: BackendSetting[] = [];
	const missing: string[] = [];
	for (const key of SPEECH_VOICE_KEYS) {
		const row = byKey.get(key);
		if (row) rows.push(row);
		else missing.push(key);
	}
	return { rows, missing };
}

/**
 * The reader-facing name of a cascade rung.
 *
 * These are the only three strings the group invents about the cascade, and they
 * are PRODUCT names rather than wire values: `provider_tts_radient` is a rung,
 * "Radient Pass" is what a reader signed up for. Every other sentence about
 * availability comes from the daemon verbatim (`reason` on each rung and on the
 * resolution), so the reader is told what the resolver decided, in the words the
 * resolver wrote for them.
 */
const PATH_NAMES: Record<VoicePath, string> = {
	provider_tts_radient: "Radient Pass",
	provider_tts_elevenlabs: "ElevenLabs",
	provider_tts_openai: "OpenAI",
	// `none` never appears in `rungs` (the daemon excludes it) and appears in
	// `path` only when nothing is available, where the resolution's own reason is
	// what the group renders. Named anyway so the map is total.
	none: "No provider",
};

export function speechPathName(path: VoicePath): string {
	return PATH_NAMES[path];
}

export type SpeechAvailability = {
	/** Whether the daemon says anything on this machine can synthesize. */
	servable: boolean;
	/** The rung that would serve, or `null` when the cascade ended at `none`. */
	serving: VoicePath | null;
	/** The daemon's own sentence for the chosen path, or for there being none. */
	reason: string;
	/** Every rung, in cascade order, with the daemon's own sentence for it. */
	rungs: {
		path: VoicePath;
		name: string;
		available: boolean;
		reason: string;
	}[];
};

/**
 * The availability report, in the shape the group renders.
 *
 * `serving` is derived from `path` rather than stored, and `servable` is carried
 * through from the daemon rather than recomputed from the rungs: the daemon's own
 * docstring says it is derived there so it cannot disagree with `path`, and a
 * client that walked the rungs itself would be re-deriving it into a second
 * opinion.
 */
export function speechAvailability(
	resolution: VoicePathResolution,
): SpeechAvailability {
	return {
		servable: resolution.servable,
		serving: resolution.path === "none" ? null : resolution.path,
		reason: resolution.reason,
		rungs: resolution.rungs.map((rung) => ({
			path: rung.path,
			name: speechPathName(rung.path),
			available: rung.available,
			reason: rung.reason,
		})),
	};
}
