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

// HTML to Markdown regex patterns
const H1_TAG_REGEX = /<h1[^>]*>(.*?)<\/h1>/gi;
const H2_TAG_REGEX = /<h2[^>]*>(.*?)<\/h2>/gi;
const H3_TAG_REGEX = /<h3[^>]*>(.*?)<\/h3>/gi;
const H4_TAG_REGEX = /<h4[^>]*>(.*?)<\/h4>/gi;
const H5_TAG_REGEX = /<h5[^>]*>(.*?)<\/h5>/gi;
const H6_TAG_REGEX = /<h6[^>]*>(.*?)<\/h6>/gi;
const STRONG_TAG_REGEX = /<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi;
const EM_TAG_REGEX = /<(em|i)[^>]*>(.*?)<\/(em|i)>/gi;
const DEL_TAG_REGEX = /<(del|s|strike)[^>]*>(.*?)<\/(del|s|strike)>/gi;
const U_TAG_REGEX = /<u[^>]*>(.*?)<\/u>/gi;
const CODE_TAG_REGEX = /<code[^>]*>(.*?)<\/code>/gi;
const PRE_CODE_TAG_REGEX = /<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis;
const A_TAG_REGEX = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
const IMG_WITH_ALT_REGEX = /<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi;
const IMG_WITHOUT_ALT_REGEX = /<img[^>]*src="([^"]*)"[^>]*\/?>/gi;
const BLOCKQUOTE_TAG_REGEX = /<blockquote[^>]*>(.*?)<\/blockquote>/gis;
const UL_TAG_REGEX = /<ul[^>]*>(.*?)<\/ul>/gis;
const OL_TAG_REGEX = /<ol[^>]*>(.*?)<\/ol>/gis;
const LI_TAG_REGEX = /<li[^>]*>(.*?)<\/li>/gis;
const TABLE_TAG_REGEX = /<table[^>]*>(.*?)<\/table>/gis;
const THEAD_TAG_REGEX = /<thead[^>]*>(.*?)<\/thead>/is;
const TR_TAG_REGEX = /<tr[^>]*>(.*?)<\/tr>/gis;
const TH_TAG_REGEX = /<th[^>]*>(.*?)<\/th>/gis;
const TH_REPLACE_REGEX = /<th[^>]*>(.*?)<\/th>/gi;
const TBODY_TAG_REGEX = /<tbody[^>]*>(.*?)<\/tbody>/is;
const TD_TAG_REGEX = /<td[^>]*>(.*?)<\/td>/gis;
const TD_REPLACE_REGEX = /<td[^>]*>(.*?)<\/td>/gi;
const P_TAG_REGEX = /<p[^>]*>(.*?)<\/p>/gis;
const BR_TAG_REGEX = /<br[^>]*\/?>/gi;
const MULTIPLE_NEWLINES_REGEX = /\n{3,}/g;
const TRIM_WHITESPACE_REGEX = /^\s+|\s+$/g;
const HTML_TAGS_REGEX = /<[^>]*>/g;
const HTML_LT_REGEX = /&lt;/g;
const HTML_GT_REGEX = /&gt;/g;
const HTML_AMP_REGEX = /&amp;/g;
const HTML_QUOT_REGEX = /&quot;/g;
const HTML_APOS_REGEX = /&#39;/g;

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

/**
 * Convert HTML from contentEditable div back to markdown
 * This handles the conversion from rich text back to markdown syntax
 */
