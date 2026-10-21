export type VoiceDevice = "webgpu" | "wasm";
export type SpeedVerdict = "ok" | "too_slow";

type GpuNavigator = {
	gpu?: { requestAdapter(): Promise<unknown> };
};

/**
 * WebGPU only when an adapter really comes back: `navigator.gpu` can exist
 * while no adapter does, and a rejecting request is the same answer as none.
 */
export async function pickDevice(nav: GpuNavigator): Promise<VoiceDevice> {
	try {
		const adapter = await nav.gpu?.requestAdapter();
		return adapter ? "webgpu" : "wasm";
	} catch {
		return "wasm";
	}
}

/** The largest real-time factor (synthesis time / audio time) still "ok". */
export const MAX_REAL_TIME_FACTOR = 0.8;

export function speedVerdict(
	synthMs: number,
	audioSeconds: number,
): SpeedVerdict {
	if (!(audioSeconds > 0)) return "too_slow";
	return synthMs / 1000 / audioSeconds <= MAX_REAL_TIME_FACTOR
		? "ok"
		: "too_slow";
}
