import type { FC } from "react";
import { useCallback, useState } from "react";
import type { MarkdownDocument } from "./types";

import { markdown } from "@codemirror/lang-markdown";
import { basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror from "@uiw/react-codemirror";

type MarkdownCanvasContentProps = {
	/**
	 * The document to display
	 */
	document: MarkdownDocument;
};

/**
 * Content component for the markdown canvas
 * Displays the markdown content with syntax highlighting
 */
export const MarkdownCanvasReactContent: FC<MarkdownCanvasContentProps> = ({
	document,
}) => {
	const [value, setValue] = useState(document.content);

	const onChange = useCallback((val: string) => {
		setValue(val);
	}, []);

	return (
		<CodeMirror
			value={value}
			height="200px"
			extensions={[markdown({})]}
			theme={basicLight}
			onChange={onChange}
		/>
	);
};
