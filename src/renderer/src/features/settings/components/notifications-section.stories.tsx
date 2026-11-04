/**
 * Settings -> Notifications, in every state of the settings spec's §6 matrix.
 *
 * WHAT THESE FRAMES ARE FOR. The section makes claims a reader can only check
 * by looking: the off switch is first, nothing greys out when sound or
 * notifications are off (C2), the Default badge never truncates, the System
 * row has no preview, an upload error sits at the height of the row it
 * replaced, and the old-backend line replaces only the Sound group. Each state
 * gets its own story so a design round can look at every one.
 *
 * THE ROWS ARE THE REAL REGISTRY ROWS for `display.notifications` and its
 * session-name sibling (`scripts/fixtures/backend-settings-registry.json`); the
 * three `notifications.sound.*` rows and the listing are written here in the
 * daemon's own shapes (`settings_io.py` and `server/routes/notification_sounds.py`
 * on local-operator #3403), because the committed fixture predates them.
 *
 * NOTHING REACHES THE SPEAKERS. The preview path asks for audio through the
 * stubbed media bridge, which answers a refusal, so no story ever builds an
 * audible source; the "playing" frames are preset states, not playback. The
 * engine's zero-gain seam is still installed (`installAudioOutputGraph`) as the
 * belt the spec asks for, in case a reviewer clicks a preview by hand.
 *
 * Every story renders in the default theme; `?args=theme:rosePineDawn` and
 * `theme:tokyoNight` are the light/dark pair the spec names for the design
 * round (§6 "Themes").
 */

import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import { installAudioOutputGraph } from "@shared/store/audio-engine-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import fixtureJson from "../../../../../../scripts/fixtures/backend-settings-registry.json";
import type { NotificationSoundListPresets } from "./notification-sound-list";
import { NotificationsSection } from "./notifications-section";

type BridgeRequest = { op?: string };
type DesktopResponse = { status: number; body: unknown };

const REGISTRY = fixtureJson as BackendSettings;

/** The built-ins, in the daemon's catalog order, with their English labels. */
const BUILTINS = [
	["soft-pulse", "Soft pulse", 0.83],
	["two-note-chime", "Two-note chime", 0.87],
	["felt-marimba", "Felt marimba", 1.07],
	["hum-swell", "Hum swell", 1.46],
	["task-complete", "Task complete", 1.48],
	["signal-handshake", "Signal handshake", 0.505],
	["tape-warble", "Tape warble", 0.795],
	["glass-tap", "Glass tap", 0.9],
	["kalimba-pluck", "Kalimba pluck", 1.1],
	["bell-drift", "Bell drift", 1.6],
] as const;

type StoryState = {
	notificationsOn?: boolean;
	soundOn?: boolean;
	selected?: string;
	volume?: number;
	customCount?: number;
	/** A long custom name, for the narrow frame. */
	longNames?: boolean;
	backendOlder?: boolean;
	listingFails?: boolean;
	missingVolumeKey?: boolean;
	saveFails?: boolean;
	presets?: NotificationSoundListPresets;
	width?: number;
};

const CUSTOM_NAMES = [
	"Brass ping",
	"Door knock",
	"Studio bell",
	"Synth blip",
	"Wood block",
];

const customSounds = (count: number, longNames: boolean) =>
	Array.from({ length: count }, (_, index) => ({
		id: `custom-sound-${index + 1}-a1b2c3`,
		label: longNames
			? `${CUSTOM_NAMES[index % CUSTOM_NAMES.length]} recorded in the hallway at the old studio, take ${index + 1}`
			: count > CUSTOM_NAMES.length
				? `Sound ${index + 1}`
				: CUSTOM_NAMES[index],
		builtin: false,
		duration_s: 1 + (index % 4) * 0.6,
		is_default: false,
		source_name: `sound-${index + 1}.wav`,
		normalized: true,
		created_at: "2026-11-03T12:00:00Z",
	}));

/** The registry rows for the three sound keys, in `settings_io.py`'s shape. */
const soundRows = (state: StoryState) => {
	const base = {
		section: "notification_sound",
		help: "",
		minimum: null,
		maximum: null,
		members: [],
		empty_unsets: false,
		redacted: false,
		warning: "",
		placeholder: "",
		state_note: "",
		read_only: false,
		hotkey_scope: "",
		unit: "",
	};
	const rows = [
		{
			...base,
			key: "notifications.sound.enabled",
			label: "Notification sound",
			kind: "bool",
			value: state.soundOn ?? true,
			default: true,
			is_default: (state.soundOn ?? true) === true,
			choices: [],
			gated_by: "display.notifications",
		},
		{
			...base,
			key: "notifications.sound.id",
			label: "Sound",
			kind: "enum",
			value: state.selected ?? "soft-pulse",
			default: "soft-pulse",
			is_default: (state.selected ?? "soft-pulse") === "soft-pulse",
			choices: [],
			gated_by: "notifications.sound.enabled",
		},
		{
			...base,
			key: "notifications.sound.volume",
			label: "Volume",
			kind: "int",
			value: state.volume ?? 70,
			default: 70,
			is_default: (state.volume ?? 70) === 70,
			minimum: 0,
			maximum: 100,
			unit: "percent",
			choices: [],
			gated_by: "notifications.sound.enabled",
		},
	];
	return state.missingVolumeKey
		? rows.filter((row) => row.key !== "notifications.sound.volume")
		: rows;
};

