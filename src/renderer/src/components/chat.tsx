import { useState, useRef, useEffect } from 'react';
import type { FC, FormEvent, ChangeEvent } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  TextField, 
  Button, 
  Avatar, 
  CircularProgress,
  IconButton,
  Divider
} from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faPaperPlane, 
  faPaperclip, 
  faRobot, 
  faUser
} from '@fortawesome/free-solid-svg-icons';

// Message types
type MessageRole = 'user' | 'assistant';

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  attachments?: string[]; // URLs to attachments
}

// Mock conversation data
// In a real app, this would come from the backend
const mockMessages: Message[] = [
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

// Simple markdown parser
const parseMarkdown = (text: string): string => {
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

interface ChatProps {
  conversationId: string;
}

const Chat: FC<ChatProps> = ({ conversationId }) => {
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Scroll to bottom of messages when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() && !selectedFile) return;
    
    // Create a new user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: newMessage,
      timestamp: new Date(),
      attachments: selectedFile ? [URL.createObjectURL(selectedFile)] : undefined
    };
    
    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);
    setNewMessage('');
    setSelectedFile(null);
    
    // Simulate sending message to backend and getting response
    setIsLoading(true);
    
    // Simulate API delay
    setTimeout(() => {
      // Create a mock response from the assistant
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I received your message: "${newMessage}"\n\nHow can I help you further?`,
        timestamp: new Date()
      };
      
      // Add assistant message to chat
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };
  
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };
  
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };
  
  return (
    <Paper 
      elevation={0} 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        flexGrow: 1,
        borderRadius: 0
      }}
    >
      {/* Chat header */}
      <Box sx={{ 
        p: 2, 
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center'
      }}>
        <Avatar 
          sx={{ 
            bgcolor: 'rgba(56, 201, 106, 0.2)',
            color: 'primary.main',
            mr: 2
          }}
        >
          <FontAwesomeIcon icon={faRobot} />
        </Avatar>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 500 }}>
            Local Operator
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Your on-device AI assistant
          </Typography>
        </Box>
      </Box>
      
      {/* Messages container */}
      <Box sx={{ 
        flexGrow: 1, 
        overflow: 'auto', 
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        '&::-webkit-scrollbar': {
          width: '8px',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
        },
      }}>
        {messages.map((message) => (
          <Box 
            key={message.id}
            sx={{ 
              display: 'flex',
              flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-start',
              gap: 2
            }}
          >
            <Avatar 
              sx={{ 
                bgcolor: message.role === 'user' 
                  ? 'primary.dark' 
                  : 'rgba(56, 201, 106, 0.2)',
                color: message.role === 'user' 
                  ? 'white' 
                  : 'primary.main'
              }}
            >
              <FontAwesomeIcon 
                icon={message.role === 'user' ? faUser : faRobot} 
                size="sm" 
              />
            </Avatar>
            
            <Box 
              sx={{ 
                maxWidth: '70%',
                bgcolor: message.role === 'user' 
                  ? 'primary.dark' 
                  : 'background.paper',
                p: 2,
                borderRadius: 2,
                border: message.role === 'assistant' 
                  ? '1px solid rgba(255, 255, 255, 0.1)' 
                  : 'none'
              }}
            >
              {/* Render attachments if any */}
              {message.attachments && message.attachments.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  {message.attachments.map((attachment) => (
                    <Box 
                      key={`${message.id}-${attachment}`} 
                      component="img" 
                      src={attachment}
                      alt="Attachment"
                      sx={{ 
                        maxWidth: '100%', 
                        maxHeight: 200, 
                        borderRadius: 1,
                        mb: 1
                      }}
                    />
                  ))}
                </Box>
              )}
              
              {/* Render message content with markdown support */}
              <Box 
                // biome-ignore lint/security/noDangerouslySetInnerHtml: <explanation>
                dangerouslySetInnerHTML={{ __html: parseMarkdown(message.content) }}
                sx={{
                  '& code': {
                    fontFamily: 'monospace',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    fontSize: '0.9em'
                  },
                  '& pre': {
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    padding: '12px',
                    borderRadius: '4px',
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.9em',
                    margin: '8px 0'
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
              
              {/* Message timestamp */}
              <Typography 
                variant="caption" 
                sx={{ 
                  display: 'block', 
                  mt: 1, 
                  textAlign: message.role === 'user' ? 'left' : 'right',
                  color: 'text.secondary',
                  fontSize: '0.7rem'
                }}
              >
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
            </Box>
          </Box>
        ))}
        
        {/* Loading indicator */}
        {isLoading && (
          <Box 
            sx={{ 
              display: 'flex',
              alignItems: 'center',
              gap: 2
            }}
          >
            <Avatar 
              sx={{ 
                bgcolor: 'rgba(56, 201, 106, 0.2)',
                color: 'primary.main'
              }}
            >
              <FontAwesomeIcon icon={faRobot} size="sm" />
            </Avatar>
            
            <Box 
              sx={{ 
                bgcolor: 'background.paper',
                p: 2,
                borderRadius: 2,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: 1
              }}
            >
              <CircularProgress size={16} color="primary" />
              <Typography variant="body2">
                Local Operator is thinking...
              </Typography>
            </Box>
          </Box>
        )}
        
        {/* Invisible element to scroll to */}
        <div ref={messagesEndRef} />
      </Box>
      
      <Divider sx={{ opacity: 0.1 }} />
      
      {/* Message input */}
      <Box 
        component="form" 
        onSubmit={handleSendMessage}
        sx={{ 
          p: 2, 
          display: 'flex', 
          alignItems: 'center',
          gap: 1
        }}
      >
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.pdf,.doc,.docx,.txt"
        />
        
        {/* Attachment button */}
        <IconButton 
          onClick={triggerFileInput}
          color="primary"
          sx={{ 
            bgcolor: 'rgba(255, 255, 255, 0.05)',
            '&:hover': {
              bgcolor: 'rgba(255, 255, 255, 0.1)'
            }
          }}
        >
          <FontAwesomeIcon icon={faPaperclip} />
        </IconButton>
        
        {/* Text input */}
        <TextField
          fullWidth
          placeholder="Type a message..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          multiline
          maxRows={4}
          variant="outlined"
          InputProps={{
            sx: {
              borderRadius: 2,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              '&.Mui-focused': {
                backgroundColor: 'rgba(255, 255, 255, 0.07)'
              }
            }
          }}
        />
        
        {/* Selected file preview */}
        {selectedFile && (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            bgcolor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 1,
            px: 1,
            py: 0.5
          }}>
            <Typography variant="caption" noWrap sx={{ maxWidth: 100 }}>
              {selectedFile.name}
            </Typography>
            <IconButton 
              size="small" 
              onClick={() => setSelectedFile(null)}
              sx={{ ml: 0.5 }}
            >
              &times;
            </IconButton>
          </Box>
        )}
        
        {/* Send button */}
        <Button
          type="submit"
          variant="contained"
          color="primary"
          disabled={isLoading || (!newMessage.trim() && !selectedFile)}
          sx={{ 
            borderRadius: 2,
            minWidth: 'auto',
            width: 40,
            height: 40,
            p: 0
          }}
        >
          <FontAwesomeIcon icon={faPaperPlane} />
        </Button>
      </Box>
    </Paper>
  );
};

export default Chat;
