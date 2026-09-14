const FILE_EXTENSION_REGEX = /\.([a-zA-Z0-9]+)$/;
const PATH_SLASH_REGEX = /[\\/]/;

/**
 * Predicts the programming language for syntax highlighting based on a file extension.
 *
 * This utility is intended for use with the CodeBlock component to provide the correct
 * language prop for syntax highlighting. If the extension is unknown, returns "plaintext".
 *
 * @param filename - The name of the file (can be a path or just the filename)
 * @returns The predicted language string for syntax highlighting
 *
 * @example
 *   getLanguageFromExtension("script.py") // returns "python"
 *   getLanguageFromExtension("main.cpp") // returns "cpp"
 *   getLanguageFromExtension("README.md") // returns "markdown"
 *   getLanguageFromExtension("unknownfile.abc") // returns "plaintext"
 */
export const getLanguageFromExtension = (filename: string): string => {
	if (typeof filename !== "string" || filename.trim() === "") {
		return "plaintext";
	}

	// Extract extension (case-insensitive)
	const match = filename.match(FILE_EXTENSION_REGEX);
	if (!match) {
		return "plaintext";
	}
	const ext = match[1].toLowerCase();

	// Map of common file extensions to highlight.js language names
	const extensionToLanguage: Record<string, string> = {
		js: "javascript",
		jsx: "jsx",
		ts: "typescript",
		tsx: "tsx",
		py: "python",
		pyw: "python",
		rb: "ruby",
		java: "java",
		c: "c",
		h: "c",
		cpp: "cpp",
		cxx: "cpp",
		cc: "cpp",
		hpp: "cpp",
		cs: "csharp",
		go: "go",
		php: "php",
		html: "xml",
		htm: "xml",
		xml: "xml",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		md: "markdown",
		markdown: "markdown",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		bat: "dos",
		ps1: "powershell",
		swift: "swift",
		kt: "kotlin",
		kts: "kotlin",
		rs: "rust",
		scala: "scala",
		sql: "sql",
		css: "css",
		scss: "scss",
		less: "less",
		dockerfile: "dockerfile",
		makefile: "makefile",
		ini: "ini",
		toml: "toml",
		conf: "ini",
		env: "ini",
		dart: "dart",
		lua: "lua",
		perl: "perl",
		pl: "perl",
		r: "r",
		tex: "latex",
		latex: "latex",
		vue: "vue",
		svelte: "svelte",
		groovy: "groovy",
		gradle: "groovy",
		coffee: "coffeescript",
		sc: "scala",
		vb: "vbnet",
		asm: "armasm",
		sol: "solidity",
		// Add more as needed
	};

	// Special case for files named "Dockerfile" or "Makefile" (no extension)
	const base = filename.split(PATH_SLASH_REGEX).pop();
	if (base) {
		if (base.toLowerCase() === "dockerfile") return "dockerfile";
		if (base.toLowerCase() === "makefile") return "makefile";
	}

	return extensionToLanguage[ext] || "plaintext";
};
