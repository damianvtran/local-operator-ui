import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import armasm from "react-syntax-highlighter/dist/esm/languages/hljs/armasm";
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash";
import c from "react-syntax-highlighter/dist/esm/languages/hljs/c";
import coffeescript from "react-syntax-highlighter/dist/esm/languages/hljs/coffeescript";
import cpp from "react-syntax-highlighter/dist/esm/languages/hljs/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/hljs/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/hljs/css";
import dart from "react-syntax-highlighter/dist/esm/languages/hljs/dart";
import dockerfile from "react-syntax-highlighter/dist/esm/languages/hljs/dockerfile";
import dos from "react-syntax-highlighter/dist/esm/languages/hljs/dos";
import go from "react-syntax-highlighter/dist/esm/languages/hljs/go";
import groovy from "react-syntax-highlighter/dist/esm/languages/hljs/groovy";
import ini from "react-syntax-highlighter/dist/esm/languages/hljs/ini";
import java from "react-syntax-highlighter/dist/esm/languages/hljs/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import kotlin from "react-syntax-highlighter/dist/esm/languages/hljs/kotlin";
import latex from "react-syntax-highlighter/dist/esm/languages/hljs/latex";
import less from "react-syntax-highlighter/dist/esm/languages/hljs/less";
import lua from "react-syntax-highlighter/dist/esm/languages/hljs/lua";
import makefile from "react-syntax-highlighter/dist/esm/languages/hljs/makefile";
import markdown from "react-syntax-highlighter/dist/esm/languages/hljs/markdown";
import perl from "react-syntax-highlighter/dist/esm/languages/hljs/perl";
import php from "react-syntax-highlighter/dist/esm/languages/hljs/php";
import plaintext from "react-syntax-highlighter/dist/esm/languages/hljs/plaintext";
import powershell from "react-syntax-highlighter/dist/esm/languages/hljs/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/hljs/python";
import r from "react-syntax-highlighter/dist/esm/languages/hljs/r";
import ruby from "react-syntax-highlighter/dist/esm/languages/hljs/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/hljs/rust";
import scala from "react-syntax-highlighter/dist/esm/languages/hljs/scala";
import scss from "react-syntax-highlighter/dist/esm/languages/hljs/scss";
import sql from "react-syntax-highlighter/dist/esm/languages/hljs/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/hljs/swift";
import typescript from "react-syntax-highlighter/dist/esm/languages/hljs/typescript";
import vbnet from "react-syntax-highlighter/dist/esm/languages/hljs/vbnet";
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml";
import yaml from "react-syntax-highlighter/dist/esm/languages/hljs/yaml";
// The package root pulls in highlight.js in full (~190 grammars, 1.7 MB). The
// light build registers nothing by default, so only the grammars below ship.
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/light";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";

/**
 * Props for the CodeBlock component
 */
export type CodeBlockProps = {
	code: string;
	isUser: boolean;
	language?: string;
	header?: string;
	flexDirection?: "column" | "column-reverse";
};

/**
 * Every grammar reachable from getLanguageFromExtension (@shared/utils/file-utils)
 * plus python, the fallback used when a code block declares no language.
 *
 * highlight.js registers each grammar's aliases alongside its canonical name, so
 * this list also covers the alias-only values that map produces: jsx/mjs/cjs via
 * javascript, ts/tsx via typescript, toml via ini, sh/zsh via bash, bat via dos,
 * md via markdown, html/svg via xml.
 *
 * Three of the map's values are deliberately absent. svelte and solidity have no
 * highlight.js grammar at all. vue is worse than absent: its module is not a
 * grammar but a call into highlightjs-vue, which imports the highlight.js root
 * and so drags all ~190 grammars back in - 1,468 kB measured, more than every
 * other grammar here combined.
 *
 * An unregistered language is not an error: react-syntax-highlighter falls back
 * to highlightAuto, so those files still get best-effort highlighting.
 */
const LANGUAGES = {
	armasm,
	bash,
	c,
	coffeescript,
	cpp,
	csharp,
	css,
	dart,
	dockerfile,
	dos,
	go,
	groovy,
	ini,
	java,
	javascript,
	json,
	kotlin,
	latex,
	less,
	lua,
	makefile,
	markdown,
	perl,
	php,
	plaintext,
	powershell,
	python,
	r,
	ruby,
	rust,
	scala,
	scss,
	sql,
	swift,
	typescript,
	vbnet,
	xml,
	yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
	SyntaxHighlighter.registerLanguage(name, definition);
}

/**
 * Component for displaying code with syntax highlighting
 *
 * @param code - The code string to display
 * @param isUser - Whether the code is from the user
 * @param language - Optional language for syntax highlighting
 * @param header - Optional header for the code block
 * @returns The rendered code block or null if no code is provided
 */
export const CodeBlock: FC<CodeBlockProps> = ({
	code,
	language,
	header,
	flexDirection = "column",
}) => {
	if (!code) return null;

	return (
		<div className="mb-4 w-full">
			<span className="mb-1 block text-ink-dim text-meta">
				{header || "Code"}
			</span>
			<div
				className={cn(
					"flex w-full whitespace-pre rounded-sm",
					"max-h-80 w-full overflow-y-auto",
					// atomOneDark sets a font-family on every token span, so the
					// override has to reach descendants with !important. Machine voice
					// is the app's mono (--font-mono), per the type contract.
					"[&_.react-syntax-highlighter-code-block_*]:font-mono!",
					flexDirection === "column-reverse" ? "flex-col-reverse" : "flex-col",
				)}
			>
				<SyntaxHighlighter
					language={language || "python"}
					style={atomOneDark}
					customStyle={{
						borderRadius: "6px",
						fontSize: "0.8125rem",
						width: "100%",
						padding: "0.75rem",
						margin: 0,
					}}
					className="react-syntax-highlighter-code-block"
					wrapLines={true}
					wrapLongLines={true}
				>
					{code}
				</SyntaxHighlighter>
			</div>
		</div>
	);
};