export const htmlToMarkdown = (html: string): string => {
	let markdown = html;

	// Convert headers
	markdown = markdown.replace(H1_TAG_REGEX, '# $1\n\n');
	markdown = markdown.replace(H2_TAG_REGEX, '## $1\n\n');
	markdown = markdown.replace(H3_TAG_REGEX, '### $1\n\n');
	markdown = markdown.replace(H4_TAG_REGEX, '#### $1\n\n');
	markdown = markdown.replace(H5_TAG_REGEX, '##### $1\n\n');
	markdown = markdown.replace(H6_TAG_REGEX, '###### $1\n\n');

	// Convert bold
	markdown = markdown.replace(STRONG_TAG_REGEX, '**$2**');

	// Convert italic
	markdown = markdown.replace(EM_TAG_REGEX, '*$2*');

	// Convert strikethrough
	markdown = markdown.replace(DEL_TAG_REGEX, '~~$2~~');

	// Convert underline (not standard markdown, but we'll use HTML)
	markdown = markdown.replace(U_TAG_REGEX, '<u>$1</u>');

	// Convert inline code
	markdown = markdown.replace(CODE_TAG_REGEX, '`$1`');

	// Convert code blocks
	markdown = markdown.replace(PRE_CODE_TAG_REGEX, '```\n$1\n```\n\n');

	// Convert links
	markdown = markdown.replace(A_TAG_REGEX, '[$2]($1)');

	// Convert images
	markdown = markdown.replace(IMG_WITH_ALT_REGEX, '![$2]($1)');
	markdown = markdown.replace(IMG_WITHOUT_ALT_REGEX, '![]($1)');

	// Convert blockquotes
	markdown = markdown.replace(BLOCKQUOTE_TAG_REGEX, '> $1\n\n');

	// Convert unordered lists
	markdown = markdown.replace(UL_TAG_REGEX, (_, content) => {
		const items = content.replace(LI_TAG_REGEX, '- $1\n');
		return `${items}\n`;
	});

	// Convert ordered lists
	markdown = markdown.replace(OL_TAG_REGEX, (_, content) => {
		let counter = 1;
		const items = content.replace(LI_TAG_REGEX, (_, item) => {
			return `${counter++}. ${item}\n`;
		});
		return `${items}\n`;
	});

	// Convert tables
	markdown = markdown.replace(TABLE_TAG_REGEX, (_, content) => {
		let tableMarkdown = '';
		
		// Extract header
		const headerMatch = content.match(THEAD_TAG_REGEX);
		if (headerMatch) {
			const headerRow = headerMatch[1].replace(TR_TAG_REGEX, '$1');
			const headers = headerRow.match(TH_TAG_REGEX);
			if (headers) {
				const headerText = headers.map(h => h.replace(TH_REPLACE_REGEX, '$1')).join(' | ');
				const separator = headers.map(() => '---').join(' | ');
				tableMarkdown = `${tableMarkdown}| ${headerText} |\n| ${separator} |\n`;
			}
		}

		// Extract body
		const bodyMatch = content.match(TBODY_TAG_REGEX);
		if (bodyMatch) {
			const rows = bodyMatch[1].match(TR_TAG_REGEX);
			if (rows) {
				for (const row of rows) {
					const cells = row.match(TD_TAG_REGEX);
					if (cells) {
						const cellText = cells.map(c => c.replace(TD_REPLACE_REGEX, '$1')).join(' | ');
						tableMarkdown = `${tableMarkdown}| ${cellText} |\n`;
					}
				}
			}
		}

		return `${tableMarkdown}\n`;
	});

	// Convert paragraphs
	markdown = markdown.replace(P_TAG_REGEX, '$1\n\n');

	// Convert line breaks
	markdown = markdown.replace(BR_TAG_REGEX, '\n');

	// Clean up extra whitespace
	markdown = markdown.replace(MULTIPLE_NEWLINES_REGEX, '\n\n');
	markdown = markdown.replace(TRIM_WHITESPACE_REGEX, '');

	// Remove any remaining HTML tags
	markdown = markdown.replace(HTML_TAGS_REGEX, '');

	// Decode HTML entities
	markdown = markdown.replace(HTML_LT_REGEX, '<');
	markdown = markdown.replace(HTML_GT_REGEX, '>');
	markdown = markdown.replace(HTML_AMP_REGEX, '&');
	markdown = markdown.replace(HTML_QUOT_REGEX, '"');
	markdown = markdown.replace(HTML_APOS_REGEX, "'");

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
