/** The rate Silero VAD hands over and Groq downsamples to anyway (plan D2). */
export const WAV_SAMPLE_RATE = 16_000;

/**
 * Encode mono float samples (-1..1) as a 16-bit PCM WAV: a 44-byte RIFF header
 * and little-endian samples. Out-of-range samples clip rather than wrap, since a
 * wrapped sample is a loud click.
 */
export function encodeWav(
	samples: Float32Array,
	sampleRate: number = WAV_SAMPLE_RATE,
): Uint8Array {
	const dataBytes = samples.length * 2;
	const out = new Uint8Array(44 + dataBytes);
	const view = new DataView(out.buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i += 1)
			view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true); // PCM fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, "data");
	view.setUint32(40, dataBytes, true);
	for (let i = 0; i < samples.length; i += 1) {
		const clipped = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, Math.round(clipped * 32767), true);
	}
	return out;
}
