import { join } from "node:path";
import type { QwenLocalPort } from "./qwen-voice";
import { appVoicePageUrl } from "./qwen-voice-page";

export type LocalProviderDeps = {
	/** `userData`. */
	userDataDir: string;
	rendererUrl: () => string;
	noticeAccepted: () => boolean;
	writeNoticeAccepted: () => void;
	fetch: typeof fetch;
};

/**
 * The local provider's seams for the coordinator. `voice-models` is imported
 * HERE and only inside the functions, so an app with voice off never loads it
 * (a test walks the main graph and pins that).
 */
export function createLocalProvider(deps: LocalProviderDeps): QwenLocalPort & {
	readModel(name: string): Promise<Uint8Array>;
} {
	const dir = join(deps.userDataDir, "voice-models");
	return {
		noticeAccepted: deps.noticeAccepted,
		acceptNotice: deps.writeNoticeAccepted,
		pageUrl: () => appVoicePageUrl(deps.rendererUrl()),
		async ensureModels(onProgress, signal) {
			const { ensureModels } = await import("./voice-models");
			await ensureModels({
				dir,
				fetch: deps.fetch,
				signal,
				onProgress: (p) => onProgress(p.total > 0 ? p.received / p.total : 0),
			});
		},
		async readModel(name) {
			const { readModel } = await import("./voice-models");
			return readModel(dir, name);
		},
	};
}
