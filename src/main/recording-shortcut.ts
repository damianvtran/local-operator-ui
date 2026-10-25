import type { DesktopResponse } from "../shared/desktop-contract";
import {
	type ChordClaim,
	DEFAULT_START_RECORDING_VALUE,
	type RecordingShortcutInput,
	type RecordingShortcutState,
	START_RECORDING_SETTING_KEY,
	canonicalRecordingChord,
	recordingConflictVariants,
	recordingShortcutMatches,
} from "../shared/recording-shortcut";
import { readKeymapValue } from "./local-config";

/** One backend value plus renderer claims; no second persisted preference. */
export class RecordingShortcutCoordinator {
	private value = DEFAULT_START_RECORDING_VALUE;
	private canonical = canonicalRecordingChord(this.value) as string;
	private problem: string | undefined;
	private pending: string | undefined;
	private claims = new Map<string, string>();
	private rev = 0;
	private lastProblem: string | undefined;
	private lastShadow: string | undefined;
	private listeners = new Set<(state: RecordingShortcutState) => void>();
	private env: NodeJS.ProcessEnv;
	private platform: NodeJS.Platform | string;
	private onProblem: (message: string) => void;

	constructor(
		env: NodeJS.ProcessEnv = process.env,
		platform: NodeJS.Platform | string = process.platform,
		onProblem: (message: string) => void = () => {},
	) {
		this.env = env;
		this.platform = platform;
		this.onProblem = onProblem;
		this.canonical =
			canonicalRecordingChord(DEFAULT_START_RECORDING_VALUE, platform) ??
			DEFAULT_START_RECORDING_VALUE;
		this.refresh();
	}

	private emit(): void {
		const state = this.getState();
		for (const listener of this.listeners) listener(state);
	}

	refresh(): void {
		const reading = readKeymapValue(START_RECORDING_SETTING_KEY, this.env);
		this.problem = reading.problem;
		if (reading.problem !== undefined) {
			// Keep dispatch on the last good value through read, YAML and grammar
			// failures. Log once per distinct problem, not once per keypress.
			if (reading.problem !== this.lastProblem) {
				this.lastProblem = reading.problem;
				this.onProblem(reading.problem);
			}
		} else {
			this.lastProblem = undefined;
			const candidate = reading.present
				? canonicalRecordingChord(reading.value, this.platform)
				: canonicalRecordingChord(DEFAULT_START_RECORDING_VALUE, this.platform);
			if (candidate !== null) {
				this.canonical = candidate;
				this.value = reading.present
					? reading.value.trim()
					: DEFAULT_START_RECORDING_VALUE;
			} else if (reading.present) {
				this.problem = `config.yml carries an invalid recording shortcut: ${reading.value}`;
				if (this.problem !== this.lastProblem) {
					this.lastProblem = this.problem;
					this.onProblem(this.problem);
				}
			}
		}
		this.pending = undefined;
		this.emit();
	}

	setClaims(rev: number, claims: unknown): boolean {
		// IPC input is untrusted: validate the container and every member before
		// reading a property so malformed renderer messages cannot crash main.
		if (
			!Number.isSafeInteger(rev) ||
			rev <= this.rev ||
			!Array.isArray(claims) ||
			claims.length > 128 ||
			claims.some(
				(claim: unknown) =>
					claim === null ||
					typeof claim !== "object" ||
					typeof (claim as ChordClaim).chord !== "string" ||
					typeof (claim as ChordClaim).label !== "string" ||
					canonicalRecordingChord(
						(claim as ChordClaim).chord,
						this.platform,
					) !== (claim as ChordClaim).chord,
			)
		) {
			return false;
		}
		this.rev = rev;
		this.claims = new Map(
			(claims as ChordClaim[]).flatMap((claim) =>
				recordingConflictVariants(claim.chord, this.platform).map(
					(chord) => [chord, claim.label] as const,
				),
			),
		);
		this.emit();
		return true;
	}

	clearClaims(): void {
		this.rev = 0;
		this.claims.clear();
		this.emit();
	}

	admit(request: unknown): DesktopResponse | null {
		if (request === null || typeof request !== "object") return null;
		const candidate = request as {
			op?: unknown;
			key?: unknown;
			value?: unknown;
		};
		if (
			candidate.key !== START_RECORDING_SETTING_KEY ||
			(candidate.op !== "settings.edit" && candidate.op !== "settings.reset")
		) {
			return null;
		}
		const value =
			candidate.op === "settings.reset"
				? DEFAULT_START_RECORDING_VALUE
				: candidate.value;
		const label =
			typeof value === "string"
				? recordingConflictVariants(value, this.platform)
						.map((chord) => this.claims.get(chord))
						.find((claim) => claim !== undefined)
				: undefined;
		if (label === undefined) return null;
		return {
			status: 409,
			body: {
				status: 409,
				detail: {
					code: "keymap.conflict",
					label,
					text: `Start recording cannot use this shortcut: ${label}.`, // i18n: ignore main-process diagnostic; structured label drives localized renderer copy
				},
			},
		};
	}

	markPending(value?: string): void {
		this.pending = value;
		this.emit();
	}

	private shadowedBy(canonical = this.canonical): string | undefined {
		const label = this.claims.get(canonical);
		if (label === undefined) {
			this.lastShadow = undefined;
			return undefined;
		}
		if (label !== this.lastShadow) {
			this.lastShadow = label;
			this.onProblem(
				`Start recording is inactive: ${label} uses this shortcut.`,
			);
		}
		return label;
	}

	matches(input: RecordingShortcutInput): boolean {
		if (this.shadowedBy() !== undefined) return false;
		return recordingShortcutMatches(this.value, input, this.platform);
	}

	getState(): RecordingShortcutState {
		return {
			value: this.value,
			canonical: this.canonical,
			problem: this.problem,
			pending: this.pending,
			shadowedBy: this.shadowedBy(),
		};
	}

	onChange(listener: (state: RecordingShortcutState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
