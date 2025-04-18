import { languageOverrideMap } from "@renderer/utils/load-language-extensions";
import { langs } from "@uiw/codemirror-extensions-langs";

export const canvasSupportedExtensions = new Set([
	...Object.keys(langs),
	...Object.keys(languageOverrideMap),
]);
