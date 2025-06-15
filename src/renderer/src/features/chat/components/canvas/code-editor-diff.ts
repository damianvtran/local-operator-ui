import {
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import { alpha } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { EditDiff } from "@shared/api/local-operator/types";

const GLOBAL_WHITE_SPACE_REGEX = /\s+/g;
const SINGLE_WHITE_SPACE_REGEX = /\s/;

class DiffWidget extends WidgetType {
	constructor(
		readonly oldText: string,
		readonly newText: string,
		readonly theme: Theme,
	) {
		super();
	}

	toDOM() {
		const container = document.createElement("div");
		container.style.border = `1px solid ${this.theme.palette.divider}`;
		container.style.borderRadius = `${this.theme.shape.borderRadius}px`;
		container.style.padding = "8px";
		container.style.margin = "4px 0";
		container.style.fontFamily = "'Geist Mono', monospace";
		container.style.fontSize = "13px";
		container.style.backgroundColor = alpha(this.theme.palette.background.paper, 0.9);
		container.style.display = "inline-block";
		container.style.minWidth = "200px";

		// Add a label
		const label = document.createElement("div");
		label.textContent = "Proposed Change:";
		label.style.fontSize = "11px";
		label.style.fontWeight = "bold";
		label.style.color = this.theme.palette.info.main;
		label.style.marginBottom = "4px";
		container.appendChild(label);

		// Create a wrapper for the diff content
		const diffWrapper = document.createElement("div");
		diffWrapper.style.display = "flex";
		diffWrapper.style.flexDirection = "column";
		diffWrapper.style.gap = "4px";

		// Old text (what will be removed)
		if (this.oldText.trim()) {
			const oldLabel = document.createElement("div");
			oldLabel.textContent = "- Remove:";
			oldLabel.style.fontSize = "10px";
			oldLabel.style.color = this.theme.palette.error.main;
			oldLabel.style.fontWeight = "bold";
			diffWrapper.appendChild(oldLabel);

			const oldCode = document.createElement("div");
			oldCode.textContent = this.oldText;
			oldCode.style.backgroundColor = alpha(this.theme.palette.error.main, 0.2);
			oldCode.style.color = this.theme.palette.error.main;
			oldCode.style.textDecoration = "line-through";
			oldCode.style.padding = "4px 6px";
			oldCode.style.borderRadius = "4px";
			oldCode.style.whiteSpace = "pre-wrap";
			oldCode.style.border = `1px solid ${alpha(this.theme.palette.error.main, 0.5)}`;
			diffWrapper.appendChild(oldCode);
		}

		// New text (what will be added)
		if (this.newText.trim()) {
			const newLabel = document.createElement("div");
			newLabel.textContent = "+ Add:";
			newLabel.style.fontSize = "10px";
			newLabel.style.color = this.theme.palette.success.main;
			newLabel.style.fontWeight = "bold";
			newLabel.style.marginTop = "4px";
			diffWrapper.appendChild(newLabel);

			const newCode = document.createElement("div");
			newCode.textContent = this.newText;
			newCode.style.backgroundColor = alpha(this.theme.palette.success.main, 0.2);
			newCode.style.color = this.theme.palette.success.main;
			newCode.style.padding = "4px 6px";
			newCode.style.borderRadius = "4px";
			newCode.style.whiteSpace = "pre-wrap";
			newCode.style.border = `1px solid ${alpha(this.theme.palette.success.main, 0.5)}`;
			diffWrapper.appendChild(newCode);
		}

		container.appendChild(diffWrapper);

		return container;
	}

	eq(other: DiffWidget) {
		return this.oldText === other.oldText && this.newText === other.newText;
	}
}

export const diffHighlight = (
	theme: Theme,
	reviewState: {
		diffs: EditDiff[];
		currentIndex: number;
		originalContent: string;
	} | null,
) => {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: ViewUpdate["view"]) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.transactions.length > 0
				) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: ViewUpdate["view"]): DecorationSet {
				if (!reviewState) {
					return Decoration.none;
				}

				const builder: Range<Decoration>[] = [];
				const { diffs, currentIndex } = reviewState;

				if (currentIndex >= diffs.length) {
					return Decoration.none;
				}

				const currentDiff = diffs[currentIndex];
				const docString = view.state.doc.toString();

				// Try multiple strategies to find the text to highlight
				let startIndex = -1;
				let endIndex = -1;

				// Strategy 1: Exact match
				startIndex = docString.indexOf(currentDiff.find);
				if (startIndex !== -1) {
					endIndex = startIndex + currentDiff.find.length;
				} else {
					// Strategy 2: Try with normalized whitespace
					const normalizedFind = currentDiff.find.replace(GLOBAL_WHITE_SPACE_REGEX, ' ').trim();
					const normalizedDoc = docString.replace(GLOBAL_WHITE_SPACE_REGEX, ' ');
					const normalizedIndex = normalizedDoc.indexOf(normalizedFind);
					
					if (normalizedIndex !== -1) {
						// Find the actual position in the original document
						let normalizedCharCount = 0;
						
						for (let i = 0; i < docString.length; i++) {
							if (normalizedCharCount === normalizedIndex) {
								startIndex = i;
								break;
							}
							
							const char = docString[i];
							if (char.match(SINGLE_WHITE_SPACE_REGEX)) {
								if (normalizedDoc[normalizedCharCount] === ' ') {
									normalizedCharCount++;
								}
							} else {
								normalizedCharCount++;
							}
						}
						
						if (startIndex !== -1) {
							// Find end position
							normalizedCharCount = 0;
							
							for (let i = startIndex; i < docString.length; i++) {
								if (normalizedCharCount >= normalizedFind.length) {
									endIndex = i;
									break;
								}
								
								const char = docString[i];
								if (char.match(SINGLE_WHITE_SPACE_REGEX)) {
									if (normalizedDoc[normalizedIndex + normalizedCharCount] === ' ') {
										normalizedCharCount++;
									}
								} else {
									normalizedCharCount++;
								}
							}
							
							if (endIndex === -1) {
								endIndex = docString.length;
							}
						}
					}
				}

				// Strategy 3: Fallback - try to find by lines if it's a multi-line diff
				if (startIndex === -1 && currentDiff.find.includes('\n')) {
					const findLines = currentDiff.find.split('\n');
					const docLines = docString.split('\n');
					
					// Look for the first line of the diff
					const firstLine = findLines[0].trim();
					if (firstLine) {
						for (let i = 0; i < docLines.length; i++) {
							if (docLines[i].trim() === firstLine) {
								// Calculate character position
								startIndex = docLines.slice(0, i).join('\n').length;
								if (i > 0) startIndex += 1; // Add newline character
								
								// Try to find end position by matching subsequent lines
								let matchedLines = 1;
								for (let j = 1; j < findLines.length && i + j < docLines.length; j++) {
									if (docLines[i + j].trim() === findLines[j].trim()) {
										matchedLines++;
									} else {
										break;
									}
								}
								
								if (matchedLines === findLines.length) {
									// Calculate end position
									endIndex = docLines.slice(0, i + matchedLines).join('\n').length;
									break;
								}
							}
						}
					}
				}

				if (startIndex === -1 || endIndex === -1) {
					// If we still can't find the text, show a general highlight for the current diff
					console.warn('Could not locate diff text in document:', currentDiff.find);
					return Decoration.none;
				}

				// Ensure we don't go beyond document bounds
				startIndex = Math.max(0, Math.min(startIndex, docString.length));
				endIndex = Math.max(startIndex, Math.min(endIndex, docString.length));

				// Check if the diff contains line breaks
				if (currentDiff.find.includes('\n') || currentDiff.replace.includes('\n')) {
					// For multi-line diffs, use mark decoration with a custom widget at the end
					const highlightMark = Decoration.mark({
						attributes: {
							style: `background-color: ${alpha(
								theme.palette.info.main,
								0.3,
							)}; border-left: 3px solid ${theme.palette.info.main}; padding-left: 4px;`,
						},
					});
					builder.push(highlightMark.range(startIndex, endIndex));

					// Add a widget at the end to show the replacement
					const infoWidget = Decoration.widget({
						widget: new DiffWidget(
							currentDiff.find,
							currentDiff.replace,
							theme,
						),
						side: 1, // Place after the content
					});
					builder.push(infoWidget.range(endIndex));
				} else {
					// For single-line diffs, use the widget replacement
					const widget = Decoration.replace({
						widget: new DiffWidget(
							currentDiff.find,
							currentDiff.replace,
							theme,
						),
					});

					builder.push(widget.range(startIndex, endIndex));
				}

				return Decoration.set(builder);
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
};
