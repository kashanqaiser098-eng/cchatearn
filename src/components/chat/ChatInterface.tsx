import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { 
  Send, 
  Menu, 
  Copy, 
  RotateCcw, 
  Zap,
  Clock,
  Sparkles,
  User,
  Bot
} from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tokens_used?: number;
  response_time_ms?: number;
  created_at: string;
}

interface ChatInterfaceProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  conversationId: string | null;
}

export default function ChatInterface({ 
  isSidebarOpen, 
  onToggleSidebar, 
  conversationId 
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (conversationId) {
      fetchMessages();
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    fetchUserProfile();
  }, []);

  const fetchUserProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('reward_points')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      setUserPoints(data.reward_points);
    } catch (error: any) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchMessages = async () => {
    if (!conversationId) return;

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      // Type assertion for the role field
      const typedMessages = (data || []).map(msg => ({
        ...msg,
        role: msg.role as 'user' | 'assistant'
      }));
      
      setMessages(typedMessages);
    } catch (error: any) {
      console.error('Error fetching messages:', error);
      toast({
        title: "Error loading messages",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const sendMessage = async (boost = false) => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);
    setIsStreaming(true);

    // Add user message immediately
    const tempUserMessage: Message = {
      id: 'temp-user',
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMessage]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Add typing indicator
      const typingMessage: Message = {
        id: 'typing',
        role: 'assistant',
        content: '...',
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, typingMessage]);

      const chatMessages = [...messages, tempUserMessage].map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const response = await supabase.functions.invoke('chat-with-gemini', {
        body: { 
          messages: chatMessages,
          conversationId,
          boost
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to get AI response');
      }

      const { 
        response: aiResponse, 
        tokensUsed, 
        responseTime, 
        pointsEarned, 
        pointsSpent, 
        newStreak,
        totalPoints 
      } = response.data;

      // Remove typing indicator and add real response
      setMessages(prev => {
        const withoutTyping = prev.filter(msg => msg.id !== 'typing');
        return [...withoutTyping, {
          id: 'temp-ai',
          role: 'assistant',
          content: aiResponse,
          tokens_used: tokensUsed,
          response_time_ms: responseTime,
          created_at: new Date().toISOString(),
        }];
      });

      // Update user points
      setUserPoints(totalPoints);

      // Show success toast with rewards info
      let toastMessage = `+${pointsEarned} points earned`;
      if (pointsSpent > 0) {
        toastMessage += `, -${pointsSpent} for boost`;
      }
      if (pointsEarned > 1) {
        toastMessage += ` (streak bonus!)`;
      }

      toast({
        title: "Message sent!",
        description: toastMessage,
      });

      // Refresh messages to get the real IDs
      if (conversationId) {
        setTimeout(fetchMessages, 500);
      }

    } catch (error: any) {
      console.error('Error sending message:', error);
      
      // Remove the temporary user message on error
      setMessages(prev => prev.filter(msg => msg.id !== 'temp-user' && msg.id !== 'typing'));
      setInputMessage(userMessage); // Restore the input
      
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  const copyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast({
        title: "Copied to clipboard",
        description: "Message content copied successfully.",
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const regenerateResponse = async () => {
    if (messages.length < 2 || isLoading) return;
    
    // Remove the last AI message and regenerate
    const lastUserMessage = [...messages].reverse().find(msg => msg.role === 'user');
    if (!lastUserMessage) return;

    setMessages(prev => prev.filter((_, index) => index !== prev.length - 1));
    setInputMessage(lastUserMessage.content);
    await sendMessage();
  };

  return (
    <div className={`flex-1 flex flex-col h-screen transition-all duration-300 ${
      isSidebarOpen ? 'ml-80' : 'ml-0'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-primary/20 glass-card">
        <div className="flex items-center gap-3">
          <Button
            onClick={onToggleSidebar}
            variant="ghost"
            size="sm"
            className="hover-glow-cyan"
          >
            <Menu className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="font-semibold bg-gradient-primary bg-clip-text text-transparent">
              AI Chat
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="hover-glow-cyan">
            <Zap className="w-3 h-3 mr-1" />
            {userPoints} points
          </Badge>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-primary flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-primary-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Start a conversation</h2>
              <p className="text-muted-foreground">
                Ask me anything and earn reward points!
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={message.id + index}
              className={`flex gap-3 message-slide-in ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
              
              <Card className={`max-w-[80%] p-4 glass-card ${
                message.role === 'user' 
                  ? 'bg-primary/10 border-primary/30' 
                  : 'border-secondary/30'
              }`}>
                <div className="prose prose-invert max-w-none">
                  {message.id === 'typing' ? (
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  ) : (
                    <ReactMarkdown
                      components={{
                        code(props) {
                          const {children, className, ...rest} = props;
                          const match = /language-(\w+)/.exec(className || '');
                          return match ? (
                            <SyntaxHighlighter
                              style={oneDark as any}
                              language={match[1]}
                              PreTag="div"
                            >
                              {String(children).replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          ) : (
                            <code className={`${className} bg-muted/50 px-1 py-0.5 rounded`} {...rest}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
                
                {message.role === 'assistant' && message.id !== 'typing' && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {message.tokens_used && (
                        <span className="flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {message.tokens_used} tokens
                        </span>
                      )}
                      {message.response_time_ms && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {message.response_time_ms}ms
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        onClick={() => copyMessage(message.content)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover-glow-cyan"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      {index === messages.length - 1 && (
                        <Button
                          onClick={regenerateResponse}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 hover-glow-purple"
                          disabled={isLoading}
                        >
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-secondary-foreground" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-primary/20 glass-card">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your message..."
                className="pr-20 bg-input/50 border-primary/20 focus:border-primary/60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={isLoading}
              />
              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                {userPoints >= 10 && (
                  <Button
                    onClick={() => sendMessage(true)}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-accent hover:text-accent/80"
                    disabled={isLoading}
                    title="Boost (+priority, -10 points)"
                  >
                    <Zap className="w-3 h-3" />
                  </Button>
                )}
                <Button
                  onClick={() => sendMessage()}
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-primary hover:text-primary/80"
                  disabled={isLoading || !inputMessage.trim()}
                >
                  <Send className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
            <span>Press Enter to send, Shift+Enter for new line</span>
            <span>+1 point per message, +5 for daily streaks</span>
          </div>
        </div>
      </div>
    </div>
  );
}