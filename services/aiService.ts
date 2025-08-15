import OpenAI from "openai";
import { storage } from "../storage.js";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY
}) : null;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface SummarizationRequest {
  articleId: string;
  mode: 'short' | 'medium' | 'long';
  userId: string;
}

interface ChatRequest {
  articleId: string;
  message: string;
  userId: string;
  conversationHistory?: ChatMessage[];
}

export class AIService {
  private getSystemPrompt(): string {
    return `You are TechPulse Assistant, an expert in technology news and analysis. 
    
    Your capabilities include:
    - Summarizing tech articles with different levels of detail
    - Answering questions about article content
    - Providing context and background on tech topics
    - Comparing multiple articles or topics
    - Explaining technical concepts in accessible language
    
    Guidelines:
    - Always cite the article when making claims about its content
    - If asked about information not in the provided article, clearly state this limitation
    - Keep responses concise but informative
    - Use markdown formatting for better readability
    - When uncertain, ask for clarification rather than hallucinating
    - Focus on factual, objective analysis
    
    Always include source references in your responses when discussing article content.`;
  }

  private async getArticleContext(articleId: string): Promise<string> {
    const article = await storage.getArticleById(articleId);
    if (!article) {
      throw new Error('Article not found');
    }

    // Create a condensed version of the article for context
    const context = `
**Article Title:** ${article.title}
**Source:** ${article.source?.name || 'Unknown'}
**Published:** ${article.publishedAt?.toLocaleDateString() || 'Unknown'}
**Category:** ${article.category}
**URL:** ${article.url}

**Content Summary:**
${article.snippet || article.content?.substring(0, 1000) || 'No content available'}

${article.content && article.content.length > 1000 ? '**Full Content:**\n' + article.content.substring(0, 3000) + (article.content.length > 3000 ? '...' : '') : ''}
    `.trim();

    return context;
  }

