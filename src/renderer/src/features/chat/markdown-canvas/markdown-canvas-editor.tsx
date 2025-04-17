import { markdown } from "@codemirror/lang-markdown";
import { Box } from "@mui/material";
import { basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror from "@uiw/react-codemirror";
import type { FC } from "react";
import { useCallback, useEffect, useState } from "react";
import type { MarkdownDocument } from "./types";

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
	const [value, setValue] = useState<MarkdownDocument | null>(document);

  useEffect(
    () => {
      if (document.id !== value?.id) {
        setValue(document)
      }
    },
      [document, value?.id]
  )

	return (
		<Box
			id="HELP"
			sx={({ typography }) => ({
				flexGrow: 1,

				fontSize: typography.pxToRem(14),

				"& > *": {
					height: "100%",
				},
			})}
		>
			<CodeMirror
				value={value?.content ?? ''}
				height="100%"
				theme={basicLight}
				editable={false}
				extensions={[markdown({})]}
			/>
		</Box>
	);
};
