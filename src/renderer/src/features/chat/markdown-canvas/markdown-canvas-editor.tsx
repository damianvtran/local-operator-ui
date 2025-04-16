import type { FC } from "react";
import { useCallback, useState } from "react";
import type { MarkdownDocument } from "./types";
import { markdown } from "@codemirror/lang-markdown";
import { basicLight } from "@uiw/codemirror-theme-basic";
import CodeMirror from "@uiw/react-codemirror";
import { Box } from "@mui/material";

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
    <Box
    id="HELP"
    sx={({typography}) => ( {
      flexGrow: 1,

      fontSize: typography.pxToRem(14),

      "& > *": {
        height: '100%'
      }
    } )}
    >
			<CodeMirror
				value={value}
				height="100%"
				theme={basicLight}
        editable={false}
				extensions={[markdown({})]}
				onChange={onChange}
			/>
      </Box>
	);
};
