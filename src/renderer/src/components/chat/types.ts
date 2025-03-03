// Message types
export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  attachments?: string[]; // URLs to attachments
}

// Mock conversation data
// In a real app, this would come from the backend
export const mockMessages: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I\'m Local Operator. How can I assist you today?',
    timestamp: new Date(Date.now() - 60000 * 10) // 10 minutes ago
  },
  {
    id: '2',
    role: 'user',
    content: 'Can you help me understand how to use markdown in messages?',
    timestamp: new Date(Date.now() - 60000 * 5) // 5 minutes ago
  },
  {
    id: '3',
    role: 'assistant',
    content: `Sure! You can use markdown formatting in your messages. Here are some examples:

**Bold text** is created with double asterisks.
*Italic text* is created with single asterisks.

# Heading 1
## Heading 2

- Bullet points
- Are created with hyphens

\`\`\`javascript
// Code blocks are created with triple backticks
function hello() {
  console.log("Hello, world!");
}
\`\`\`

You can also include [links](https://example.com).`,
    timestamp: new Date(Date.now() - 60000 * 4) // 4 minutes ago
  }
];
