/**
 * Supertonic's text front end (local-voice plan S2), the tokenizer.json
 * normaliser written out: NFKD; whitespace runs -> one space; en/em dash -> "-";
 * drop everything outside the vocabulary; then one id per character
 * (WordLevel, 81 entries). No phonemizer.
 */
export type SupertonicVocab = Map<string, number>;

type TokenizerJson = { model: { vocab: Record<string, number> } };

export function parseSupertonicTokenizer(json: string): SupertonicVocab {
	const parsed = JSON.parse(json) as TokenizerJson;
	return new Map(Object.entries(parsed.model.vocab));
}

export function normalizeSupertonic(text: string): string {
	return text.normalize("NFKD").replace(/\s+/g, " ").replace(/[–—]/g, "-");
}

export function encodeSupertonic(
	vocab: SupertonicVocab,
	text: string,
): number[] {
	const ids: number[] = [];
	// Spread by code point so an astral character is one (dropped) unit.
	for (const char of normalizeSupertonic(text)) {
		const id = vocab.get(char);
		if (id !== undefined) ids.push(id);
	}
	return ids;
}
