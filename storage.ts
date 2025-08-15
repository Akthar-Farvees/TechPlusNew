import {
  users,
  articles,
  sources,
  bookmarks,
  chatConversations,
  trendingRecords,
  relatedArticles,
  type User,
  type UpsertUser,
  type Article,
  type InsertArticle,
  type ArticleWithSource,
  type ArticleWithRelated,
  type Source,
  type InsertSource,
  type Bookmark,
  type InsertBookmark,
  type ChatConversation,
  type InsertChatConversation,
  type TrendingRecord,
  type InsertTrendingRecord,
} from "./shared/schema.js";
import { db } from "./db.js";
import { eq, desc, and, or, sql, like, inArray, gte, lte, isNotNull } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Source operations
  getSources(): Promise<Source[]>;
  createSource(source: InsertSource): Promise<Source>;
  updateSourceLastFetch(id: string): Promise<void>;
  
  // Article operations
  getArticles(params: {
    category?: string;
    timeRange?: string;
    search?: string;
    page?: number;
    limit?: number;
    userId?: string;
  }): Promise<ArticleWithRelated[]>;
  getArticleById(id: string, userId?: string): Promise<ArticleWithRelated | undefined>;
  createArticle(article: InsertArticle): Promise<Article>;
  updateArticle(id: string, updates: Partial<InsertArticle>): Promise<Article>;
  incrementArticleViews(id: string): Promise<void>;
  
  // Bookmark operations
  getBookmarks(userId: string): Promise<ArticleWithSource[]>;
  createBookmark(bookmark: InsertBookmark): Promise<Bookmark>;
  deleteBookmark(userId: string, articleId: string): Promise<void>;
  isBookmarked(userId: string, articleId: string): Promise<boolean>;
  
  // Chat operations
  getChatConversation(userId: string, articleId: string): Promise<ChatConversation | undefined>;
  createChatConversation(conversation: InsertChatConversation): Promise<ChatConversation>;
  updateChatConversation(id: string, messages: any[]): Promise<ChatConversation>;
  
  // Trending operations
  getTrendingTopics(timeRange?: string): Promise<TrendingRecord[]>;
  createTrendingRecord(record: InsertTrendingRecord): Promise<TrendingRecord>;
  
  // Related articles
  getRelatedArticles(articleId: string): Promise<ArticleWithSource[]>;
  createRelatedArticle(articleId: string, relatedArticleId: string, similarityScore: number): Promise<void>;
  
  // Search operations
  searchArticles(query: string, userId?: string): Promise<ArticleWithRelated[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Source operations
  async getSources(): Promise<Source[]> {
    return await db.select().from(sources).where(eq(sources.isActive, true));
  }

  async createSource(source: InsertSource): Promise<Source> {
    const [newSource] = await db.insert(sources).values(source).returning();
    return newSource;
  }

  async updateSourceLastFetch(id: string): Promise<void> {
    await db
      .update(sources)
      .set({ lastFetchAt: new Date() })
      .where(eq(sources.id, id));
  }

  // Article operations
  async getArticles(params: {
    category?: string;
    timeRange?: string;
    search?: string;
    page?: number;
    limit?: number;
    userId?: string;
  }): Promise<ArticleWithRelated[]> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;
    
    let whereConditions = [];
    
    if (params.category && params.category !== 'all') {
      whereConditions.push(eq(articles.category, params.category as any));
    }
    
    if (params.timeRange) {
      const now = new Date();
      let timeThreshold: Date;
      
      switch (params.timeRange) {
        case 'today':
          timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          timeThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          timeThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          timeThreshold = new Date(0);
      }
      
      whereConditions.push(gte(articles.publishedAt, timeThreshold));
    }
    
    if (params.search) {
      whereConditions.push(
        or(
          like(articles.title, `%${params.search}%`),
          like(articles.content, `%${params.search}%`)
        )
      );
    }

    const query = db
      .select({
        article: articles,
        source: sources,
        isBookmarked: params.userId 
          ? sql<boolean>`EXISTS(SELECT 1 FROM ${bookmarks} WHERE ${bookmarks.userId} = ${params.userId} AND ${bookmarks.articleId} = ${articles.id})`
          : sql<boolean>`false`,
      })
      .from(articles)
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(articles.publishedAt))
      .limit(params.limit || 20)
      .offset(offset);

    const results = await query;
    
    return results.map(row => ({
      ...row.article,
      source: row.source,
      isBookmarked: row.isBookmarked,
    }));
  }

  async getArticleById(id: string, userId?: string): Promise<ArticleWithRelated | undefined> {
    const query = db
      .select({
        article: articles,
        source: sources,
        isBookmarked: userId 
          ? sql<boolean>`EXISTS(SELECT 1 FROM ${bookmarks} WHERE ${bookmarks.userId} = ${userId} AND ${bookmarks.articleId} = ${articles.id})`
          : sql<boolean>`false`,
      })
      .from(articles)
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(eq(articles.id, id));

    const [result] = await query;
    
    if (!result) return undefined;

    const relatedArticles = await this.getRelatedArticles(id);

    return {
      ...result.article,
      source: result.source,
      isBookmarked: result.isBookmarked,
      relatedArticles,
    };
  }

  async createArticle(article: InsertArticle): Promise<Article> {
    const [newArticle] = await db.insert(articles).values(article).returning();
    return newArticle;
  }

  async updateArticle(id: string, updates: Partial<InsertArticle>): Promise<Article> {
    const [updatedArticle] = await db
      .update(articles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(articles.id, id))
      .returning();
    return updatedArticle;
  }

  async incrementArticleViews(id: string): Promise<void> {
    await db
      .update(articles)
      .set({ viewCount: sql`${articles.viewCount} + 1` })
      .where(eq(articles.id, id));
  }

  // Bookmark operations
  async getBookmarks(userId: string): Promise<ArticleWithSource[]> {
    const results = await db
      .select({
        article: articles,
        source: sources,
      })
      .from(bookmarks)
      .innerJoin(articles, eq(bookmarks.articleId, articles.id))
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(eq(bookmarks.userId, userId))
      .orderBy(desc(bookmarks.savedAt));

    return results.map(row => ({
      ...row.article,
      source: row.source,
    }));
  }

  async createBookmark(bookmark: InsertBookmark): Promise<Bookmark> {
    const [newBookmark] = await db.insert(bookmarks).values(bookmark).returning();
    return newBookmark;
  }

  async deleteBookmark(userId: string, articleId: string): Promise<void> {
    await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.articleId, articleId)));
  }

  async isBookmarked(userId: string, articleId: string): Promise<boolean> {
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.articleId, articleId)));
    
    return result.count > 0;
  }

  // Analytics operations
  async getAnalytics(startDate: Date) {
    try {
      // Get article stats
      const [totalArticles] = await db
        .select({ count: sql<number>`count(*)` })
        .from(articles);

      const [articlesThisWeek] = await db
        .select({ count: sql<number>`count(*)` })
        .from(articles)
        .where(gte(articles.publishedAt, startDate));

      // Get category stats
      const categoryResults = await db
        .select({
          category: articles.category,
          count: sql<number>`count(*)`
        })
        .from(articles)
        .where(gte(articles.publishedAt, startDate))
        .groupBy(articles.category);

      const categoryStats: Record<string, number> = {};
      categoryResults.forEach(row => {
        categoryStats[row.category || 'others'] = row.count;
      });

      // Get source stats
      const sourceResults = await db
        .select({
          name: sources.name,
          count: sql<number>`count(*)`
        })
        .from(articles)
        .innerJoin(sources, eq(articles.sourceId, sources.id))
        .where(gte(articles.publishedAt, startDate))
        .groupBy(sources.name);

      const sourceStats: Record<string, number> = {};
      sourceResults.forEach(row => {
        sourceStats[row.name || 'Unknown'] = row.count;
      });

      // Get sentiment stats
      const sentimentResults = await db
        .select({
          sentiment: articles.sentiment,
          count: sql<number>`count(*)`
        })
        .from(articles)
        .where(and(
          gte(articles.publishedAt, startDate),
          isNotNull(articles.sentiment)
        ))
        .groupBy(articles.sentiment);

      const sentimentStats: Record<string, number> = {};
      sentimentResults.forEach(row => {
        if (row.sentiment) {
          sentimentStats[row.sentiment] = row.count;
        }
      });

      // Get trending topics from trendingRecords
      const trendingResults = await db
        .select()
        .from(trendingRecords)
        .orderBy(desc(trendingRecords.growthRate))
        .limit(20);

        const trendingTopics = trendingResults.map(row => ({
          topic: row.topic,
          count: row.count, // Use 'count' as per your model
          sentiment: 'neutral',
          category: row.category || 'others',
          lastMentioned: row.date.toISOString(), // date is non-null
          growth: row.growthRate || 0,
        }));


      // Get view stats
      const [totalViews] = await db
        .select({ sum: sql<number>`coalesce(sum(${articles.viewCount}), 0)` })
        .from(articles);

      const topArticlesResults = await db
        .select({
          title: articles.title,
          views: articles.viewCount,
          sourceName: sources.name,
          publishedAt: articles.publishedAt,
        })
        .from(articles)
        .leftJoin(sources, eq(articles.sourceId, sources.id))
        .where(gte(articles.publishedAt, startDate))
        .orderBy(desc(articles.viewCount))
        .limit(5);

      const topArticles = topArticlesResults.map(row => ({
        title: row.title,
        views: row.views,
        source: row.sourceName || 'Unknown',
        publishedAt: row.publishedAt?.toISOString() || new Date().toISOString(),
      }));

      return {
        totalArticles: totalArticles.count,
        articlesThisWeek: articlesThisWeek.count,
        trendingTopics,
        categoryStats,
        sourceStats,
        sentimentStats,
        viewStats: {
          totalViews: totalViews.sum,
          topArticles,
        },
      };
    } catch (error) {
      console.error('Error in getAnalytics:', error);
      return {
        totalArticles: 0,
        articlesThisWeek: 0,
        trendingTopics: [],
        categoryStats: {},
        sourceStats: {},
        sentimentStats: {},
        viewStats: {
          totalViews: 0,
          topArticles: [],
        },
      };
    }
  }

  // Chat operations
  async getChatConversation(userId: string, articleId: string): Promise<ChatConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.userId, userId), eq(chatConversations.articleId, articleId)));
    
    return conversation;
  }

  async createChatConversation(conversation: InsertChatConversation): Promise<ChatConversation> {
    const [newConversation] = await db
      .insert(chatConversations)
      .values(conversation)
      .returning();
    return newConversation;
  }

  async updateChatConversation(id: string, messages: any[]): Promise<ChatConversation> {
    const [updatedConversation] = await db
      .update(chatConversations)
      .set({ 
        messages: JSON.stringify(messages), 
        lastActiveAt: new Date() 
      })
      .where(eq(chatConversations.id, id))
      .returning();
    return updatedConversation;
  }

  // Trending operations
  async getTrendingTopics(timeRange = 'today'): Promise<TrendingRecord[]> {
    const now = new Date();
    let timeThreshold: Date;
    
    switch (timeRange) {
      case 'today':
        timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        timeThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    return await db
      .select()
      .from(trendingRecords)
      .where(gte(trendingRecords.date, timeThreshold))
      .orderBy(desc(trendingRecords.growthRate))
      .limit(10);
  }

  async createTrendingRecord(record: InsertTrendingRecord): Promise<TrendingRecord> {
    const [newRecord] = await db.insert(trendingRecords).values(record).returning();
    return newRecord;
  }

  // Related articles
  async getRelatedArticles(articleId: string): Promise<ArticleWithSource[]> {
    const results = await db
      .select({
        article: articles,
        source: sources,
      })
      .from(relatedArticles)
      .innerJoin(articles, eq(relatedArticles.relatedArticleId, articles.id))
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(eq(relatedArticles.articleId, articleId))
      .orderBy(desc(relatedArticles.similarityScore))
      .limit(5);

    return results.map(row => ({
      ...row.article,
      source: row.source,
    }));
  }

  async createRelatedArticle(articleId: string, relatedArticleId: string, similarityScore: number): Promise<void> {
    await db.insert(relatedArticles).values({
      articleId,
      relatedArticleId,
      similarityScore,
    });
  }

  // Search operations
  async searchArticles(query: string, userId?: string): Promise<ArticleWithRelated[]> {
    const searchCondition = or(
      like(articles.title, `%${query}%`),
      like(articles.content, `%${query}%`),
      like(articles.snippet, `%${query}%`)
    );

    const results = await db
      .select({
        article: articles,
        source: sources,
        isBookmarked: userId 
          ? sql<boolean>`EXISTS(SELECT 1 FROM ${bookmarks} WHERE ${bookmarks.userId} = ${userId} AND ${bookmarks.articleId} = ${articles.id})`
          : sql<boolean>`false`,
      })
      .from(articles)
      .leftJoin(sources, eq(articles.sourceId, sources.id))
      .where(searchCondition)
      .orderBy(desc(articles.publishedAt))
      .limit(50);

    return results.map(row => ({
      ...row.article,
      source: row.source,
      isBookmarked: row.isBookmarked,
    }));
  }
}

export const storage = new DatabaseStorage();
