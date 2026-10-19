import type { VadFactory } from "./vad";

/**
 * PLACEHOLDER until the packages step: `@ricky0123/vad-web` and
 * `onnxruntime-web` are not dependencies yet, so there is no detector to build.
 * It refuses loudly rather than pretending to listen. The step that adds the
 * packages replaces this body with `MicVAD.new({ ... })` over
 * `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
 *
 * DEFERRED (packages step): until then every `createVad()` rejects, so the
 * page's `vad.start()` rejection is caught and logged in `main.ts` rather than
 * left unhandled; the real factory will surface mic refusal the same way.
 */
export const createVad: VadFactory = async () => {
	throw new Error("voice page: no voice-activity detector is installed yet");
};
