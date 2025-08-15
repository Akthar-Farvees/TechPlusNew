import type { Express } from 'express';
import { storage } from '../storage.js';
import { sql } from 'drizzle-orm';

export function registerAnalyticsRoutes(app: Express) {
  // Analytics endpoint
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
}