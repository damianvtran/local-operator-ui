export type DiagramEngine = "pele" | "mermaid";

export const DIAGRAM_ENGINE_STORAGE_KEY = "diagramEngine";

export const DEFAULT_DIAGRAM_ENGINE: DiagramEngine = "mermaid";

export function parseDiagramEngine(
	value: string | null | undefined,
): DiagramEngine | null {
	if (value === "pele" || value === "mermaid") return value;
	return null;
}

export function diagramEngine(): DiagramEngine {
	try {
		const local = parseDiagramEngine(
			window.localStorage.getItem(DIAGRAM_ENGINE_STORAGE_KEY),
		);
		if (local) return local;
	} catch {
		return buildDiagramEngine();
	}
	return buildDiagramEngine();
}

function buildDiagramEngine(): DiagramEngine {
	return (
		parseDiagramEngine(
			(import.meta as { env?: Record<string, string | undefined> }).env
				?.VITE_DIAGRAM_ENGINE,
		) ?? DEFAULT_DIAGRAM_ENGINE
	);
}
