import type { FC } from "react";
import { memo, useCallback } from "react";
import { DiagramViewer } from "./diagram-viewer";
import {
	PELE_FONT_SIZE,
	PELE_THEME_STYLE,
	inlinePeleTheme,
} from "./pele-theme";

type PeleModule = typeof import("pele/lazy");

let peleModulePromise: Promise<PeleModule> | null = null;
let diagramCounter = 0;

const getPele = (): Promise<PeleModule> => {
	if (!peleModulePromise) {
		peleModulePromise = import("pele/lazy").catch((err) => {
			peleModulePromise = null;
			throw err;
		});
	}
	return peleModulePromise;
};

const resolveRole = (name: string): string =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const idPrefixFor = (id?: string): string => {
	diagramCounter += 1;
	const stem = (id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
	return `pele-${stem || "d"}-${diagramCounter}`;
};

export const renderPeleSvg = async (
	chart: string,
	id?: string,
): Promise<string> => {
	const pele = await getPele();
	await document.fonts?.ready;
	const { svg } = await pele.renderAsync(chart, {
		fontFamily: resolveRole("--font-sans"),
		fontFamilyMono: resolveRole("--font-mono"),
		fontSize: PELE_FONT_SIZE,
		idPrefix: idPrefixFor(id),
	});
	return svg;
};

const prepareExport = (svg: string): string =>
	inlinePeleTheme(svg, resolveRole);

type PeleDiagramProps = {
	chart: string;
	id?: string;
};

export const PeleDiagram: FC<PeleDiagramProps> = memo(({ chart, id }) => {
	const renderSvg = useCallback(
		(source: string, diagramId?: string) => renderPeleSvg(source, diagramId),
		[],
	);

	return (
		<DiagramViewer
			chart={chart}
			id={id}
			renderSvg={renderSvg}
			exportName="pele-diagram"
			diagramStyle={PELE_THEME_STYLE}
			inlineSvgClassName="[&_svg]:h-auto"
			prepareExport={prepareExport}
		/>
	);
});
