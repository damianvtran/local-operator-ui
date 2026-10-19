import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { VAD_ASSETS, VAD_ASSET_DIR } from "../../src/voice-page/vad-assets";

/**
 * Absolute path of a `node_modules`-relative asset. Resolved from the project
 * root (where the build runs) rather than through `require.resolve`, because
 * onnxruntime-web's `exports` map does not expose `package.json`.
 */
function assetPath(from: string): string {
	return join(process.cwd(), "node_modules", from);
}

/**
 * Emits the voice page's detector assets (Silero model, worklet, ONE ORT WASM
 * variant) into `<renderer out>/voice-page-vad/`. They cannot be bundled: the
 * library fetches them by URL at run time. Dev serves the same files.
 */
export function voicePageVadPlugin(): Plugin {
	return {
		name: "voice-page-vad",
		generateBundle() {
			for (const { from, file } of VAD_ASSETS) {
				this.emitFile({
					type: "asset",
					fileName: `${VAD_ASSET_DIR}/${file}`,
					source: readFileSync(assetPath(from)),
				});
			}
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const prefix = `/${VAD_ASSET_DIR}/`;
				const url = (req.url ?? "").split("?")[0];
				const hit = url.startsWith(prefix)
					? VAD_ASSETS.find((a) => a.file === url.slice(prefix.length))
					: undefined;
				if (!hit) return next();
				res.setHeader(
					"Content-Type",
					hit.file.endsWith(".wasm")
						? "application/wasm"
						: hit.file.endsWith(".js") || hit.file.endsWith(".mjs")
							? "text/javascript"
							: "application/octet-stream",
				);
				res.end(readFileSync(assetPath(hit.from)));
			});
		},
	};
}
