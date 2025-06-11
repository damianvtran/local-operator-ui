/**
 * Utility functions for converting between HTML and Markdown in the WYSIWYG editor
 */

// Top-level regex patterns for performance
const CODE_BLOCK_REGEX = /```[\s\S]*?```/g;
const SCRIPT_TAG_REGEX = /<script[^>]*>.*?<\/script>/gis;
const STYLE_TAG_REGEX = /<style[^>]*>.*?<\/style>/gis;
const EVENT_HANDLER_REGEX = /on\w+="[^"]*"/gi;

// Markdown to HTML regex patterns
const HEADER_3_REGEX = /^### (.*$)/gim;
const HEADER_2_REGEX = /^## (.*$)/gim;
const HEADER_1_REGEX = /^# (.*$)/gim;
const BOLD_ASTERISK_REGEX = /\*\*(.*?)\*\*/g;
const BOLD_UNDERSCORE_REGEX = /__(.*?)__/g;
const ITALIC_ASTERISK_REGEX = /\*(.*?)\*/g;
const ITALIC_UNDERSCORE_REGEX = /_(.*?)_/g;
const STRIKETHROUGH_REGEX = /~~(.*?)~~/g;
const INLINE_CODE_REGEX = /`(.*?)`/g;
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;
const BLOCKQUOTE_REGEX = /^> (.*$)/gim;
const UNORDERED_LIST_BLOCK_REGEX = /((?:^[ \t]*[*-] .*(?:\n|$))+)/gm;
const ORDERED_LIST_BLOCK_REGEX = /((?:^[ \t]*\d+\. .*(?:\n|$))+)/gm;
const UNORDERED_LIST_DASH_REGEX = /^[ \t]*[*-] /g;
const ORDERED_LIST_DOT_REGEX = /^[ \t]*\d+\. /g;

/**
 * Convert markdown tables to HTML tables
 */
const convertMarkdownTablesToHtml = (text: string): string => {
	// Match markdown table pattern
	const tableRegex = /(?:^|\n)((?:\|[^\n]*\|(?:\n|$))+)/gm;
	
	return text.replace(tableRegex, (match, tableContent) => {
		const lines = tableContent.trim().split('\n').map(line => line.trim());
		
		if (lines.length < 2) return match;
		
		// Parse header row
		const headerRow = lines[0];
		if (!headerRow.startsWith('|') || !headerRow.endsWith('|')) return match;
		
		// Parse separator row (should contain dashes)
		const separatorRow = lines[1];
		if (!separatorRow.includes('---')) return match;
		
		// Extract headers
		const headers = headerRow
			.slice(1, -1) // Remove leading and trailing |
			.split('|')
			.map(cell => cell.trim());
		
		// Extract data rows
		const dataRows = lines.slice(2).map(line => {
			if (!line.startsWith('|') || !line.endsWith('|')) return null;
			return line
				.slice(1, -1) // Remove leading and trailing |
				.split('|')
				.map(cell => cell.trim());
		}).filter(row => row !== null);
		
		// Build HTML table
		let tableHtml = '<table>';
		
		// Add header
		if (headers.length > 0) {
			tableHtml += '<thead><tr>';
			for (const header of headers) {
				tableHtml += `<th>${header}</th>`;
			}
			tableHtml += '</tr></thead>';
		}
		
		// Add body
		if (dataRows.length > 0) {
			tableHtml += '<tbody>';
			for (const row of dataRows) {
				if (row) {
					tableHtml += '<tr>';
					for (const cell of row) {
						tableHtml += `<td>${cell}</td>`;
					}
					tableHtml += '</tr>';
				}
			}
			tableHtml += '</tbody>';
		}
		
		tableHtml += '</table>';
		
		return tableHtml;
	});
};

/**
 * Convert markdown to HTML for display in the contentEditable div
 * This is a simplified converter that handles basic markdown elements
 */
