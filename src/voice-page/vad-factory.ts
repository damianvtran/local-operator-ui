import { MicVAD } from "@ricky0123/vad-web";
import { VAD_ASSET_DIR } from "./vad-assets";
import { createMicVadFactory } from "./vad-mic";

/**
 * The real detector: vad-web's `MicVAD` over the page's microphone. The glue is
 * in `vad-mic.ts` (injectable, so it is tested); this binds it to the browser.
 *
 * Every asset is fetched from the page's own origin (`voice-page-vad/` beside
 * the html) because the page CSP allows nothing else.
 */
export const createVad = createMicVadFactory({
	MicVAD,
	mediaDevices: navigator.mediaDevices,
	assetBase: new URL(`./${VAD_ASSET_DIR}/`, window.location.href).href,
});
