/**
 * A scripted dictation surface for STORIES AND TESTS - never imported by the app.
 *
 * Why it exists: the composer's recording states are produced by the browser's
 * own recorder and by one transcription request, neither of which a storyboard
 * or a jsdom probe can supply. Faking them at this seam keeps the component
 * under test the SHIPPING one - its hook, its strip, its row heights - while the
 * two things it talks to (a microphone and the transcription relay) are the
 * fixture. What that means for the evidence is stated in the story file and in
 * the PR body: the frames show the real component's real states, over a fake
 * take.
 */

export type DictationTakeOutcome =
	/** The take transcribes to this sentence. */
	| { kind: "text"; text: string }
	/** The service answers with no speech in the take. */
	| { kind: "empty" }
	/** A transient upstream fault: the take is offered back. */
	| { kind: "transient-failure" }
	/** The request never answers, so the transcribing row stays up. */
	| { kind: "pending" };

type Restore = () => void;

const fakeStream = (): MediaStream =>
	({
		getTracks: () => [{ stop: () => {} }],
	}) as unknown as MediaStream;

class FixtureMediaRecorder {
	state: "inactive" | "recording" = "inactive";
	stream: MediaStream;
	ondataavailable: ((event: { data: Blob }) => void) | null = null;
	onstop: ((event: Event) => void) | null = null;

	constructor(stream: MediaStream) {
		this.stream = stream;
	}

	start() {
		this.state = "recording";
	}

	stop() {
		if (this.state === "inactive")
			throw new Error("InvalidStateError: the recorder is not recording");
		this.state = "inactive";
		/*
		 * The real recorder delivers its chunks asynchronously, so the fixture does
		 * too. A synchronous delivery would let a caller's own stop arm overwrite
		 * `onstop` after the take had already been read - a path the product never
		 * takes, in a fixture that is meant to be the product's shape.
		 */
		setTimeout(() => {
			this.ondataavailable?.({
				data: new Blob(["fixture-take"], { type: "audio/webm" }),
			});
			this.onstop?.(new Event("stop"));
		}, 30);
	}
}

/**
 * Install the fixture and return the restore that puts every global back.
 *
 * @param outcome - what the transcription request does with a take.
 */
export function installDictationFixture(
	outcome: DictationTakeOutcome,
): Restore {
	const bridge = window as unknown as {
		api?: { desktop?: Record<string, unknown> };
	};
	const scope = globalThis as unknown as {
		MediaRecorder?: unknown;
		navigator: Navigator;
	};
	const previousRecorder = scope.MediaRecorder;
	const previousDesktop = bridge.api?.desktop;
	const previousMediaDevices = scope.navigator.mediaDevices;

	Object.defineProperty(scope.navigator, "mediaDevices", {
		configurable: true,
		value: { getUserMedia: async () => fakeStream() },
	});
	scope.MediaRecorder = FixtureMediaRecorder as unknown as typeof MediaRecorder;
	if (bridge.api) {
		bridge.api.desktop = {
			...(previousDesktop ?? {}),
			media: async () => {
				if (outcome.kind === "pending") return new Promise(() => {});
				if (outcome.kind === "transient-failure")
					return {
						status: 503,
						kind: "error",
						detail: "the transcription service is briefly unavailable",
					};
				return {
					status: 200,
					kind: "json",
					body: {
						result: { text: outcome.kind === "text" ? outcome.text : "" },
					},
				};
			},
		};
	}

	return () => {
		scope.MediaRecorder = previousRecorder;
		if (bridge.api) bridge.api.desktop = previousDesktop;
		Object.defineProperty(scope.navigator, "mediaDevices", {
			configurable: true,
			value: previousMediaDevices,
		});
	};
}
