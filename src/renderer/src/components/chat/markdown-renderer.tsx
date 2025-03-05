import type { FC } from 'react';
import { Box } from '@mui/material';

type MarkdownRendererProps = {
  content: string;
}

// Simple markdown parser
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
  
  // Replace lists
  parsedText = parsedText.replace(/^\s*- (.*$)/gm, '<li>$1</li>');
  parsedText = parsedText.replace(/<li>(.*)<\/li>/g, '<ul><li>$1</li></ul>');
  
  // Replace links
  parsedText = parsedText.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Replace line breaks
  parsedText = parsedText.replace(/\n/g, '<br />');
  
  return parsedText;
};

export const MarkdownRenderer: FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <Box 
      // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
      sx={{
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        '& code': {
          fontFamily: 'monospace',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          padding: '2px 4px',
          borderRadius: '4px',
          fontSize: '0.9em',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        },
        '& pre': {
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          padding: '12px',
          borderRadius: '4px',
          overflowX: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.9em',
          margin: '8px 0',
          maxWidth: '100%'
        },
        '& pre code': {
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        },
        '& h1, & h2, & h3': {
          margin: '16px 0 8px 0'
        },
        '& ul': {
          paddingLeft: '20px',
          margin: '8px 0'
        },
        '& a': {
          color: 'primary.main',
          textDecoration: 'none',
          '&:hover': {
            textDecoration: 'underline'
          }
        }
      }}
    />
  );
};

export default MarkdownRenderer;