export const markdownToHtml = (markdown: string): string => {
	let html = markdown;

	// Convert headers
	html = html.replace(HEADER_3_REGEX, '<h3>$1</h3>');
	html = html.replace(HEADER_2_REGEX, '<h2>$1</h2>');
	html = html.replace(HEADER_1_REGEX, '<h1>$1</h1>');

	// Convert bold
	html = html.replace(BOLD_ASTERISK_REGEX, '<strong>$1</strong>');
	html = html.replace(BOLD_UNDERSCORE_REGEX, '<strong>$1</strong>');

	// Convert italic
	html = html.replace(ITALIC_ASTERISK_REGEX, '<em>$1</em>');
	html = html.replace(ITALIC_UNDERSCORE_REGEX, '<em>$1</em>');

	// Convert strikethrough
	html = html.replace(STRIKETHROUGH_REGEX, '<del>$1</del>');

	// Convert inline code
	html = html.replace(INLINE_CODE_REGEX, '<code>$1</code>');

	// Convert code blocks
	html = html.replace(CODE_BLOCK_REGEX, (match) => {
		const code = match.replace(/```/g, '').trim();
		return `<pre><code>${code}</code></pre>`;
	});

	// Convert images before links to avoid conflicts
	html = html.replace(
		IMAGE_REGEX,
		'<img src="$2" alt="$1" onerror="this.outerHTML = `<span>[Image: ${this.alt}]</span>`" />',
	);

	// Convert links
	html = html.replace(LINK_REGEX, '<a href="$2">$1</a>');

	// Convert tables
	html = convertMarkdownTablesToHtml(html);

	// Convert blockquotes
	html = html.replace(BLOCKQUOTE_REGEX, '<blockquote>$1</blockquote>');

	// Convert unordered lists
	html = html.replace(UNORDERED_LIST_BLOCK_REGEX, (match) => {
		const listItems = match
			.trim()
			.split('\n')
			.map((line) => `<li>${line.replace(UNORDERED_LIST_DASH_REGEX, '')}</li>`)
			.join('');
		return `<ul>${listItems}</ul>`;
	});

	// Convert ordered lists
	html = html.replace(ORDERED_LIST_BLOCK_REGEX, (match) => {
		const listItems = match
			.trim()
			.split('\n')
			.map((line) => `<li>${line.replace(ORDERED_LIST_DOT_REGEX, '')}</li>`)
			.join('');
		return `<ol>${listItems}</ol>`;
	});

	// Convert line breaks to paragraphs
	const paragraphs = html.split('\n\n').filter((p) => p.trim());
	html = paragraphs
		.map((p) => {
			const trimmed = p.trim();
			// Don't wrap if it's already a block element
			if (
				trimmed.startsWith('<h') ||
				trimmed.startsWith('<ul') ||
				trimmed.startsWith('<ol') ||
				trimmed.startsWith('<blockquote') ||
				trimmed.startsWith('<pre') ||
				trimmed.startsWith('<table')
			) {
				return trimmed;
			}
			return `<p>${trimmed}</p>`;
		})
		.join('');

	return html;
};

const domToMarkdown = (
	node: Node,
	listLevel = 0,
	isOrdered = false,
	itemIndex = 1,
): string => {
	if (node.nodeType === Node.TEXT_NODE) {
		return (node.textContent ?? "").replace(/&nbsp;/g, " ");
	}

	if (node.nodeType !== Node.ELEMENT_NODE) {
		return "";
	}

	const element = node as HTMLElement;
	let content = "";
	let childrenMarkdown = "";

	if (element.childNodes.length > 0) {
		for (const [index, child] of Array.from(element.childNodes).entries()) {
			childrenMarkdown += domToMarkdown(
				child,
				listLevel,
				isOrdered,
				index + 1,
			);
		}
	}

	const tagName = element.tagName.toLowerCase();

	switch (tagName) {
		case "h1":
			content = `# ${childrenMarkdown}\n\n`;
			break;
		case "h2":
			content = `## ${childrenMarkdown}\n\n`;
			break;
		case "h3":
			content = `### ${childrenMarkdown}\n\n`;
			break;
		case "h4":
			content = `#### ${childrenMarkdown}\n\n`;
			break;
		case "h5":
			content = `##### ${childrenMarkdown}\n\n`;
			break;
		case "h6":
			content = `###### ${childrenMarkdown}\n\n`;
			break;
		case "p":
			content = `${childrenMarkdown}\n\n`;
			break;
		case "div":
			content = `${childrenMarkdown}\n`;
			break;
		case "strong":
		case "b":
			if (childrenMarkdown.trim()) {
				content = `**${childrenMarkdown}**`;
			}
			break;
		case "em":
		case "i":
			if (childrenMarkdown.trim()) {
				content = `*${childrenMarkdown}*`;
			}
			break;
		case "del":
		case "s":
		case "strike":
			if (childrenMarkdown.trim()) {
				content = `~~${childrenMarkdown}~~`;
			}
			break;
		case "u":
			if (childrenMarkdown.trim()) {
				content = `<u>${childrenMarkdown}</u>`;
			}
			break;
		case "code":
			if (element.closest("pre")) {
				content = childrenMarkdown;
			} else {
				content = `\`${childrenMarkdown}\``;
			}
			break;
		case "pre":
			content = `\`\`\`\n${childrenMarkdown}\n\`\`\`\n\n`;
			break;
		case "a": {
			const href = element.getAttribute("href");
			if (href) {
				content = `[${childrenMarkdown}](${href})`;
			} else {
				content = childrenMarkdown;
			}
			break;
		}
		case "img": {
			const src = element.getAttribute("src");
			const alt = element.getAttribute("alt") ?? "";
			content = `![${alt}](${src})`;
			break;
		}
		case "blockquote":
			content = `> ${childrenMarkdown.trim().replace(/\n/g, "\n> ")}\n\n`;
			break;
		case "ul": {
			let listContent = "";
			for (const [index, child] of Array.from(
				element.childNodes,
			).entries()) {
				listContent += domToMarkdown(child, listLevel + 1, false, index + 1);
			}
			content = `${listContent}\n`;
			break;
		}
		case "ol": {
			let listContent = "";
			for (const [index, child] of Array.from(
				element.childNodes,
			).entries()) {
				listContent += domToMarkdown(child, listLevel + 1, true, index + 1);
			}
			content = `${listContent}\n`;
			break;
		}
		case "li": {
			const indent = "  ".repeat(listLevel > 0 ? listLevel - 1 : 0);
			if (isOrdered) {
				content = `${indent}${itemIndex}. ${childrenMarkdown.trim()}\n`;
			} else {
				content = `${indent}- ${childrenMarkdown.trim()}\n`;
			}
			break;
		}
		case "br":
			content = "\n";
			break;
		case "table": {
			let tableContent = "";
			const headerRow = element.querySelector("thead tr");
			if (headerRow) {
				const headers = Array.from(headerRow.querySelectorAll("th"))
					.map((th) => domToMarkdown(th).trim())
					.join(" | ");
				const separator = Array.from(headerRow.querySelectorAll("th"))
					.map(() => "---")
					.join(" | ");
				tableContent += `| ${headers} |\n| ${separator} |\n`;
			}
			const bodyRows = element.querySelectorAll("tbody tr");
			for (const row of Array.from(bodyRows)) {
				const cells = Array.from(row.querySelectorAll("td"))
					.map((td) => domToMarkdown(td).trim())
					.join(" | ");
				tableContent += `| ${cells} |\n`;
			}
			content = `\n${tableContent}\n`;
			break;
		}
		default:
			content = childrenMarkdown;
	}

	return content;
};

/**
 * Convert HTML from contentEditable div back to markdown
 * This handles the conversion from rich text back to markdown syntax
 */
export const htmlToMarkdown = (html: string): string => {
	if (typeof DOMParser === "undefined") {
		return ""; // Or fallback to a simpler regex-based conversion
	}

	const parser = new DOMParser();
	const doc = parser.parseFromString(html, "text/html");
	let markdown = domToMarkdown(doc.body);

	// Final cleanup
	markdown = markdown.replace(/\n{3,}/g, "\n\n");
	markdown = markdown.trim();

	return markdown;
};

/**
 * Clean HTML content to ensure it's safe and properly formatted
 */
export const cleanHtml = (inputHtml: string): string => {
	// Remove script tags and other potentially dangerous elements
	let cleanedHtml = inputHtml.replace(SCRIPT_TAG_REGEX, '');
	cleanedHtml = cleanedHtml.replace(STYLE_TAG_REGEX, '');
	cleanedHtml = cleanedHtml.replace(EVENT_HANDLER_REGEX, ''); // Remove event handlers
	
	return cleanedHtml;
};

/**
 * Get the current selection range in the editor
 */
export const getCurrentRange = (): Range | null => {
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		return selection.getRangeAt(0);
	}
	return null;
};

/**
 * Insert HTML at the current cursor position
 */
export const insertHtmlAtCursor = (html: string): void => {
	const range = getCurrentRange();
	if (range) {
		range.deleteContents();
		const fragment = range.createContextualFragment(html);
		range.insertNode(fragment);
		
		// Move cursor to end of inserted content
		range.collapse(false);
		const selection = window.getSelection();
		if (selection) {
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}
};

/**
 * Check if the current selection is within a specific element type
 */
export const isSelectionInElement = (tagName: string): boolean => {
	const selection = window.getSelection();
	if (!selection?.rangeCount) return false;

	const range = selection.getRangeAt(0);
	let element: Node | null = range.startContainer;
	
	if (element.nodeType === Node.TEXT_NODE) {
		element = element.parentElement;
	}

	while (element) {
		if ((element as Element).tagName?.toLowerCase() === tagName.toLowerCase()) {
			return true;
		}
		element = element.parentElement;
	}

	return false;
};
