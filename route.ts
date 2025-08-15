import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage.js";
import { aiService } from "./services/aiService.js";
import { newsService } from "./services/newsService.js";
// Authentication removed - open access
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  console.log("Starting route registration...");

  // Authentication removed - open access app

  try {
    console.log("About to start news processing...");
    // Start news processing
    newsService.startPeriodicUpdate();
    console.log("News processing started successfully");
  } catch (error) {
    console.error("Error starting news service:", error);
    throw error;
  }

  console.log("Registering API routes...");

  // Public routes - no authentication required
  app.get('/api/auth/user', async (req: any, res) => {
    console.log("GET /api/auth/user called");
    // Return a mock user for UI compatibility
    res.json({ 
      id: 'guest', 
      email: 'guest@example.com', 
      firstName: 'Guest', 
      lastName: 'User' 
    });
  });

  // Articles routes
  app.get('/api/articles', async (req: any, res) => {
    try {
      const userId = undefined; // No user tracking
      const { category, timeRange, search, page = 1, limit = 20 } = req.query;
      
      const articles = await storage.getArticles({
        category: category as string,
        timeRange: timeRange as string,
        search: search as string,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        userId,
      });

      res.json(articles);
    } catch (error) {
      console.error("Error fetching articles:", error);
      res.status(500).json({ message: "Failed to fetch articles" });
    }
  });

  app.get('/api/articles/:id', async (req: any, res) => {
    try {
      const userId = undefined; // No user tracking
      const { id } = req.params;
      
      const article = await storage.getArticleById(id, userId);
      if (!article) {
        return res.status(404).json({ message: "Article not found" });
      }

      // Increment view count
      await storage.incrementArticleViews(id);

      res.json(article);
    } catch (error) {
      console.error("Error fetching article:", error);
      res.status(500).json({ message: "Failed to fetch article" });
    }
  });

  app.get('/api/search', async (req: any, res) => {
    try {
      const userId = undefined; // No user tracking
      const { q } = req.query;
      
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }

      const articles = await storage.searchArticles(q, userId);
      res.json(articles);
    } catch (error) {
      console.error("Error searching articles:", error);
      res.status(500).json({ message: "Failed to search articles" });
    }
  });

  // Bookmarks routes - enabled for local storage simulation
  app.get('/api/bookmarks', async (req: any, res) => {
    try {
      // For demo purposes, return sample bookmarked articles
      const sampleBookmarks = await storage.getArticles({
        category: 'all',
        timeRange: 'week',
        page: 1,
        limit: 10
      });
      
      // Return first 3 articles as "bookmarked" for demo
      const bookmarkedArticles = sampleBookmarks.slice(0, 3).map(article => ({
        ...article,
        isBookmarked: true
      }));
      
      res.json(bookmarkedArticles);
    } catch (error) {
      console.error("Error fetching bookmarks:", error);
      res.status(500).json({ message: "Failed to fetch bookmarks" });
    }
  });

  app.post('/api/bookmarks', async (req: any, res) => {
    try {
      // Simulate bookmark creation
      const { articleId } = req.body;
      res.status(200).json({ message: "Article bookmarked successfully" });
    } catch (error) {
      console.error("Error creating bookmark:", error);
      res.status(500).json({ message: "Failed to create bookmark" });
    }
  });

  app.delete('/api/bookmarks/:articleId', async (req: any, res) => {
    try {
      // Simulate bookmark deletion
      const { articleId } = req.params;
      res.status(200).json({ message: "Bookmark removed successfully" });
    } catch (error) {
      console.error("Error deleting bookmark:", error);
      res.status(500).json({ message: "Failed to delete bookmark" });
    }
  });

  // Analytics route
  app.get('/api/analytics', async (req: any, res) => {
    try {
      const timeRange = (req.query.timeRange || 'week') as 'today' | 'week' | 'month';
      
      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      
      switch (timeRange) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setDate(now.getDate() - 30);
          break;
      }

      // Get analytics data
      const analytics = await storage.getAnalytics(startDate);
      
      res.json(analytics);
    } catch (error) {
      console.error('Error fetching analytics:', error);
      res.status(500).json({ message: 'Failed to fetch analytics data' });
    }
  });

  // AI Chat routes - now public
  app.post('/api/chat/summarize', async (req: any, res) => {
    try {
      const userId = 'guest'; // Guest user for AI features
      const { articleId, mode = 'medium' } = req.body;

      if (!articleId) {
        return res.status(400).json({ message: "Article ID is required" });
      }

      const summary = await aiService.summarizeArticle({
        articleId,
        mode: mode as 'short' | 'medium' | 'long',
        userId,
      });

      res.json({ summary });
    } catch (error) {
      console.error("Error summarizing article:", error);
      res.status(500).json({ message: "Failed to summarize article" });
    }
  });

  app.post('/api/chat/message', async (req: any, res) => {
    try {
      const userId = 'guest'; // Guest user for AI features
      const { articleId, message } = req.body;

      if (!articleId || !message) {
        return res.status(400).json({ message: "Article ID and message are required" });
      }

      // Get conversation history
      const conversationHistory = await aiService.getChatHistory(userId, articleId);

      const response = await aiService.chatAboutArticle({
        articleId,
        message,
        userId,
        conversationHistory,
      });

      res.json({ response });
    } catch (error) {
      console.error("Error processing chat message:", error);
      res.status(500).json({ message: "Failed to process chat message" });
    }
  });

  app.get('/api/chat/:articleId/history', async (req: any, res) => {
    try {
      const userId = 'guest'; // Guest user for AI features
      const { articleId } = req.params;

      const history = await aiService.getChatHistory(userId, articleId);
      res.json(history);
    } catch (error) {
      console.error("Error fetching chat history:", error);
      res.status(500).json({ message: "Failed to fetch chat history" });
    }
  });

  app.post('/api/chat/compare', async (req: any, res) => {
    try {
      const userId = 'guest'; // Guest user for AI features
      const { articleIds } = req.body;

      if (!Array.isArray(articleIds) || articleIds.length < 2) {
        return res.status(400).json({ message: "At least 2 article IDs are required" });
      }

      const comparison = await aiService.compareArticles(articleIds, userId);
      res.json({ comparison });
    } catch (error) {
      console.error("Error comparing articles:", error);
      res.status(500).json({ message: "Failed to compare articles" });
    }
  });

  // Trending routes
  app.get('/api/trending', async (req: any, res) => {
    try {
      const { range = 'today' } = req.query;
      const trending = await storage.getTrendingTopics(range as string);
      res.json(trending);
    } catch (error) {
      console.error("Error fetching trending topics:", error);
      res.status(500).json({ message: "Failed to fetch trending topics" });
    }
  });

  // Sources routes
  app.get('/api/sources', async (req: any, res) => {
    try {
      const sources = await storage.getSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ message: "Failed to fetch sources" });
    }
  });

  // Manual refresh route for testing
  app.post('/api/refresh', async (req: any, res) => {
    try {
      await newsService.processNewArticles();
      res.json({ message: "News refresh completed" });
    } catch (error) {
      console.error("Error refreshing news:", error);
      res.status(500).json({ message: "Failed to refresh news" });
    }
  });

  console.log("Creating HTTP server...");
  const httpServer = createServer(app);

  // WebSocket setup for real-time updates
  console.log("Setting up WebSocket server...");
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('WebSocket client connected');

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'subscribe') {
          // Handle subscription to specific topics
          console.log('Client subscribed to:', data.topic);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
    });

    // Send initial connection message
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'connected', 
        message: 'Connected to TechPulse real-time updates' 
      }));
    }
  });

  // Broadcast updates to connected clients
  const broadcastUpdate = (type: string, data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, data }));
      }
    });
  };

  // Example: Broadcast when new articles are available
  setInterval(() => {
    broadcastUpdate('heartbeat', { timestamp: Date.now() });
  }, 30000); // Every 30 seconds

  console.log("Route registration completed");
  return httpServer;
}