import { Logger } from '../utils/logger.js';

export class CoinGeckoClient {
  constructor(config = {}) {
    this.baseUrl = 'https://api.coingecko.com/api/v3';
    this.watchTrending = config.watch_trending !== false;
    this.watchGainers = config.watch_gainers !== false;
    this.logger = new Logger('CoinGecko');
    this.cache = new Map();
    this.cacheTtlMs = 180_000; // 3 min cache
    this.requestTimestamps = [];
  }

  async scan() {
    const signals = [];

    if (this.watchTrending) {
      try {
        const trending = await this._cachedFetch('trending', '/search/trending');
        if (trending?.coins) {
          for (const entry of trending.coins) {
            const coin = entry.item || entry;
            signals.push({
              source: 'coingecko',
              type: 'trending',
              token: {
                name: coin.name || 'Unknown',
                symbol: (coin.symbol || '???').toUpperCase(),
                chain: 'multi',
                address: coin.id || '',
                price_usd: coin.data?.price || coin.price_btc || 0,
                volume_24h: coin.data?.total_volume || 0,
                volume_change_pct: 0,
                liquidity_usd: 0,
                market_cap: coin.data?.market_cap || coin.market_cap_rank || 0,
                price_change_24h: coin.data?.price_change_percentage_24h?.usd || 0,
                coingecko_score: coin.score != null ? coin.score + 1 : 0,
              },
            });
          }
        }
      } catch (err) {
        this.logger.error(`Trending fetch failed: ${err.message}`);
      }
    }

    if (this.watchGainers) {
      try {
        const markets = await this._cachedFetch(
          'markets',
          '/coins/markets?vs_currency=usd&order=volume_desc&per_page=20&page=1&sparkline=false'
        );
        if (Array.isArray(markets)) {
          for (const coin of markets) {
            if (Math.abs(coin.price_change_percentage_24h || 0) > 10) {
              signals.push({
                source: 'coingecko',
                type: 'volume_leader',
                token: {
                  name: coin.name || 'Unknown',
                  symbol: (coin.symbol || '???').toUpperCase(),
                  chain: 'multi',
                  address: coin.id || '',
                  price_usd: coin.current_price || 0,
                  volume_24h: coin.total_volume || 0,
                  volume_change_pct: 0,
                  liquidity_usd: 0,
                  market_cap: coin.market_cap || 0,
                  price_change_24h: coin.price_change_percentage_24h || 0,
                },
              });
            }
          }
        }
      } catch (err) {
        this.logger.error(`Markets fetch failed: ${err.message}`);
      }
    }

    this.logger.info(`Scan complete: ${signals.length} signals found`);
    return signals;
  }

  async _cachedFetch(key, endpoint) {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && (now - cached.ts) < this.cacheTtlMs) {
      this.logger.debug(`Cache hit: ${key}`);
      return cached.data;
    }
    const data = await this._fetch(endpoint);
    this.cache.set(key, { data, ts: now });
    return data;
  }

  async _fetch(endpoint) {
    await this._rateLimit();
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint}`);
    return res.json();
  }

  async _rateLimit() {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60_000);
    if (this.requestTimestamps.length >= 25) {
      const waitMs = 60_000 - (now - this.requestTimestamps[0]);
      this.logger.debug(`Rate limit: waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    this.requestTimestamps.push(Date.now());
  }
}
