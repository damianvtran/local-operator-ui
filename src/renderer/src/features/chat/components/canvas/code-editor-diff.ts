import type { Range } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { EditDiff } from "@shared/api/local-operator/types";

const MONO_FAMILY = "var(--font-mono)";

const GLOBAL_WHITE_SPACE_REGEX = /\s+/g;
const SINGLE_WHITE_SPACE_REGEX = /\s/;

/**
 * One side of the proposed change: a heading and the affected text, both in
 * the semantic role for that side.
 *
 * The colours are `var(--color-*)` rather than resolved values. This widget is
 * raw DOM inside CodeMirror's content, so it cannot carry role *classes* — but
 * a variable is resolved by the browser at paint, which is what lets the
 * widget follow a theme swap without being rebuilt.
 */
const appendDiffBlock = (
	parent: HTMLElement,
	label: string,
	text: string,
	role: "danger" | "success",
) => {
	const heading = document.createElement("div");
	heading.textContent = label;
	/* 4px within a group, 8px between them: the wrapper's gap covers the first,
	   so only a second group needs the step up. */
	heading.style.marginTop = parent.hasChildNodes() ? "8px" : "0";
	heading.style.fontSize = "var(--text-meta)";
	heading.style.fontWeight = "600";
	heading.style.color = `var(--color-${role})`;
	parent.appendChild(heading);

	const code = document.createElement("div");
	code.textContent = text;
	code.style.backgroundColor = `var(--color-${role}-wash)`;
	code.style.color = `var(--color-${role})`;
	code.style.border = `1px solid var(--color-${role}-border)`;
	code.style.padding = "4px 6px";
	code.style.borderRadius = "var(--radius-sm)";
	code.style.whiteSpace = "pre-wrap";
	code.style.fontFamily = MONO_FAMILY;
	parent.appendChild(code);
};

class DiffWidget extends WidgetType {
	constructor(
		readonly oldText: string,
		readonly newText: string,
	) {
		super();
	}

	toDOM() {
		const container = document.createElement("div");
		container.style.display = "inline-block";
		container.style.minWidth = "200px";
		container.style.margin = "4px 0";
		container.style.transform = "translate(-12px, 12px)";
		container.style.padding = "8px";
		container.style.borderRadius = "var(--radius-md)";
		/* `elevated` plus the one overlay shadow, and no border: the widget
		   floats over the editor's `sunken` ground, so the ground step and the
		   shadow already separate it and the border it used to carry was a
		   third boundary saying the same thing. */
		container.style.backgroundColor = "var(--color-elevated)";
		container.style.boxShadow = "var(--shadow-overlay)";
		container.style.fontFamily = MONO_FAMILY;
		container.style.fontSize = "var(--text-mono)";

		const label = document.createElement("div");
		label.textContent = "Proposed change:";
		label.style.fontSize = "var(--text-meta)";
		label.style.fontWeight = "600";
		label.style.color = "var(--color-info)";
		label.style.marginBottom = "4px";
		container.appendChild(label);

		const diffWrapper = document.createElement("div");
		diffWrapper.style.display = "flex";
		diffWrapper.style.flexDirection = "column";
		diffWrapper.style.gap = "4px";

		if (this.oldText.trim()) {
			appendDiffBlock(diffWrapper, "- Remove:", this.oldText, "danger");
		}

		if (this.newText.trim()) {
			appendDiffBlock(diffWrapper, "+ Add:", this.newText, "success");
		}

		container.appendChild(diffWrapper);

		return container;
	}

	eq(other: DiffWidget) {
		return this.oldText === other.oldText && this.newText === other.newText;
	}
}

export const diffHighlight = (
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
					const normalizedFind = currentDiff.find
						.replace(GLOBAL_WHITE_SPACE_REGEX, " ")
						.trim();
					const normalizedDoc = docString.replace(
						GLOBAL_WHITE_SPACE_REGEX,
						" ",
					);
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
								if (normalizedDoc[normalizedCharCount] === " ") {
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
									if (
										normalizedDoc[normalizedIndex + normalizedCharCount] === " "
									) {
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
				if (startIndex === -1 && currentDiff.find.includes("\n")) {
					const findLines = currentDiff.find.split("\n");
					const docLines = docString.split("\n");

					// Look for the first line of the diff
					const firstLine = findLines[0].trim();
					if (firstLine) {
						for (let i = 0; i < docLines.length; i++) {
							if (docLines[i].trim() === firstLine) {
								// Calculate character position
								startIndex = docLines.slice(0, i).join("\n").length;
								if (i > 0) startIndex += 1; // Add newline character

								// Try to find end position by matching subsequent lines
								let matchedLines = 1;
								for (
									let j = 1;
									j < findLines.length && i + j < docLines.length;
									j++
								) {
									if (docLines[i + j].trim() === findLines[j].trim()) {
										matchedLines++;
									} else {
										break;
									}
								}

								if (matchedLines === findLines.length) {
									// Calculate end position
									endIndex = docLines
										.slice(0, i + matchedLines)
										.join("\n").length;
									break;
								}
							}
						}
					}
				}

				if (startIndex === -1 || endIndex === -1) {
					// If we still can't find the text, show a general highlight for the current diff
					console.warn(
						"Could not locate diff text in document:",
						currentDiff.find,
					);
					return Decoration.none;
				}

				// Ensure we don't go beyond document bounds
				startIndex = Math.max(0, Math.min(startIndex, docString.length));
				endIndex = Math.max(startIndex, Math.min(endIndex, docString.length));

				// Check if the diff contains line breaks
				if (
					currentDiff.find.includes("\n") ||
					currentDiff.replace.includes("\n")
				) {
					// For multi-line diffs, use mark decoration with a custom widget at the end
					const highlightMark = Decoration.mark({
						attributes: {
							style:
								"background-color: var(--color-info-wash); border-left: 3px solid var(--color-info); padding-left: 4px;",
						},
					});
					builder.push(highlightMark.range(startIndex, endIndex));

					// Add a widget at the end to show the replacement
					const infoWidget = Decoration.widget({
						widget: new DiffWidget(currentDiff.find, currentDiff.replace),
						side: 1, // Place after the content
					});
					builder.push(infoWidget.range(endIndex));
				} else {
					// For single-line diffs, use the widget replacement
					const widget = Decoration.replace({
						widget: new DiffWidget(currentDiff.find, currentDiff.replace),
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
