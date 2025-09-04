import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  MessageSquare, 
  Trophy, 
  Sparkles, 
  LogOut, 
  User,
  Zap,
  Crown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  reward_points: number;
  daily_streak: number;
  total_messages: number;
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  currentConversationId: string | null;
  onConversationSelect: (id: string) => void;
  onNewConversation: () => void;
}

export default function ChatSidebar({
  isOpen,
  onToggle,
  currentConversationId,
  onConversationSelect,
  onNewConversation
}: ChatSidebarProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      fetchProfile();
      fetchConversations();
    }
  }, [isOpen]);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);
    } catch (error: any) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchConversations = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setConversations(data || []);
    } catch (error: any) {
      console.error('Error fetching conversations:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error: any) {
      toast({
        title: "Error signing out",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 left-0 z-50 w-80 glass-card border-r border-primary/20 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-primary/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <h2 className="font-semibold bg-gradient-primary bg-clip-text text-transparent">
              cchatearn
            </h2>
          </div>
          <Button
            onClick={onToggle}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </Button>
        </div>

        {profile && (
          <div className="flex items-center gap-3 p-3 glass rounded-lg">
            <Avatar className="w-10 h-10">
              <AvatarImage src={profile.avatar_url || ""} />
              <AvatarFallback className="bg-gradient-primary text-primary-foreground">
                <User className="w-5 h-5" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{profile.display_name}</p>
              <div className="flex items-center gap-3 mt-1">
                <Badge variant="secondary" className="text-xs">
                  <Zap className="w-3 h-3 mr-1" />
                  {profile.reward_points}
                </Badge>
                <Badge variant="outline" className="text-xs border-accent/50">
                  <Crown className="w-3 h-3 mr-1" />
                  {profile.daily_streak}
                </Badge>
              </div>
            </div>
          </div>
        )}

        <Button
          onClick={onNewConversation}
          className="w-full mt-3 bg-gradient-primary hover:opacity-90 text-primary-foreground hover-glow-cyan"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Chat
        </Button>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-hidden">
        <div className="p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Recent Conversations
          </h3>
        </div>
        <ScrollArea className="flex-1 px-2">
          {isLoading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              Loading conversations...
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No conversations yet. Start chatting!
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              {conversations.map((conversation) => (
                <Button
                  key={conversation.id}
                  variant={currentConversationId === conversation.id ? "secondary" : "ghost"}
                  className={`w-full justify-start text-left h-auto p-3 transition-smooth ${
                    currentConversationId === conversation.id 
                      ? "bg-primary/10 border border-primary/30 hover-glow-cyan" 
                      : "hover:bg-secondary/50"
                  }`}
                  onClick={() => onConversationSelect(conversation.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {conversation.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(conversation.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </Button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-primary/20 space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start hover-glow-purple border-accent/30"
        >
          <Trophy className="w-4 h-4 mr-2" />
          Leaderboard
        </Button>
        <Separator className="bg-border/50" />
        <Button
          onClick={handleSignOut}
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}