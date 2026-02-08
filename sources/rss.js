import { Logger } from '../utils/logger.js';

export class RSSClient {
  constructor(config = {}) {
    this.feeds = config.feeds || [
      'https://cointelegraph.com/rss',
      'https://theblock.co/rss.xml',
      'https://decrypt.co/feed',
    ];
    this.keywords = [
      'listing', 'partnership', 'launch', 'hack', 'exploit',
      'airdrop', 'upgrade', 'mainnet', 'SEC', 'ETF', 'approval',
      'token', 'bitcoin', 'ethereum', 'solana', 'binance', 'coinbase',
      'bull', 'bear', 'pump', 'dump', 'whale', 'breakout',
    ];
    this.logger = new Logger('RSS');
    this.seenUrls = new Set();
    this.cache = { data: null, ts: 0 };
    this.cacheTtlMs = 120_000;
  }

  async scan() {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];
    for (const feedUrl of this.feeds) {
      try {
        const items = await this._parseFeed(feedUrl);
        for (const item of items) {
          if (!this.seenUrls.has(item.url) && this._matchesKeywords(item)) {
            this.seenUrls.add(item.url);
            signals.push(item);
          }
        }
      } catch (err) {
        this.logger.error(`Feed ${feedUrl} failed: ${err.message}`);
      }
    }

    // Cleanup old URLs
    if (this.seenUrls.size > 500) {
      const arr = Array.from(this.seenUrls);
      this.seenUrls = new Set(arr.slice(-250));
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} articles matched`);
    return signals;
  }

  async _parseFeed(feedUrl) {
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return this._extractItems(xml, feedUrl);
  }

  _extractItems(xml, feedUrl) {
    const items = [];
    // Simple regex-based RSS/Atom parser (avoids xml2js dependency for Pear compatibility)
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = this._extractTag(block, 'title');
      const link = this._extractTag(block, 'link');
      const description = this._stripHtml(this._extractTag(block, 'description'));
      const pubDate = this._extractTag(block, 'pubDate');

      if (title && link) {
        items.push({
          title,
          url: link,
          description: (description || '').slice(0, 500),
          published_at: pubDate || '',
          feed_source: feedUrl,
        });
      }
    }

    // Also try Atom <entry> format
    if (items.length === 0) {
      const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
      while ((match = entryRegex.exec(xml)) !== null) {
        const block = match[1];
        const title = this._extractTag(block, 'title');
        const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["']/);
        const link = linkMatch ? linkMatch[1] : this._extractTag(block, 'link');
        const summary = this._stripHtml(this._extractTag(block, 'summary') || this._extractTag(block, 'content'));
        const updated = this._extractTag(block, 'updated') || this._extractTag(block, 'published');

        if (title && link) {
          items.push({
            title,
            url: link,
            description: (summary || '').slice(0, 500),
            published_at: updated || '',
            feed_source: feedUrl,
          });
        }
      }
    }

    return items.slice(0, 10); // Max 10 per feed
  }

  _extractTag(block, tag) {
    const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
    const cdataMatch = block.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();

    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = block.match(regex);
    return match ? match[1].trim() : '';
  }

  _stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }

  _matchesKeywords(item) {
    const text = `${item.title} ${item.description}`.toLowerCase();
    return this.keywords.some(kw => text.includes(kw.toLowerCase()));
  }
}
