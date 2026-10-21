/**
 * Moonshine's token decoder (local-voice plan S2). Decode only. It follows the
 * tokenizer's own decoder sequence: `▁` -> space, `<0xNN>` byte tokens joined
 * as UTF-8, and one leading space stripped. Special tokens are dropped.
 */
export type MoonshineVocab = {
	/** id -> token string. */
	tokens: Map<number, string>;
	special: Set<number>;
};

type TokenizerJson = {
	model: { vocab: Record<string, number> };
	added_tokens?: Array<{ id: number; content: string; special?: boolean }>;
};

export function parseMoonshineTokenizer(json: string): MoonshineVocab {
	const parsed = JSON.parse(json) as TokenizerJson;
	const tokens = new Map<number, string>();
	for (const [token, id] of Object.entries(parsed.model.vocab)) {
		tokens.set(id, token);
	}
	const special = new Set<number>();
	for (const added of parsed.added_tokens ?? []) {
		tokens.set(added.id, added.content);
		if (added.special) special.add(added.id);
	}
	return { tokens, special };
}

const BYTE_TOKEN = /^<0x([0-9A-Fa-f]{2})>$/;
const encoder = new TextEncoder();

export function decodeMoonshine(
	vocab: MoonshineVocab,
	ids: readonly number[],
): string {
	const bytes: number[] = [];
	for (const id of ids) {
		if (vocab.special.has(id)) continue;
		const token = vocab.tokens.get(id);
		if (token === undefined) continue;
		const byte = BYTE_TOKEN.exec(token);
		if (byte) {
			bytes.push(Number.parseInt(byte[1], 16));
		} else {
			for (const b of encoder.encode(token.replace(/▁/g, " "))) {
				bytes.push(b);
			}
		}
	}
	const text = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
	return text.startsWith(" ") ? text.slice(1) : text;
}
