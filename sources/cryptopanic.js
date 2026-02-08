import { Logger } from '../utils/logger.js';

export class CryptoPanicClient {
  constructor(config = {}) {
    this.baseUrl = 'https://cryptopanic.com/api/free/v1';
    this.apiKey = config.api_key || '';
    this.categories = config.categories || ['news', 'media'];
    this.minVotes = config.min_votes || 3;
    this.logger = new Logger('CryptoPanic');
    this.cache = { data: null, ts: 0 };
    this.cacheTtlMs = 120_000; // 2 min cache
  }

  async scan() {
    if (!this.apiKey) {
      this.logger.warn('No API key configured, skipping');
      return [];
    }

    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];

    for (const filter of ['hot', 'rising']) {
      try {
        const data = await this._fetchPosts(filter);
        if (data?.results) {
          for (const post of data.results) {
            const normalized = this._normalizePost(post);
            if (normalized && normalized.vote_count >= this.minVotes) {
              signals.push(normalized);
            }
          }
        }
      } catch (err) {
        this.logger.error(`Fetch ${filter} failed: ${err.message}`);
      }
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} signals found`);
    return signals;
  }

  async fetchForToken(symbol) {
    if (!this.apiKey) return [];
    try {
      const data = await this._fetchPosts('hot', symbol);
      if (!data?.results) return [];
      return data.results.map(p => this._normalizePost(p)).filter(Boolean);
    } catch (err) {
      this.logger.error(`Token fetch failed for ${symbol}: ${err.message}`);
      return [];
    }
  }

  _normalizePost(post) {
    if (!post) return null;
    const votes = post.votes || {};
    const positive = (votes.positive || 0) + (votes.liked || 0) + (votes.important || 0);
    const negative = votes.negative || 0;
    const totalVotes = positive + negative;

    const tokens = (post.currencies || []).map(c => ({
      code: c.code,
      title: c.title,
      slug: c.slug,
    }));

    return {
      title: post.title || '',
      url: post.url || '',
      source: post.source?.title || post.domain || 'unknown',
      published_at: post.published_at || '',
      sentiment: this._deriveSentiment(positive, negative),
      votes: { positive, negative, total: totalVotes },
      vote_count: totalVotes,
      tokens,
      kind: post.kind || 'news',
    };
  }

  _deriveSentiment(positive, negative) {
    const total = positive + negative;
    if (total < 2) return 'neutral';
    const ratio = positive / total;
    if (ratio >= 0.75) return 'bullish';
    if (ratio <= 0.25) return 'bearish';
    return 'neutral';
  }

  async _fetchPosts(filter, currencies) {
    let url = `${this.baseUrl}/posts/?auth_token=${this.apiKey}&filter=${filter}&regions=en&public=true`;
    if (currencies) url += `&currencies=${currencies}`;
    this.logger.debug(`Fetching: ${filter}${currencies ? ` for ${currencies}` : ''}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