const registryFor = (state: StoryState): BackendSettings => ({
	...REGISTRY,
	settings: [
		...REGISTRY.settings.map((row) =>
			row.key === "display.notifications"
				? {
						...row,
						value: state.notificationsOn ?? true,
						is_default: (state.notificationsOn ?? true) === true,
					}
				: row,
		),
		...soundRows(state),
	] as BackendSettings["settings"],
});

const listingFor = (state: StoryState) => ({
	sounds: [
		...BUILTINS.map(([id, label, duration]) => ({
			id,
			label,
			builtin: true,
			duration_s: duration,
			is_default: id === "soft-pulse",
		})),
		{
			id: "system",
			label: "System sound",
			builtin: true,
			duration_s: null,
			is_default: false,
		},
		...customSounds(state.customCount ?? 0, Boolean(state.longNames)),
	],
	selected: state.selected ?? "soft-pulse",
	enabled: state.soundOn ?? true,
	volume: state.volume ?? 70,
	limits: {
		max_sounds: 50,
		max_bytes: 10 * 1024 * 1024,
		max_duration_s: 10,
		max_name_chars: 40,
	},
});

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/** The bridge, rebuilt for each story's state (installed as the story renders). */
let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (state: StoryState) => {
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						settings: 1,
						auth: 1,
						catalogues: 1,
						...(state.backendOlder ? {} : { notification_sounds: 1 }),
					},
				});
			case "settings.list":
				return ok(registryFor(state));
			case "settings.edit":
				if (state.saveFails) {
					return {
						status: 503,
						body: {
							detail: {
								code: "setting_write_failed",
								text: "The settings file could not be written.",
							},
						},
					};
				}
				return ok({});
			case "notification_sounds.list":
				if (state.listingFails) {
					return {
						status: 503,
						body: {
							detail: {
								code: "store_failed",
								text: "The sound store could not be read.",
							},
						},
					};
				}
				return ok(listingFor(state));
			default:
				return {
					status: 404,
					body: { detail: { code: "not_implemented", message: request?.op } },
				};
		}
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			backend?: Record<string, unknown>;
			desktop?: {
				request: (r: BridgeRequest) => Promise<DesktopResponse>;
				media: () => Promise<unknown>;
			};
			sendTestNotification?: () => Promise<{ shown: boolean }>;
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.backend = {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	};
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
		// No audio ever leaves a story: every preview fetch is refused.
		media: async () => ({
			status: 404,
			kind: "error",
			detail: "Storybook serves no audio.",
		}),
	};
	// The test button renders only where main exists; the story stands in.
	api.sendTestNotification = async () => ({ shown: true });
	// Belt and braces: route the engine's element through a zero-gain graph.
	installAudioOutputGraph((element) => {
		try {
			const context = new AudioContext();
			const gain = context.createGain();
			gain.gain.value = 0;
			context.createMediaElementSource(element).connect(gain);
			gain.connect(context.destination);
		} catch {
			// No audio context in this host: nothing can play anyway.
		}
	});
}

const Section: FC<{ state: StoryState }> = ({ state }) => {
	installBridge(state);
	return (
		<div className="min-h-screen bg-canvas p-8">
			{/* `max-w-4xl` is the page's own content column (`settings-page.tsx`);
			    the narrow story pins the width the 1040px breakpoint leaves. */}
			<div
				className="mx-auto flex w-full max-w-4xl flex-col gap-8"
				style={state.width ? { maxWidth: state.width } : undefined}
			>
				<NotificationsSection listPresets={state.presets} />
			</div>
		</div>
	);
};

const meta: Meta<{ state: StoryState }> = {
	title: "Settings/Notifications",
	parameters: { layout: "fullscreen" },
	render: (args) => <Section state={args.state} />,
};
export default meta;

type Story = StoryObj<{ state: StoryState }>;

const FIRST_CUSTOM = "custom-sound-1-a1b2c3";

/** Default: Soft pulse selected and tagged Default; three custom sounds. */
export const Populated: Story = { args: { state: { customCount: 3 } } };

/** No custom sounds: the quiet empty row, Add, and the hint (§5.5). */
export const CustomEmpty: Story = { args: { state: { customCount: 0 } } };

/** Fifty custom sounds: Add is disabled and the limit is stated (§5.1). */
export const CustomFull: Story = { args: { state: { customCount: 50 } } };

/** Two files on their way in: one reading, one matching loudness (§5.1). */
export const Uploading: Story = {
	args: {
		state: {
			customCount: 2,
			presets: {
				initialPending: [
					{
						key: "upload-1",
						fileName: "office-chime.wav",
						stem: "office-chime",
						phase: "uploading",
						percent: 42,
					},
					{
						key: "upload-2",
						fileName: "desk-bell.flac",
						stem: "desk-bell",
						phase: "processing",
					},
				],
			},
		},
	},
};

