import { Logger } from '../utils/logger.js';

export class GMGNClient {
  constructor(config = {}) {
    this.baseUrl = 'https://gmgn.ai';
    this.enabled = config.enabled !== false;
    this.logger = new Logger('GMGN');
    this.cache = { data: null, ts: 0 };
    this.cacheTtlMs = (config.cache_ttl_seconds || 120) * 1000;
    this.limit = config.limit || 20;
    this.seenTokens = new Set();
  }

  async scan() {
    if (!this.enabled) return [];

    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];

    // 1. New pairs (freshly launched)
    try {
      const newPairs = await this._fetch(
        `/defi/quotation/v1/pairs/sol/new_pairs?limit=${this.limit}&orderby=open_timestamp&direction=desc&filters[]=not_honeypot`
      );
      const pairs = newPairs?.data?.pairs || newPairs?.data || [];
      if (Array.isArray(pairs)) {
        for (const pair of pairs.slice(0, 10)) {
          const addr = pair.base_address || pair.address || pair.token_address;
          if (addr && !this.seenTokens.has(addr)) {
            this.seenTokens.add(addr);
            const token = this._normalizePair(pair);
            if (token) signals.push({ source: 'gmgn', type: 'new_pair', token });
          }
        }
      }
    } catch (err) {
      this.logger.error(`New pairs fetch failed: ${err.message}`);
    }

    // 2. Trending by swaps (1h)
    try {
      const trending = await this._fetch(
        `/defi/quotation/v1/rank/sol/swaps/1h?orderby=swaps&direction=desc&limit=${this.limit}`
      );
      const ranks = trending?.data?.rank || trending?.data || [];
      if (Array.isArray(ranks)) {
        for (const item of ranks.slice(0, 10)) {
          const addr = item.address || item.token_address || item.mint;
          if (addr && !this.seenTokens.has(addr)) {
            this.seenTokens.add(addr);
            const token = this._normalizeRank(item);
            if (token) signals.push({ source: 'gmgn', type: 'trending_swaps', token });
          }
        }
      }
    } catch (err) {
      this.logger.error(`Trending swaps fetch failed: ${err.message}`);
    }

    // Prune seen tokens
    if (this.seenTokens.size > 500) {
      const arr = [...this.seenTokens];
      this.seenTokens = new Set(arr.slice(-300));
    }

    this.cache = { data: signals, ts: now };
    if (signals.length > 0) {
      this.logger.info(`Found ${signals.length} GMGN signals`);
    }
    return signals;
  }

  _normalizePair(pair) {
    if (!pair) return null;
    const addr = pair.base_address || pair.address || pair.token_address || '';
    const createdTs = pair.open_timestamp ? pair.open_timestamp * 1000 : Date.now();
    const ageHours = Math.max(0, (Date.now() - createdTs) / 3_600_000);

    return {
      name: pair.base_token_info?.name || pair.name || 'Unknown',
      symbol: pair.base_token_info?.symbol || pair.symbol || '???',
      chain: 'solana',
      address: addr,
      price_usd: pair.price || pair.current_price || 0,
      volume_24h: pair.volume_24h || pair.volume || 0,
      liquidity_usd: pair.liquidity || pair.initial_liquidity || 0,
      market_cap: pair.usd_market_cap || pair.market_cap || pair.fdv || 0,
      age_hours: Math.round(ageHours * 10) / 10,
      price_change_1h: pair.price_change_percent1h || 0,
      price_change_24h: pair.price_change_percent24h || 0,
      pair_url: addr ? `https://gmgn.ai/sol/token/${addr}` : '',
      holder_count: pair.holder_count || 0,
      has_socials: !!(pair.website || pair.twitter || pair.telegram),
    };
  }

  _normalizeRank(item) {
    if (!item) return null;
    const addr = item.address || item.token_address || item.mint || '';
    const createdTs = item.created_timestamp ? item.created_timestamp * 1000 : Date.now();
    const ageHours = Math.max(0, (Date.now() - createdTs) / 3_600_000);

    return {
      name: item.name || 'Unknown',
      symbol: item.symbol || '???',
      chain: 'solana',
      address: addr,
      price_usd: item.price || 0,
      volume_24h: item.volume_1h ? item.volume_1h * 24 : (item.volume_24h || 0),
      liquidity_usd: item.liquidity || 0,
      market_cap: item.usd_market_cap || item.market_cap || 0,
      age_hours: Math.round(ageHours * 10) / 10,
      price_change_1h: item.price_change_percent1h || item.price_change_percent5m || 0,
      price_change_24h: item.price_change_percent24h || 0,
      pair_url: addr ? `https://gmgn.ai/sol/token/${addr}` : '',
      holder_count: item.holder_count || 0,
      swaps_1h: item.swaps || 0,
      has_socials: !!(item.website || item.twitter || item.telegram),
    };
  }

  async _fetch(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Fetching: ${url}`);
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://gmgn.ai/?chain=sol',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
