import type { ThemePalette } from "./palette-contract";

/* The document's VALUES, not its ID, determine glass safety. A WeakMap keeps
 * isolated previews/documents separate and cannot outlive a closed document.
 * Authored identity palettes retain their already-validated fleet floor table. */
const palettes = new WeakMap<Document, ThemePalette>();
export const publishGlassPalette = (
	doc: Document,
	palette: ThemePalette | null,
): void => {
	if (palette) palettes.set(doc, palette);
	else palettes.delete(doc);
};
export const glassPaletteFor = (doc: Document): ThemePalette | undefined =>
	palettes.get(doc);
