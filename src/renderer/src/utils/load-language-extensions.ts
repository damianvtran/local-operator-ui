import { type LanguageName, langs } from "@uiw/codemirror-extensions-langs";
import type { Extension } from "@uiw/react-codemirror";

const languageCache = new Map<string, Extension>();

export function loadLanguageExtensions(fileName: string): Extension | null {
	const ext = fileName.toLowerCase().split("/").pop()?.split(".").pop();

	if (!ext) return null;

	const parsedExt: LanguageName = languageOverrideMap[ext] ?? ext;

	if (languageCache.get(parsedExt))
		return languageCache.get(parsedExt) as Extension;

	const loadedLanguage = langs[parsedExt]?.();

	if (!loadedLanguage) {
		console.warn(`No language extension found for: ${parsedExt}`);
		return null;
	}

	languageCache.set(parsedExt, loadedLanguage);

	return loadedLanguage;
}

/**
 * Override of the * language mapping for specific extensions
 * Link: https://github.com/uiwjs/react-codemirror/blob/master/extensions/langs/src/index.ts
 */
const languageOverrideMap: Record<string, LanguageName> = {
	bash: "shell",
	c: "cpp",
	cc: "cpp",
	cjs: "javascript",
	clj: "clojure",
	coffee: "coffeescript",
	cpp: "cpp",
	cxx: "cpp",
	docker: "dockerfile",
	erl: "erlang",
	f: "fortran",
	fish: "shell",
	go: "go",
	h: "cpp", // Header files (could be C or C++)
	hpp: "cpp",
	htm: "html",
	hxx: "cpp",
	js: "javascript",
	jsonc: "json",
	jsx: "jsx",
	kt: "kotlin",
	kts: "kotlin",
	less: "css",
	lua: "lua",
	md: "markdown",
	mjs: "javascript",
	mm: "objectiveCpp",
	objc: "objectiveC",
	pas: "pascal",
	phtml: "php",
	pl: "perl",
	py: "python",
	pyw: "python",
	rb: "ruby",
	rs: "rust",
	sass: "css",
	scss: "css",
	sh: "shell",
	svelte: "svelte",
	swift: "swift",
	ts: "typescript",
	tsx: "tsx",
	vbs: "vbscript",
	xhtml: "html",
	yaml: "yaml",
	yml: "yaml",
	zsh: "shell",
} as const;
