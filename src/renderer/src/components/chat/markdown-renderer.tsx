import type { FC } from 'react';
import { Box } from '@mui/material';
import { styled } from '@mui/material/styles';

type MarkdownRendererProps = {
  content: string;
}

const MarkdownContent = styled(Box)({
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
  lineHeight: 1.6,
  fontSize: '1.05rem',
  '& code': {
    fontFamily: '"Roboto Mono", monospace',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: '3px 6px',
    borderRadius: '4px',
    fontSize: '0.85em',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: '#e6e6e6'
  },
  '& pre': {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    padding: '16px',
    borderRadius: '8px',
    overflowX: 'auto',
    fontFamily: '"Roboto Mono", monospace',
    fontSize: '0.85em',
    margin: '12px 0',
    maxWidth: '100%',
    border: '1px solid rgba(255, 255, 255, 0.1)'
  },
  '& pre code': {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: 'transparent',
    padding: 0,
    borderRadius: 0
  },
  '& h1': {
    fontSize: '1.5rem',
    fontWeight: 600,
    margin: '20px 0 12px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    paddingBottom: '8px'
  },
  '& h2': {
    fontSize: '1.3rem',
    fontWeight: 600,
    margin: '18px 0 10px 0'
  },
  '& h3': {
    fontSize: '1.1rem',
    fontWeight: 600,
    margin: '16px 0 8px 0'
  },
  '& ul': {
    paddingLeft: '24px',
    margin: '10px 0'
  },
  '& li': {
    margin: '4px 0'
  },
  '& a': {
    color: '#90caf9',
    textDecoration: 'none',
    borderBottom: '1px dotted rgba(144, 202, 249, 0.5)',
    transition: 'all 0.2s ease',
    '&:hover': {
      textDecoration: 'none',
      borderBottom: '1px solid #90caf9',
      color: '#bbdefb'
    }
  },
  '& strong': {
    fontWeight: 600,
    color: '#e6e6e6'
  },
  '& em': {
    fontStyle: 'italic',
    color: '#e0e0e0'
  },
  '& br': {
    display: 'block',
    content: '""',
    marginTop: '8px'
  }
});

/**
 * Parses markdown text into HTML
 * @param text - The markdown text to parse
 * @returns Parsed HTML string
 */
export const parseMarkdown = (text: string): string => {
  if (!text) {
    return '';
  }

  // Replace code blocks
  let parsedText = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Replace inline code
  parsedText = parsedText.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Replace headings
  parsedText = parsedText.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  parsedText = parsedText.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  parsedText = parsedText.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  
  // Replace bold and italic
  parsedText = parsedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  parsedText = parsedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  // Process nested lists with proper indentation
  // First, identify list items with their indentation level
  const lines = parsedText.split('\n');
  let inList = false;
  let listHtml = '';
  const processedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^(\s*)- (.*$)/);
    const numberedMatch = line.match(/^(\s*)(\d+)\. (.*$)/);
    
    if (bulletMatch || numberedMatch) {
      if (!inList) {
        inList = true;
        listHtml = '';
      }
      
      const indent = bulletMatch ? bulletMatch[1].length : (numberedMatch ? numberedMatch[1].length : 0);
      const content = bulletMatch ? bulletMatch[2] : (numberedMatch ? numberedMatch[3] : '');
      
      // Add the list item with proper indentation
      listHtml += `<li data-indent="${indent}">${content}</li>`;
      
      // Check if this is the last list item
      const nextLine = i < lines.length - 1 ? lines[i + 1] : '';
      const nextIsListItem = nextLine.match(/^\s*(-|\d+\.) /);
      
      if (!nextIsListItem && inList) {
        // Process the accumulated list HTML with proper nesting
        const processedList = processNestedList(listHtml);
        processedLines.push(processedList);
        inList = false;
      }
    } else if (inList) {
      // End of list
      const processedList = processNestedList(listHtml);
      processedLines.push(processedList);
      inList = false;
      processedLines.push(line);
    } else {
      processedLines.push(line);
    }
  }
  
  // If we're still in a list at the end, process it
  if (inList) {
    const processedList = processNestedList(listHtml);
    processedLines.push(processedList);
  }
  
  parsedText = processedLines.join('\n');
  
  // Replace links
  parsedText = parsedText.replace(
    /\[(.*?)\]\((.*?)\)/g, 
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  
  // Replace line breaks
  parsedText = parsedText.replace(/\n/g, '<br />');
  
  return parsedText;
};

/**
 * Processes list items with indentation into properly nested HTML lists
 * @param listHtml - HTML string containing list items with data-indent attributes
 * @returns Properly nested HTML list
 */
const processNestedList = (listHtml: string): string => {
  // Parse the list items
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${listHtml}</div>`, 'text/html');
  const items = Array.from(doc.querySelectorAll('li'));
  
  if (items.length === 0) return '';
  
  // Determine if the list is ordered or unordered based on the first item
  const firstItem = items[0];
  const isOrdered = !firstItem.textContent?.trim().startsWith('-');
  
  // Build the nested list structure
  const rootList = document.createElement(isOrdered ? 'ol' : 'ul');
  const listStack = [{ element: rootList, indent: -1 }];
  for (const item of items) {
    const indent = Number.parseInt(item.getAttribute('data-indent') || '0', 10);
    item.removeAttribute('data-indent');
    
    // Find the appropriate parent list based on indentation
    while (listStack.length > 1 && listStack[listStack.length - 1].indent >= indent) {
      listStack.pop();
    }
    
    const currentParent = listStack[listStack.length - 1].element;
    
    // Check if this item starts a new sublist
    const nextItem = items[items.indexOf(item) + 1];
    const nextIndent = nextItem ? Number.parseInt(nextItem.getAttribute('data-indent') || '0', 10) : -1;
    
    if (nextIndent > indent) {
      // This item will contain a sublist
      currentParent.appendChild(item);
      
      // Determine if the next list is ordered or unordered
      const nextIsOrdered = nextItem.textContent?.trim().match(/^\d+\./);
      const subList = document.createElement(nextIsOrdered ? 'ol' : 'ul');
      item.appendChild(subList);
      
      listStack.push({ element: subList, indent });
    } else {
      // Regular list item
      currentParent.appendChild(item);
    }
  }

  return rootList.outerHTML;
};

/**
 * Component for rendering markdown content with styled HTML
 */
export const MarkdownRenderer: FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <MarkdownContent 
      // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
    />
  );
};

export default MarkdownRenderer;
