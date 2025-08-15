import { storage } from "../storage.js";
import { aiService } from "./aiService.js";
import { rssService } from "./rssService.js";
import { InsertTrendingRecord } from "../shared/schema.js";

export class NewsService {
  async processNewArticles(): Promise<void> {
    console.log('Starting news processing...');
    
    // Initialize default sources if needed
    await rssService.initializeDefaultSources();
    
    // Fetch articles from all sources
    await rssService.fetchAllSources();
    
    // Process sentiment analysis for recent articles
    await this.processSentimentAnalysis();
    
    // Generate trending topics
    await this.updateTrendingTopics();
    
    console.log('News processing completed');
  }

  private async processSentimentAnalysis(): Promise<void> {
    try {
      // Get recent articles without sentiment analysis
      const recentArticles = await storage.getArticles({ 
        timeRange: 'today', 
        limit: 50 
      });

      for (const article of recentArticles) {
        if (article.sentiment || !article.content) continue;

        try {
          const sentimentResult = await aiService.analyzeSentiment(
            article.title + '\n' + (article.content || article.snippet || '')
          );

          await storage.updateArticle(article.id, {
            sentiment: sentimentResult.sentiment,
            sentimentScore: sentimentResult.score,
          });

          console.log(`Processed sentiment for: ${article.title}`);
        } catch (error) {
          console.error(`Error processing sentiment for article ${article.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in sentiment processing:', error);
    }
  }

  private async updateTrendingTopics(): Promise<void> {
    try {
      const recentArticles = await storage.getArticles({ 
        timeRange: 'today', 
        limit: 100 
      });

      // Extract keywords and count frequency
      const keywordCounts = new Map<string, number>();
      const categoryTopics = new Map<string, Map<string, number>>();

      for (const article of recentArticles) {
        // Extract keywords from title and content
        const text = (article.title + ' ' + (article.snippet || '')).toLowerCase();
        const keywords = this.extractKeywords(text);
        
        // Initialize category map if needed
        const categoryKey = article.category ?? '';
        if (!categoryTopics.has(categoryKey)) {
          categoryTopics.set(categoryKey, new Map());
        }
        const categoryMap = categoryTopics.get(categoryKey)!;

        for (const keyword of keywords) {
          keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
          categoryMap.set(keyword, (categoryMap.get(keyword) || 0) + 1);
        }
      }

      // Store trending topics
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Top overall trending topics
      const sortedKeywords = Array.from(keywordCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);

      for (const [topic, count] of sortedKeywords) {
        if (count >= 3) { // Only topics mentioned at least 3 times
          const growthRate = this.calculateGrowthRate(topic, count);
          
          const trendingRecord: InsertTrendingRecord = {
            date: today,
            topic,
            count,
            growthRate,
          };

          await storage.createTrendingRecord(trendingRecord);
        }
      }

      // Category-specific trending topics
      for (const [category, topics] of categoryTopics) {
        const sortedCategoryTopics = Array.from(topics.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10);

        for (const [topic, count] of sortedCategoryTopics) {
          if (count >= 2) {
            const growthRate = this.calculateGrowthRate(topic, count);
            
            const trendingRecord: InsertTrendingRecord = {
              date: today,
              topic,
              count,
              category: category as any,
              growthRate,
            };

            await storage.createTrendingRecord(trendingRecord);
          }
        }
      }

      console.log(`Updated trending topics: ${sortedKeywords.length} overall topics`);
    } catch (error) {
      console.error('Error updating trending topics:', error);
    }
  }

  private extractKeywords(text: string): string[] {
    // Common tech keywords and phrases
    const techKeywords = [
      'ai', 'artificial intelligence', 'machine learning', 'ml', 'deep learning',
      'openai', 'gpt', 'chatgpt', 'claude', 'llm', 'neural network',
      'blockchain', 'crypto', 'bitcoin', 'ethereum', 'web3', 'nft',
      'startup', 'funding', 'venture capital', 'ipo', 'acquisition',
      'cybersecurity', 'security', 'hack', 'breach', 'vulnerability',
      'mobile', 'iphone', 'android', 'app', 'ios',
      'cloud', 'aws', 'azure', 'google cloud', 'saas',
      'apple', 'google', 'microsoft', 'meta', 'tesla', 'nvidia',
      'quantum', 'robotics', 'automation', 'iot', 'ar', 'vr',
      'privacy', 'data', 'algorithm', 'software', 'hardware',
      'api', 'opensource', 'developer', 'programming'
    ];

    const words = text.match(/\b\w+\b/g) || [];
    const keywords: string[] = [];

    // Extract tech keywords
    for (const keyword of techKeywords) {
      if (text.includes(keyword)) {
        keywords.push(keyword);
      }
    }

    // Extract company names (capitalized words)
    const companyPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    const companies = text.match(companyPattern) || [];
    keywords.push(...companies.map(c => c.toLowerCase()));

    // Remove duplicates and return
    return [...new Set(keywords)];
  }

  private calculateGrowthRate(topic: string, currentCount: number): number {
    // Simple growth rate calculation - in production, compare with historical data
    // For now, use count as a proxy for growth rate
    return Math.min(100, (currentCount - 1) * 10);
  }

  async generateRelatedArticles(): Promise<void> {
    try {
      const recentArticles = await storage.getArticles({ 
        timeRange: 'week', 
        limit: 100 
      });

      for (const article of recentArticles) {
        if (!article.content) continue;

        // Generate embedding for the article
        const embedding = await aiService.generateEmbedding(
          article.title + '\n' + (article.content || article.snippet || '')
        );

        if (embedding.length > 0) {
          // Update article with embedding
          await storage.updateArticle(article.id, {
            embedding: JSON.stringify(embedding),
          });

          // Find similar articles (simplified similarity check)
          const potentialRelated = recentArticles.filter(other => 
            other.id !== article.id && 
            other.category === article.category
          );

          // For now, use category matching - in production, use embedding similarity
          for (const related of potentialRelated.slice(0, 5)) {
            const similarityScore = this.calculateSimpleSimilarity(article, related);
            
            if (similarityScore > 0.3) {
              await storage.createRelatedArticle(article.id, related.id, similarityScore);
            }
          }
        }
      }

      console.log('Generated related articles');
    } catch (error) {
      console.error('Error generating related articles:', error);
    }
  }

  private calculateSimpleSimilarity(article1: any, article2: any): number {
    // Simple similarity based on common words in titles
    const words1 = new Set(article1.title.toLowerCase().split(/\s+/));
    const words2 = new Set(article2.title.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  async startPeriodicUpdate(): Promise<void> {
    // Initial processing
    await this.processNewArticles();
    
    // Set up periodic updates
    setInterval(async () => {
      try {
        await this.processNewArticles();
      } catch (error) {
        console.error('Error in periodic update:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Generate related articles every hour
    setInterval(async () => {
      try {
        await this.generateRelatedArticles();
      } catch (error) {
        console.error('Error generating related articles:', error);
      }
    }, 60 * 60 * 1000); // Every hour
  }
}

export const newsService = new NewsService();