const EXTENSION = /\.[^.]+$/;

const errorStory = (
	code: string | null,
	fileName: string,
	params?: Record<string, unknown>,
): Story => ({
	args: {
		state: {
			customCount: 2,
			presets: {
				initialPending: [
					{
						key: "upload-error",
						fileName,
						stem: fileName.replace(EXTENSION, ""),
						phase: "error",
						refusal: { code, params },
					},
				],
			},
		},
	},
});

/** `too_large` (413). */
export const UploadErrorTooLarge = errorStory(
	"too_large",
	"field-recording.wav",
);
/** `unsupported_format` (415), generic. */
export const UploadErrorUnsupported = errorStory(
	"unsupported_format",
	"ringtone.wma",
	{ format: "wma" },
);
/** `unsupported_format` with `params.format` = m4a: its own sentence. */
export const UploadErrorUnsupportedCodec = errorStory(
	"unsupported_format",
	"voice-memo.m4a",
	{ format: "m4a" },
);
/** `too_long` (422): refused, never trimmed (C10). */
export const UploadErrorTooLong = errorStory("too_long", "favourite-song.mp3", {
	seconds: "184.2",
});
/** `undecodable` (422). */
export const UploadErrorUndecodable = errorStory("undecodable", "notes.ogg");
/** `limit_reached` (422). */
export const UploadErrorLimit = errorStory("limit_reached", "one-more.wav");
/** Network / 5xx: Retry instead of Choose another file. */
export const UploadErrorNetwork = errorStory(null, "bell.flac");

/** Sound off: switch off, one status line, nothing greyed (C2). */
export const SoundOff: Story = {
	args: { state: { soundOn: false, customCount: 2 } },
};

/** Notifications off: the info notice with its remedy; controls stay usable. */
export const NotificationsOff: Story = {
	args: { state: { notificationsOn: false, customCount: 2 } },
};

/** System sound selected: no preview on its row; the slider says why it is off. */
export const SystemSelected: Story = {
	args: { state: { selected: "system", customCount: 2 } },
};

/** Volume 0: the muted icon and description (§4.2). */
export const VolumeZero: Story = {
	args: { state: { volume: 0, customCount: 2 } },
};

/** A non-default volume: the readout without "Default", and Reset (§4.1). */
export const VolumeCustom: Story = {
	args: { state: { volume: 45, customCount: 2 } },
};

/** The listing failed: the warning with Retry; switch and volume stay usable. */
export const LoadError: Story = {
	args: { state: { listingFails: true } },
};

/** No `features.notification_sounds`: the Sound group is one line. */
export const BackendOlder: Story = {
	args: { state: { backendOlder: true } },
};

/** A registry missing a sound key: named, not silently dropped. */
export const MissingKeys: Story = {
	args: { state: { missingVolumeKey: true, customCount: 1 } },
};

/** A preview playing: Stop in accent, `aria-pressed`. */
export const PreviewPlaying: Story = {
	args: {
		state: {
			customCount: 2,
			presets: { initialPreview: { id: "felt-marimba", state: "playing" } },
		},
	},
};

/** A preview fetching: the spinner holds the 44px box. */
export const PreviewLoading: Story = {
	args: {
		state: {
			customCount: 2,
			presets: { initialPreview: { id: FIRST_CUSTOM, state: "loading" } },
		},
	},
};

/** A preview that failed: the row says so until the next press. */
export const PreviewFailed: Story = {
	args: {
		state: {
			customCount: 2,
			presets: { initialPreview: { id: "two-note-chime", state: "failed" } },
		},
	},
};

/** The selection could not be saved: reverted, with Retry (§3.2). */
export const SaveFailed: Story = {
	args: {
		state: {
			customCount: 2,
			saveFails: true,
			presets: {
				initialSaveError: "The settings file could not be written.",
			},
		},
	},
};

/** Rename open on a custom row (§5.3). */
export const Renaming: Story = {
	args: {
		state: {
			customCount: 3,
			presets: {
				initialMode: {
					id: FIRST_CUSTOM,
					mode: { kind: "renaming", saving: false, error: null },
				},
			},
		},
	},
};

/** The inline remove confirm on a non-selected row (§5.4). */
export const RemoveConfirm: Story = {
	args: {
		state: {
			customCount: 3,
			presets: {
				initialMode: {
					id: FIRST_CUSTOM,
					mode: { kind: "confirm-remove", removing: false, error: null },
				},
			},
		},
	},
};

/** The confirm on the SELECTED row names the fallback before the act (C4). */
export const RemoveConfirmSelected: Story = {
	args: {
		state: {
			customCount: 3,
			selected: FIRST_CUSTOM,
			presets: {
				initialMode: {
					id: FIRST_CUSTOM,
					mode: { kind: "confirm-remove", removing: false, error: null },
				},
			},
		},
	},
};

/** ~560px content (48px rail at the 1040px breakpoint): truncation, no duration. */
export const Narrow: Story = {
	args: { state: { customCount: 3, longNames: true, width: 560 } },
};
