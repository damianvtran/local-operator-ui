import type { FC } from "react";
import { memo, useState } from "react";
import { diagramEngine } from "./diagram-engine";
import { MermaidDiagram } from "./mermaid-diagram";
import { PeleDiagram } from "./pele-diagram";

type ChatDiagramProps = {
	chart: string;
	id?: string;
};

export const ChatDiagram: FC<ChatDiagramProps> = memo((props) => {
	const [engine] = useState(diagramEngine);
	return engine === "mermaid" ? (
		<MermaidDiagram {...props} />
	) : (
		<PeleDiagram {...props} />
	);
});
