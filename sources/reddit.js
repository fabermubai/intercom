import { Logger } from '../utils/logger.js';

const TOKEN_MAP = {
  bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', ether: 'ETH',
  solana: 'SOL', sol: 'SOL', xrp: 'XRP', ripple: 'XRP', cardano: 'ADA',
  dogecoin: 'DOGE', doge: 'DOGE', polkadot: 'DOT', avalanche: 'AVAX',
  chainlink: 'LINK', polygon: 'MATIC', uniswap: 'UNI', litecoin: 'LTC',
  cosmos: 'ATOM', near: 'NEAR', sui: 'SUI', aptos: 'APT', pepe: 'PEPE',
  bonk: 'BONK', shiba: 'SHIB', toncoin: 'TON', ton: 'TON', arbitrum: 'ARB',
  optimism: 'OP', bnb: 'BNB', binance: 'BNB', aave: 'AAVE', tron: 'TRX',
  stellar: 'XLM', hedera: 'HBAR', mantle: 'MNT', sei: 'SEI', jupiter: 'JUP',
};

export class RedditClient {
  constructor(config = {}) {
    this.subreddits = config.subreddits || [
      'CryptoMoonShots', 'cryptocurrency', 'SatoshiStreetBets',
    ];
    this.sort = config.sort || 'hot';
    this.limit = config.limit || 15;
    this.cacheTtlMs = (config.cache_ttl_seconds || 180) * 1000;
    this.logger = new Logger('Reddit');
    this.cache = { data: null, ts: 0 };
    this.seenIds = new Set();
  }

  async scan() {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];
    for (const sub of this.subreddits) {
      try {
        const posts = await this._fetchSubreddit(sub);
        for (const post of posts) {
          if (!this.seenIds.has(post.id)) {
            this.seenIds.add(post.id);
            signals.push(post);
          }
        }
      } catch (err) {
        this.logger.error(`r/${sub} failed: ${err.message}`);
      }
    }

    if (this.seenIds.size > 1000) {
      const arr = Array.from(this.seenIds);
      this.seenIds = new Set(arr.slice(-500));
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} posts from ${this.subreddits.length} subreddits`);
    return signals;
  }

  async _fetchSubreddit(sub) {
    const url = `https://www.reddit.com/r/${sub}/${this.sort}.json?limit=${this.limit}&raw_json=1`;
    this.logger.debug(`Fetching r/${sub}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AlphaSwarm/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const posts = [];
    const children = data?.data?.children || [];
    for (const child of children) {
      const d = child.data;
      if (!d || d.stickied) continue;

      const text = `${d.title || ''} ${(d.selftext || '').slice(0, 500)}`;
      const tokens = this._extractTokens(text);
      if (tokens.length === 0) continue;

      const score = this._scorePost(d, tokens);

      for (const symbol of tokens) {
        posts.push({
          id: d.id,
          subreddit: sub,
          title: d.title || '',
          text: (d.selftext || '').slice(0, 300),
          url: `https://reddit.com${d.permalink}`,
          author: d.author || '',
          upvotes: d.ups || 0,
          upvote_ratio: d.upvote_ratio || 0,
          num_comments: d.num_comments || 0,
          created_utc: d.created_utc || 0,
          token: { name: symbol, symbol },
          signal_strength: score,
        });
      }
    }
    return posts;
  }

  _extractTokens(text) {
    const tokens = new Set();
    const cashTags = text.match(/\$([A-Z]{2,10})\b/g);
    if (cashTags) {
      for (const tag of cashTags) tokens.add(tag.slice(1));
    }
    const lower = text.toLowerCase();
    for (const [name, symbol] of Object.entries(TOKEN_MAP)) {
      if (lower.includes(name)) tokens.add(symbol);
    }
    return Array.from(tokens);
  }

  _scorePost(data, tokens) {
    let score = 3;
    const ups = data.ups || 0;
    const comments = data.num_comments || 0;
    const ratio = data.upvote_ratio || 0.5;

    if (ups >= 100) score += 2;
    else if (ups >= 20) score += 1;

    if (comments >= 50) score += 2;
    else if (comments >= 10) score += 1;

    if (ratio >= 0.85) score += 1;

    if (tokens.length >= 2) score += 1;

    return Math.min(10, score);
  }
}