  async summarizeArticle(request: SummarizationRequest): Promise<string> {
    try {
      const articleContext = await this.getArticleContext(request.articleId);
      
      if (!openai) {
        // Return fallback summary when API key is not available
        const article = await storage.getArticleById(request.articleId);
        if (!article) {
          throw new Error('Article not found');
        }
        
        const snippet = article.snippet || article.content?.substring(0, 300) || 'No content available';
        return `**Content Preview** (AI summarization requires API key)\n\n${snippet}${snippet.length >= 300 ? '...' : ''}`;
      }
      
      let promptInstructions = '';
      switch (request.mode) {
        case 'short':
          promptInstructions = 'Provide a concise 1-2 sentence summary highlighting the main point.';
          break;
        case 'medium':
          promptInstructions = 'Provide a 3-4 sentence summary covering the key points and implications.';
          break;
        case 'long':
          promptInstructions = 'Provide a detailed paragraph summary with bullet points for key takeaways and potential impact.';
          break;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: this.getSystemPrompt() },
          { 
            role: "user", 
            content: `${promptInstructions}\n\nArticle to summarize:\n${articleContext}` 
          }
        ],
        max_tokens: request.mode === 'long' ? 500 : request.mode === 'medium' ? 200 : 100,
        temperature: 0.3,
      });

      const summary = response.choices[0].message.content;
      if (!summary) {
        throw new Error('No summary generated');
      }

      // Save the conversation
      await this.saveChatMessage(request.userId, request.articleId, [
        { role: 'user', content: `Summarize this article (${request.mode} mode)`, timestamp: Date.now() },
        { role: 'assistant', content: summary, timestamp: Date.now() }
      ]);

      return summary;
    } catch (error) {
      console.error('Error summarizing article:', error);
      throw new Error('Failed to summarize article');
    }
  }

  async chatAboutArticle(request: ChatRequest): Promise<string> {
    try {
      if (!openai) {
        return "AI chat is temporarily unavailable. Please provide an OpenAI API key to enable intelligent article discussions.";
      }
      
      const articleContext = await this.getArticleContext(request.articleId);
      
      const messages: any[] = [
        { role: "system", content: this.getSystemPrompt() },
        { 
          role: "system", 
          content: `Here is the article you should reference in your responses:\n${articleContext}` 
        }
      ];

      // Add conversation history
      if (request.conversationHistory) {
        messages.push(...request.conversationHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })));
      }

      // Add current user message
      messages.push({ role: "user", content: request.message });

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages,
        max_tokens: 800,
        temperature: 0.4,
      });

      const aiResponse = response.choices[0].message.content;
      if (!aiResponse) {
        throw new Error('No response generated');
      }

      // Save the conversation
      const updatedHistory = [
        ...(request.conversationHistory || []),
        { role: 'user' as const, content: request.message, timestamp: Date.now() },
        { role: 'assistant' as const, content: aiResponse, timestamp: Date.now() }
      ];
      
      await this.saveChatMessage(request.userId, request.articleId, updatedHistory);

      return aiResponse;
    } catch (error) {
      console.error('Error in chat:', error);
      throw new Error('Failed to process chat message');
    }
  }

  async analyzeSentiment(text: string): Promise<{ sentiment: string; score: number; confidence: number }> {
    try {
      if (!openai) {
        // Return neutral sentiment when API key is not available
        return { sentiment: 'neutral', score: 0, confidence: 0 };
      }
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Analyze the sentiment of the provided text. Respond with JSON in this exact format: 
            { "sentiment": "positive|negative|neutral", "score": number_between_-1_and_1, "confidence": number_between_0_and_1 }`
          },
          {
            role: "user",
            content: `Analyze the sentiment of this text:\n\n${text.substring(0, 2000)}`
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 100,
        temperature: 0.1,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      return {
        sentiment: result.sentiment || 'neutral',
        score: Math.max(-1, Math.min(1, result.score || 0)),
        confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      };
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      return { sentiment: 'neutral', score: 0, confidence: 0 };
    }
  }

  async compareArticles(articleIds: string[], userId: string): Promise<string> {
    try {
      const articles = await Promise.all(
        articleIds.map(id => storage.getArticleById(id))
      );

      const validArticles = articles.filter(article => article !== undefined);
      
      if (validArticles.length < 2) {
        throw new Error('Need at least 2 articles to compare');
      }

      const articleContexts = validArticles.map((article, index) => 
        `**Article ${index + 1}: ${article!.title}**\n${article!.snippet || article!.content?.substring(0, 500) || ''}`
      ).join('\n\n');

      if (!openai) {
        throw new Error('OpenAI API key is not available.');
      }
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: this.getSystemPrompt() },
          { 
            role: "user", 
            content: `Compare and contrast these tech articles. Highlight key differences, similarities, and potential implications:\n\n${articleContexts}` 
          }
        ],
        max_tokens: 1000,
        temperature: 0.4,
      });

      return response.choices[0].message.content || 'Unable to generate comparison';
    } catch (error) {
      console.error('Error comparing articles:', error);
      throw new Error('Failed to compare articles');
    }
  }

  private async saveChatMessage(userId: string, articleId: string, messages: ChatMessage[]): Promise<void> {
    try {
      let conversation = await storage.getChatConversation(userId, articleId);
      
      if (conversation) {
        await storage.updateChatConversation(conversation.id, messages);
      } else {
        await storage.createChatConversation({
          userId,
          articleId,
          messages: JSON.stringify(messages),
        });
      }
    } catch (error) {
      console.error('Error saving chat message:', error);
    }
  }

  async getChatHistory(userId: string, articleId: string): Promise<ChatMessage[]> {
    try {
      const conversation = await storage.getChatConversation(userId, articleId);
      if (!conversation || !conversation.messages) {
        return [];
      }

      const messages = typeof conversation.messages === 'string' 
        ? JSON.parse(conversation.messages)
        : conversation.messages;

      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      console.error('Error getting chat history:', error);
      return [];
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      if (!openai) {
        // Return empty embedding if OpenAI API key is not available
        return [];
      }
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.substring(0, 8000), // Limit text length
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      return [];
    }
  }
}

export const aiService = new AIService();
