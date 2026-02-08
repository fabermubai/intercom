import { Logger } from '../utils/logger.js';

export class DexScreenerClient {
  constructor(config = {}) {
    this.baseUrl = 'https://api.dexscreener.com';
    this.chains = config.chains || ['solana', 'ethereum', 'base'];
    this.minVolume = config.min_volume_usd || 50000;
    this.minLiquidity = config.min_liquidity_usd || 10000;
    this.maxAgeHours = config.max_age_hours || 24;
    this.logger = new Logger('DexScreener');
    this.cache = { data: null, ts: 0 };
    this.cacheTtlMs = 60_000;
    this.requestTimestamps = [];
  }

  async scan() {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      this.logger.debug('Returning cached results');
      return this.cache.data;
    }

    const signals = [];

    try {
      const boosted = await this._fetch('/token-boosts/top/v1');
      if (Array.isArray(boosted)) {
        for (const item of boosted) {
          const pair = await this._fetchTokenPairs(item.chainId, item.tokenAddress);
          if (pair) {
            const normalized = this._normalizePair(pair, item.chainId);
            if (normalized && this._filterPair(normalized)) {
              signals.push({
                source: 'dexscreener',
                type: this._classifySignal(normalized),
                token: normalized,
              });
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Scan failed: ${err.message}`);
    }

    // Scan latest token profiles (freshly listed tokens)
    try {
      const latest = await this._fetch('/token-profiles/latest/v1');
      if (Array.isArray(latest)) {
        const seen = new Set(signals.map(s => s.token.address));
        for (const item of latest.slice(0, 15)) {
          if (!item.chainId || !item.tokenAddress || seen.has(item.tokenAddress)) continue;
          const pair = await this._fetchTokenPairs(item.chainId, item.tokenAddress);
          if (pair) {
            const normalized = this._normalizePair(pair, item.chainId);
            if (normalized && this._filterPair(normalized, true)) {
              seen.add(normalized.address);
              signals.push({
                source: 'dexscreener',
                type: this._classifySignal(normalized),
                token: normalized,
              });
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Latest profiles scan failed: ${err.message}`);
    }

    // Also search for trending pairs on watched chains
    try {
      for (const chain of this.chains) {
        const results = await this._fetch(`/latest/dex/search?q=trending&chain=${chain}`);
        if (results?.pairs) {
          for (const pair of results.pairs.slice(0, 5)) {
            const normalized = this._normalizePair(pair, chain);
            if (normalized && this._filterPair(normalized)) {
              if (!signals.some(s => s.token.address === normalized.address)) {
                signals.push({
                  source: 'dexscreener',
                  type: this._classifySignal(normalized),
                  token: normalized,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Trending search failed: ${err.message}`);
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} signals found`);
    return signals;
  }

  async _fetchTokenPairs(chainId, tokenAddress) {
    try {
      const data = await this._fetch(`/token-pairs/v1/${chainId}/${tokenAddress}`);
      if (Array.isArray(data) && data.length > 0) {
        return data.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];
      }
      return null;
    } catch {
      return null;
    }
  }

  _normalizePair(pair, chain) {
    if (!pair) return null;
    const bt = pair.baseToken || {};
    const now = Date.now();
    const createdAt = pair.pairCreatedAt || now;
    const ageHours = (now - createdAt) / 3_600_000;

    return {
      name: bt.name || pair.name || 'Unknown',
      symbol: bt.symbol || pair.symbol || '???',
      chain: pair.chainId || chain || 'unknown',
      address: bt.address || pair.pairAddress || '',
      price_usd: parseFloat(pair.priceUsd) || 0,
      volume_24h: pair.volume?.h24 || 0,
      volume_change_pct: pair.volume?.h1
        ? Math.round(((pair.volume.h1 * 24) / Math.max(pair.volume.h24 || 1, 1) - 1) * 100)
        : 0,
      liquidity_usd: pair.liquidity?.usd || 0,
      age_hours: Math.round(ageHours * 10) / 10,
      market_cap: pair.marketCap || pair.fdv || 0,
      price_change_1h: pair.priceChange?.h1 || 0,
      price_change_24h: pair.priceChange?.h24 || 0,
      pair_url: pair.url || '',
    };
  }

  _filterPair(token, isLatest = false) {
    // Young tokens (< 48h) get relaxed thresholds to catch early gems
    const isYoung = token.age_hours < 48;
    const minVol = isYoung ? this.minVolume * 0.4 : this.minVolume; // 20K vs 50K
    const minLiq = isYoung ? this.minLiquidity * 0.5 : this.minLiquidity; // 5K vs 10K

    if (token.volume_24h < minVol) return false;
    if (token.liquidity_usd < minLiq) return false;
    if (!isLatest && token.age_hours > this.maxAgeHours * 24) return false;
    return true;
  }

  _classifySignal(token) {
    if (token.age_hours < 24) return 'new_token';
    if (token.volume_change_pct > 300) return 'volume_spike';
    if (Math.abs(token.price_change_1h) > 20) return 'price_movement';
    return 'trending';
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
    if (this.requestTimestamps.length >= 250) {
      const waitMs = 60_000 - (now - this.requestTimestamps[0]);
      this.logger.debug(`Rate limit: waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    this.requestTimestamps.push(Date.now());
  }
}
