import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session } from "@supabase/supabase-js";
import AuthPage from "./auth/AuthPage";
import ChatSidebar from "./chat/ChatSidebar";
import ChatInterface from "./chat/ChatInterface";
import { useToast } from "@/hooks/use-toast";

export default function ChatApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setIsLoading(false);
      
      if (event === 'SIGNED_IN') {
        toast({
          title: "Welcome!",
          description: "You're now signed in. Start chatting to earn points!",
        });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const createNewConversation = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: 'New Conversation'
        })
        .select('id')
        .single();

      if (error) throw error;
      
      setCurrentConversationId(data.id);
      
      toast({
        title: "New conversation started",
        description: "Ready to chat!",
      });
    } catch (error: any) {
      toast({
        title: "Failed to create conversation",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleConversationSelect = (id: string) => {
    setCurrentConversationId(id);
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-space-dark via-space-medium to-space-dark">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-primary flex items-center justify-center animate-pulse">
            <div className="w-8 h-8 bg-primary-foreground rounded-full"></div>
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show auth page if not signed in
  if (!session) {
    return <AuthPage />;
  }

  // Show main chat app
  return (
    <div className="min-h-screen bg-gradient-to-br from-space-dark via-space-medium to-space-dark overflow-hidden">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={toggleSidebar}
        currentConversationId={currentConversationId}
        onConversationSelect={handleConversationSelect}
        onNewConversation={createNewConversation}
      />
      
      <ChatInterface
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
        conversationId={currentConversationId}
      />
    </div>
  );
}