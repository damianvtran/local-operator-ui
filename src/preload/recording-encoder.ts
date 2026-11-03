/**
 * The preload of the hidden H.264 encoder window (design D15): the only bridge
 * between that sandboxed document and main.
 *
 * THE SURFACE IS `on` AND `send`, ON PURPOSE. They carry the two channels in
 * `src/shared/recording-encoder.ts` and nothing else: no general `ipcRenderer`, no
 * channel name in the document's world and no `sendSync`. The document is the
 * app's own bundled page, loaded with navigation, permissions and popups denied,
 * so what this bridge exposes is the whole of what a compromised frame could say
 * to main: a chunk, a status or an error, each re-validated by main against the
 * window it created.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	type EncoderCommand,
	type EncoderEvent,
	RECORDING_ENCODER_CMD_CHANNEL,
	RECORDING_ENCODER_EVT_CHANNEL,
} from "../shared/recording-encoder";

const api = Object.freeze({
	/** Subscribe to main's commands. */
	on(callback: (message: EncoderCommand) => void): void {
		ipcRenderer.on(RECORDING_ENCODER_CMD_CHANNEL, (_event, message) =>
			callback(message as EncoderCommand),
		);
	},
	/** Report to main. */
	send(message: EncoderEvent): void {
		ipcRenderer.send(RECORDING_ENCODER_EVT_CHANNEL, message);
	},
});

contextBridge.exposeInMainWorld("recordingEncoder", api);
