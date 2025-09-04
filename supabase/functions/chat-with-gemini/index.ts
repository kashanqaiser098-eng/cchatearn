import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  conversationId?: string;
  boost?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get request data
    const { messages, conversationId, boost = false }: ChatRequest = await req.json();
    
    if (!messages || messages.length === 0) {
      throw new Error('No messages provided');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Authentication failed');
    }

    console.log(`Processing chat request for user: ${user.id}`);

    // Get user's profile for point checking
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('reward_points, daily_streak, last_message_date, total_messages')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      throw new Error('Failed to fetch user profile');
    }

    // Check if user has enough points for boost
    if (boost && profile.reward_points < 10) {
      throw new Error('Insufficient points for boost. Need 10 points.');
    }

    // Prepare messages for Gemini API
    const systemMessage = boost 
      ? "You are a highly intelligent and helpful AI assistant. Provide detailed, accurate, and priority responses."
      : "You are a helpful AI assistant. Provide clear and accurate responses.";

    const geminiMessages = [
      { role: 'user', parts: [{ text: systemMessage }] },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }))
    ];

    // Make request to Gemini API
    const startTime = Date.now();
    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');
    
    if (!googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': googleApiKey,
        },
        body: JSON.stringify({
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const responseTime = Date.now() - startTime;

    if (!geminiData.candidates || geminiData.candidates.length === 0) {
      throw new Error('No response from Gemini API');
    }

    const aiResponse = geminiData.candidates[0].content.parts[0].text;
    const tokensUsed = geminiData.usageMetadata?.totalTokenCount || 0;

    console.log(`Response generated in ${responseTime}ms, tokens: ${tokensUsed}`);

    // Calculate points and streaks
    const today = new Date().toISOString().split('T')[0];
    const lastMessageDate = profile.last_message_date;
    const isNewDay = !lastMessageDate || lastMessageDate !== today;
    const isConsecutiveDay = lastMessageDate && 
      new Date(today).getTime() - new Date(lastMessageDate).getTime() === 86400000; // 24 hours

    let pointsEarned = 1; // Base points for message
    let newStreak = profile.daily_streak;

    // Calculate streak bonus
    if (isNewDay) {
      if (isConsecutiveDay) {
        newStreak += 1;
        pointsEarned += 5; // Streak bonus
      } else if (lastMessageDate) {
        newStreak = 1; // Reset streak if not consecutive
      } else {
        newStreak = 1; // First message ever
      }
    }

    // Deduct points for boost
    let pointChange = pointsEarned;
    if (boost) {
      pointChange -= 10;
    }

    // Update user profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        reward_points: profile.reward_points + pointChange,
        daily_streak: newStreak,
        last_message_date: today,
        total_messages: profile.total_messages + 1,
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('Error updating profile:', updateError);
    }

    // Record reward transaction
    if (pointChange !== 0) {
      const transactionType = boost ? 'boost' : (pointsEarned > 1 ? 'streak' : 'message');
      const description = boost 
        ? 'Boost used for priority response'
        : (pointsEarned > 1 ? `Daily streak bonus (${newStreak} days)` : 'Message sent');

      const { error: transactionError } = await supabase
        .from('reward_transactions')
        .insert({
          user_id: user.id,
          points_change: pointChange,
          transaction_type: transactionType,
          description: description,
        });

      if (transactionError) {
        console.error('Error recording transaction:', transactionError);
      }
    }

    // Store the messages if conversationId is provided
    if (conversationId) {
      // Store user message
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          content: messages[messages.length - 1].content,
          role: 'user',
        });

      // Store AI response
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          content: aiResponse,
          role: 'assistant',
          tokens_used: tokensUsed,
          response_time_ms: responseTime,
        });

      // Update conversation title if it's the first message
      const { data: messageCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact' })
        .eq('conversation_id', conversationId);

      if (messageCount && messageCount.length <= 2) {
        // Generate a title from the first user message
        const title = messages[0]?.content.slice(0, 50) + (messages[0]?.content.length > 50 ? '...' : '');
        await supabase
          .from('conversations')
          .update({ title })
          .eq('id', conversationId);
      }
    }

    return new Response(
      JSON.stringify({
        response: aiResponse,
        tokensUsed,
        responseTime,
        pointsEarned: pointsEarned,
        pointsSpent: boost ? 10 : 0,
        newStreak,
        totalPoints: profile.reward_points + pointChange,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in chat-with-gemini function:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error',
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});