/**
 * The voice page's own Content-Security-Policy (plan D2). Narrower than the
 * main renderer's: this document runs the VAD (an ONNX model on a WASM
 * runtime) and plays audio, and nothing else, so it may load its own scripts,
 * compile WASM, and talk to nothing but itself. The main renderer's policy
 * (`index.html`) is untouched.
 *
 * `html` carries the same string in a <meta>; a test pins that the two agree,
 * because a policy that exists in one place only is a policy the page does not
 * have.
 */
export const VOICE_PAGE_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:";
