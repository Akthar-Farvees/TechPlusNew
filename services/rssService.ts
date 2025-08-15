import { InsertArticle, InsertSource } from "../shared/schema.js";
import { storage } from "../storage.js";

interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  content?: string;
  guid?: string;
}

interface RSSFeed {
  title: string;
  items: RSSItem[];
}

export class RSSService {
  private async fetchRSS(url: string): Promise<RSSFeed> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch RSS: ${response.statusText}`);
      }
      
      const xmlText = await response.text();
      return this.parseRSS(xmlText);
    } catch (error) {
      console.error(`Error fetching RSS from ${url}:`, error);
      throw error;
    }
  }

  private parseRSS(xmlText: string): RSSFeed {
    // Basic RSS parsing - in production, use a proper XML parser
    const titleMatch = xmlText.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
    const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : 'Unknown Feed';

    const items: RSSItem[] = [];
    const itemRegex = /<item>(.*?)<\/item>/gis;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1];
      
      const itemTitleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
      const itemTitle = itemTitleMatch ? (itemTitleMatch[1] || itemTitleMatch[2]) : '';

      const linkMatch = itemContent.match(/<link>(.*?)<\/link>/i);
      const link = linkMatch ? linkMatch[1].trim() : '';

      const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i);
      const description = descMatch ? (descMatch[1] || descMatch[2]) : '';

      const pubDateMatch = itemContent.match(/<pubDate>(.*?)<\/pubDate>/i);
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';

      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/i);
      const guid = guidMatch ? guidMatch[1] : '';

      if (itemTitle && link) {
        items.push({
          title: this.cleanHTML(itemTitle),
          link: link,
          description: this.cleanHTML(description),
          pubDate: pubDate,
          guid: guid,
          content: this.cleanHTML(description),
        });
      }
    }

    return { title, items };
  }

  private cleanHTML(html: string): string {
    if (!html) return '';
    
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private categorizeArticle(title: string, content: string): string {
    const text = (title + ' ' + content).toLowerCase();
    
    if (text.includes('ai') || text.includes('artificial intelligence') || text.includes('machine learning') || text.includes('ml') || text.includes('gpt') || text.includes('neural') || text.includes('openai')) {
      return 'ai_ml';
    }
    
    if (text.includes('startup') || text.includes('funding') || text.includes('venture') || text.includes('investment') || text.includes('y combinator')) {
      return 'startups';
    }
    
    if (text.includes('security') || text.includes('cyber') || text.includes('hack') || text.includes('vulnerability') || text.includes('breach') || text.includes('malware')) {
      return 'cybersecurity';
    }
    
    if (text.includes('mobile') || text.includes('iphone') || text.includes('android') || text.includes('app') || text.includes('smartphone')) {
      return 'mobile';
    }
    
    if (text.includes('web3') || text.includes('blockchain') || text.includes('crypto') || text.includes('bitcoin') || text.includes('ethereum') || text.includes('nft')) {
      return 'web3';
    }
    
    return 'others';
  }

  private createSnippet(content: string): string {
    if (!content) return '';
    
    const cleanContent = this.cleanHTML(content);
    return cleanContent.length > 200 
      ? cleanContent.substring(0, 200).trim() + '...'
      : cleanContent;
  }

  async fetchAndStoreArticles(sourceId: string, rssUrl: string): Promise<number> {
    try {
      console.log(`Fetching RSS from: ${rssUrl}`);
      const feed = await this.fetchRSS(rssUrl);
      let newArticlesCount = 0;

      for (const item of feed.items) {
        try {
          // Check if article already exists
          const existingArticles = await storage.getArticles({ search: item.title, limit: 1 });
          if (existingArticles.length > 0) {
            continue; // Skip if already exists
          }

          const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
          const category = this.categorizeArticle(item.title, item.description || '');
          const snippet = this.createSnippet(item.description || '');

          const articleData: InsertArticle = {
            title: item.title,
            url: item.link,
            content: item.content || item.description || '',
            snippet: snippet,
            sourceId: sourceId,
            publishedAt: publishedAt,
            category: category as any,
            fetchedAt: new Date(),
          };

          await storage.createArticle(articleData);
          newArticlesCount++;
        } catch (error) {
          console.error(`Error saving article "${item.title}":`, error);
        }
      }

      // Update source last fetch time
      await storage.updateSourceLastFetch(sourceId);
      
      console.log(`Fetched ${newArticlesCount} new articles from ${rssUrl}`);
      return newArticlesCount;
    } catch (error) {
      console.error(`Error in fetchAndStoreArticles for ${rssUrl}:`, error);
      return 0;
    }
  }

  async initializeDefaultSources(): Promise<void> {
    const defaultSources = [
      {
        name: 'TechCrunch',
        url: 'https://techcrunch.com',
        rssUrl: 'https://techcrunch.com/feed/',
        isActive: true,
        fetchInterval: 300,
      },
      {
        name: 'The Verge',
        url: 'https://theverge.com',
        rssUrl: 'https://www.theverge.com/rss/index.xml',
        isActive: true,
        fetchInterval: 300,
      },
      {
        name: 'Hacker News',
        url: 'https://news.ycombinator.com',
        rssUrl: 'https://news.ycombinator.com/rss',
        isActive: true,
        fetchInterval: 600,
      },
      {
        name: 'Ars Technica',
        url: 'https://arstechnica.com',
        rssUrl: 'https://feeds.arstechnica.com/arstechnica/index',
        isActive: true,
        fetchInterval: 300,
      },
    ];

    const existingSources = await storage.getSources();
    
    for (const sourceData of defaultSources) {
      const exists = existingSources.find(s => s.name === sourceData.name);
      if (!exists) {
        await storage.createSource(sourceData);
        console.log(`Created default source: ${sourceData.name}`);
      }
    }
  }

  async fetchAllSources(): Promise<void> {
    const sources = await storage.getSources();
    
    for (const source of sources) {
      if (!source.rssUrl || !source.isActive) continue;
      
      try {
        const newArticles = await this.fetchAndStoreArticles(source.id, source.rssUrl);
        console.log(`Source ${source.name}: ${newArticles} new articles`);
      } catch (error) {
        console.error(`Error fetching from ${source.name}:`, error);
      }
    }
  }
}

export const rssService = new RSSService();
