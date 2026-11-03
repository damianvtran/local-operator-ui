/**
 * The wire between main and the hidden H.264 encoder window used by
 * `record_start {quality: "high"}` (design D15-D16, `docs/design/browser-recording.md`).
 *
 * Both sides import from here so a channel name or a message shape cannot be written
 * twice and drift: main (`src/main/browser/actions/recording-encoder-host.ts`), the
 * purpose-built preload (`src/preload/recording-encoder.ts`) and the encoder document
 * (`src/renderer/src/recording-encoder/main.ts`).
 *
 * TWO CHANNELS, ONE PER DIRECTION, AND NOTHING ELSE. The document has no general
 * `ipcRenderer`, no `sendSync` and no channel name in its own world: it gets `on` and
 * `send` for these two. Main pins every inbound message to the window it created, so
 * a message the document did not send (any other sender) is dropped.
 */

/** Main -> encoder document. */
export const RECORDING_ENCODER_CMD_CHANNEL = "recording-encoder:cmd" as const;
/** Encoder document -> main. */
export const RECORDING_ENCODER_EVT_CHANNEL = "recording-encoder:evt" as const;

/** Why `record_quality_unavailable` was refused (the wire values of its `why`). */
export type EncoderUnavailableWhy =
	| "no_h264_encoder"
	| "software_over_1080p"
	| "size_unsupported"
	| "encoder_start";

/** What an encoder was configured to be. */
export interface EncoderConfigRequest {
	id: number;
	/** Even coded size: H.264 chroma planes are half resolution. */
	width: number;
	height: number;
	/** Target bitrate in bits per second. */
	bitrate: number;
	fps: number;
	/** Whether a software encoder may be used at this size. Hardware is always
	 * tried first; this only says whether the fallback is allowed (D19). */
	softwareAllowed: boolean;
	/** The key-frame interval in microseconds of media time. */
	keyIntervalUs: number;
}

export type EncoderCommand =
	| ({ cmd: "configure" } & EncoderConfigRequest)
	/** One screencast frame. `data` is the base64 PNG exactly as Chromium sent it:
	 * main never decodes it (the decode in main cost 54 % of a core at 4K). */
	| { cmd: "frame"; seq: number; data: string; ts: number }
	| { cmd: "flush"; id: number };

export type EncoderEvent =
	| { evt: "ready" }
	| {
			evt: "configured";
			id: number;
			ok: true;
			encoder: "hardware" | "software";
			codec: string;
			width: number;
			height: number;
	  }
	| {
			evt: "configured";
			id: number;
			ok: false;
			why: EncoderUnavailableWhy;
			detail: string;
	  }
	| {
			evt: "chunk";
			data: Uint8Array;
			ts: number;
			key: boolean;
			/** The `avcC` record: only on the first chunk. */
			description?: Uint8Array;
	  }
	| { evt: "frame-done"; seq: number }
	| { evt: "flushed"; id: number }
	| { evt: "error"; message: string };
