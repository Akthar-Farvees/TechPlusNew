import { sql, relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  boolean,
  real,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z, ZodType } from "zod";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  preferences: jsonb("preferences").default('{}'),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// News categories enum
export const categoryEnum = pgEnum('category', [
  'ai_ml',
  'startups',
  'cybersecurity',
  'mobile',
  'web3',
  'others'
]);

// News sources
export const sources = pgTable("sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  url: varchar("url").notNull(),
  rssUrl: varchar("rss_url"),
  isActive: boolean("is_active").default(true),
  fetchInterval: integer("fetch_interval").default(300), // seconds
  lastFetchAt: timestamp("last_fetch_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Articles
export const articles = pgTable("articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  url: varchar("url").notNull().unique(),
  content: text("content"),
  snippet: text("snippet"),
  sourceId: varchar("source_id").references(() => sources.id),
  publishedAt: timestamp("published_at"),
  fetchedAt: timestamp("fetched_at").defaultNow(),
  category: categoryEnum("category").default('others'),
  thumbnail: varchar("thumbnail"),
  sentiment: varchar("sentiment"), // positive, negative, neutral
  sentimentScore: real("sentiment_score"),
  embedding: text("embedding"), // JSON string of embedding vector
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_articles_published_at").on(table.publishedAt),
  index("idx_articles_category").on(table.category),
  index("idx_articles_source_id").on(table.sourceId),
]);

// Bookmarks
export const bookmarks = pgTable("bookmarks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  savedAt: timestamp("saved_at").defaultNow(),
}, (table) => [
  index("idx_bookmarks_user_id").on(table.userId),
  index("idx_bookmarks_article_id").on(table.articleId),
]);

// Chat conversations
export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  messages: jsonb("messages").default('[]'),
  createdAt: timestamp("created_at").defaultNow(),
  lastActiveAt: timestamp("last_active_at").defaultNow(),
}, (table) => [
  index("idx_chat_user_id").on(table.userId),
  index("idx_chat_article_id").on(table.articleId),
]);

// Trending records
export const trendingRecords = pgTable("trending_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  topic: varchar("topic").notNull(),
  count: integer("count").notNull(),
  category: categoryEnum("category"),
  growthRate: real("growth_rate"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_trending_date").on(table.date),
  index("idx_trending_topic").on(table.topic),
]);

// Related articles (for similarity suggestions)
export const relatedArticles = pgTable("related_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  articleId: varchar("article_id").references(() => articles.id).notNull(),
  relatedArticleId: varchar("related_article_id").references(() => articles.id).notNull(),
  similarityScore: real("similarity_score").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_related_article_id").on(table.articleId),
  index("idx_related_similarity").on(table.similarityScore),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  bookmarks: many(bookmarks),
  chatConversations: many(chatConversations),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  source: one(sources, {
    fields: [articles.sourceId],
    references: [sources.id],
  }),
  bookmarks: many(bookmarks),
  chatConversations: many(chatConversations),
  relatedFrom: many(relatedArticles, { relationName: "articleToRelated" }),
  relatedTo: many(relatedArticles, { relationName: "relatedToArticle" }),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
  articles: many(articles),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  user: one(users, {
    fields: [bookmarks.userId],
    references: [users.id],
  }),
  article: one(articles, {
    fields: [bookmarks.articleId],
    references: [articles.id],
  }),
}));

export const chatConversationsRelations = relations(chatConversations, ({ one }) => ({
  user: one(users, {
    fields: [chatConversations.userId],
    references: [users.id],
  }),
  article: one(articles, {
    fields: [chatConversations.articleId],
    references: [articles.id],
  }),
}));

export const relatedArticlesRelations = relations(relatedArticles, ({ one }) => ({
  article: one(articles, {
    fields: [relatedArticles.articleId],
    references: [articles.id],
    relationName: "articleToRelated",
  }),
  relatedArticle: one(articles, {
    fields: [relatedArticles.relatedArticleId],
    references: [articles.id],
    relationName: "relatedToArticle",
  }),
}));

// Insert schemas with explicit typing to satisfy TS
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export const upsertUserSchema = createInsertSchema(users).pick({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  profileImageUrl: true,
});

export const insertSourceSchema = createInsertSchema(sources).omit({
  id: true,
  createdAt: true,
});

export const insertArticleSchema = createInsertSchema(articles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  viewCount: true,
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).omit({
  id: true,
  savedAt: true,
});

export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({
  id: true,
  createdAt: true,
  lastActiveAt: true,
});

export const insertTrendingRecordSchema = createInsertSchema(trendingRecords).omit({
  id: true,
  createdAt: true,
});



// Types
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Article = typeof articles.$inferSelect;
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type TrendingRecord = typeof trendingRecords.$inferSelect;
export type InsertTrendingRecord = z.infer<typeof insertTrendingRecordSchema>;
export type RelatedArticle = typeof relatedArticles.$inferSelect;

// Article with related data
export type ArticleWithSource = Article & {
  source: Source | null;
};

export type ArticleWithRelated = ArticleWithSource & {
  isBookmarked?: boolean;
  relatedArticles?: ArticleWithSource[];
};
