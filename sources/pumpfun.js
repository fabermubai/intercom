import { Logger } from '../utils/logger.js';

// Approximate SOL price for market cap conversion (updated periodically)
const SOL_PRICE_USD = 200;

export class PumpFunClient {
  constructor(config = {}) {
    this.baseUrl = 'https://frontend-api-v3.pump.fun';
    this.enabled = config.enabled !== false;
    this.logger = new Logger('PumpFun');
    this.cache = { data: null, ts: 0 };
    this.cacheTtlMs = (config.cache_ttl_seconds || 60) * 1000;
    this.seenMints = new Set();
    this.minMarketCapSol = config.min_market_cap_sol || 1; // minimum MC in SOL
  }

  async scan() {
    if (!this.enabled) return [];

    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];

    // 1. Latest coin (just launched)
    try {
      const latest = await this._fetch('/coins/latest');
      if (latest && latest.mint && !this.seenMints.has(latest.mint)) {
        this.seenMints.add(latest.mint);
        const token = this._normalize(latest);
        if (token) signals.push({ source: 'pumpfun', type: 'new_launch', token });
      }
    } catch (err) {
      this.logger.error(`Latest coin fetch failed: ${err.message}`);
    }

    // 2. King of the Hill (hottest token)
    try {
      const king = await this._fetch('/coins/king-of-the-hill?includeNsfw=false');
      if (king && king.mint && !this.seenMints.has(king.mint)) {
        this.seenMints.add(king.mint);
        const token = this._normalize(king);
        if (token) signals.push({ source: 'pumpfun', type: 'king_of_hill', token });
      }
    } catch (err) {
      this.logger.error(`King of the Hill fetch failed: ${err.message}`);
    }

    // 3. Current trending metas
    try {
      const metas = await this._fetch('/metas/current');
      if (Array.isArray(metas)) {
        for (const meta of metas.slice(0, 5)) {
          if (meta.mint && !this.seenMints.has(meta.mint)) {
            this.seenMints.add(meta.mint);
            const token = this._normalize(meta);
            if (token) signals.push({ source: 'pumpfun', type: 'trending_meta', token });
          }
        }
      }
    } catch (err) {
      this.logger.debug(`Metas fetch failed: ${err.message}`);
    }

    // Prune seen mints (keep last 500)
    if (this.seenMints.size > 500) {
      const arr = [...this.seenMints];
      this.seenMints = new Set(arr.slice(-300));
    }

    this.cache = { data: signals, ts: now };
    if (signals.length > 0) {
      this.logger.info(`Found ${signals.length} pump.fun signals`);
    }
    return signals;
  }

  _normalize(coin) {
    if (!coin || !coin.mint) return null;

    const mcSol = coin.market_cap || 0;
    if (mcSol < this.minMarketCapSol) return null;

    const mcUsd = mcSol * SOL_PRICE_USD;
    const createdTs = coin.created_timestamp ? coin.created_timestamp * 1000 : Date.now();
    const ageHours = Math.max(0, (Date.now() - createdTs) / 3_600_000);

    // Calculate price from bonding curve reserves
    let priceUsd = 0;
    if (coin.virtual_sol_reserves && coin.virtual_token_reserves) {
      const priceSol = (coin.virtual_sol_reserves / 1e9) / (coin.virtual_token_reserves / 1e6);
      priceUsd = priceSol * SOL_PRICE_USD;
    }

    return {
      name: coin.name || 'Unknown',
      symbol: coin.symbol || '???',
      chain: 'solana',
      address: coin.mint,
      price_usd: priceUsd,
      volume_24h: 0, // pump.fun doesn't expose volume directly
      liquidity_usd: coin.virtual_sol_reserves ? (coin.virtual_sol_reserves / 1e9) * SOL_PRICE_USD : 0,
      market_cap: mcUsd,
      age_hours: Math.round(ageHours * 10) / 10,
      price_change_1h: 0,
      price_change_24h: 0,
      pair_url: `https://pump.fun/coin/${coin.mint}`,
      graduated: !!coin.complete,
      reply_count: coin.reply_count || 0,
      has_socials: !!(coin.twitter || coin.telegram || coin.website),
    };
  }

  async _fetch(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;
    this.logger.debug(`Fetching: ${url}`);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}
