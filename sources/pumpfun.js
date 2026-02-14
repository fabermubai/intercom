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
    this.apiAvailable = true; // set false after 401/403, retried every 10 min
    this.apiRetryAfter = 0;
  }

  async scan() {
    if (!this.enabled) return [];

    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    let signals = [];

    // Try pump.fun API first (may require JWT)
    if (this.apiAvailable || now > this.apiRetryAfter) {
      signals = await this._scanPumpApi();
    }

    // Fallback: DexScreener search for fresh Solana tokens
    if (signals.length === 0) {
      signals = await this._scanDexScreenerFallback();
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

  async _scanPumpApi() {
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
      this.logger.debug(`Latest coin fetch failed: ${err.message}`);
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
      this.logger.debug(`King of the Hill fetch failed: ${err.message}`);
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

    return signals;
  }

  async _scanDexScreenerFallback() {
    const signals = [];
    try {
      this.logger.debug('Fallback: DexScreener latest Solana profiles');
      const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) return signals;
      const data = await res.json();
      if (!Array.isArray(data)) return signals;

      const solTokens = data.filter(t => t.chainId === 'solana').slice(0, 15);
      for (const item of solTokens) {
        if (!item.tokenAddress || this.seenMints.has(item.tokenAddress)) continue;
        try {
          const pairRes = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${item.tokenAddress}`);
          if (!pairRes.ok) continue;
          const pairs = await pairRes.json();
          if (!Array.isArray(pairs) || pairs.length === 0) continue;
          const pair = pairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];
          const bt = pair.baseToken || {};
          const ageHours = (Date.now() - (pair.pairCreatedAt || Date.now())) / 3_600_000;
          if (ageHours > 24) continue; // only fresh tokens

          this.seenMints.add(item.tokenAddress);
          const hasSocials = !!(item.links?.length > 0 || item.websites?.length > 0);
          const graduated = !!(pair.dexId && pair.dexId !== 'pumpfun');
          signals.push({
            source: 'pumpfun_dex',
            type: graduated ? 'graduated' : 'new_token',
            token: {
              name: bt.name || 'Unknown',
              symbol: bt.symbol || '???',
              chain: 'solana',
              address: item.tokenAddress,
              price_usd: parseFloat(pair.priceUsd) || 0,
              volume_24h: pair.volume?.h24 || 0,
              liquidity_usd: pair.liquidity?.usd || 0,
              market_cap: pair.marketCap || pair.fdv || 0,
              age_hours: Math.round(ageHours * 10) / 10,
              price_change_1h: pair.priceChange?.h1 || 0,
              price_change_24h: pair.priceChange?.h24 || 0,
              has_socials: hasSocials,
              graduated,
              reply_count: 0,
              pair_url: pair.url || `https://dexscreener.com/solana/${item.tokenAddress}`,
            },
          });
        } catch { continue; }
      }
    } catch (err) {
      this.logger.error(`DexScreener fallback failed: ${err.message}`);
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
    if (res.status === 401 || res.status === 403) {
      this.apiAvailable = false;
      this.apiRetryAfter = Date.now() + 600_000; // retry in 10 min
      throw new Error(`Auth required (${res.status}) — will use DexScreener fallback`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.apiAvailable = true; // confirmed working
    return res.json();
  }
}
