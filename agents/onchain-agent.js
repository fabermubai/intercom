import { BaseAgent } from './base-agent.js';
import { DexScreenerClient } from '../sources/dexscreener.js';
import { CoinGeckoClient } from '../sources/coingecko.js';
import { Scoring } from '../utils/scoring.js';

export class OnChainAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('OnChain Scout', 'onchain', peer, config);
    this.dexscreener = new DexScreenerClient(config.sources?.dexscreener || {});
    this.coingecko = new CoinGeckoClient(config.sources?.coingecko || {});
    this.seenTokens = new Map();
  }

  async scan() {
    const signals = [];

    // DexScreener scan
    try {
      const dexResults = await this.dexscreener.scan();
      for (const result of dexResults) {
        const addr = result.token?.address;
        if (addr && !this._isDuplicate(addr)) {
          result.signal_strength = Scoring.volumeScore(
            result.token.volume_change_pct || 0,
            result.token.volume_24h || 0,
            result.token.liquidity_usd || 0,
            result.token.age_hours
          );
          if (result.signal_strength >= 5) {
            result.reasoning = this._buildReasoning(result);
            result.risks = this._assessRisks(result);
            signals.push(result);
          }
        }
      }
    } catch (err) {
      this.logger.error(`DexScreener scan failed: ${err.message}`);
    }

    // CoinGecko scan
    try {
      const geckoResults = await this.coingecko.scan();
      for (const result of geckoResults) {
        const id = result.token?.address || result.token?.symbol;
        if (id && !this._isDuplicate(id)) {
          result.signal_strength = Scoring.volumeScore(
            Math.abs(result.token.price_change_24h || 0) * 5,
            result.token.volume_24h || 0,
            result.token.liquidity_usd || 0
          );
          if (result.signal_strength >= 5) {
            result.reasoning = `Trending on CoinGecko. Price change 24h: ${result.token.price_change_24h}%`;
            result.risks = ['CoinGecko data may lag behind DEX data'];
            signals.push(result);
          }
        }
      }
    } catch (err) {
      this.logger.error(`CoinGecko scan failed: ${err.message}`);
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'on-chain analyst focused on volume, liquidity, token age, and holder distribution',
    };
  }

  _buildReasoning(result) {
    const t = result.token;
    const parts = [];
    if (t.volume_change_pct > 300) parts.push(`Volume spike ${t.volume_change_pct}% in recent window`);
    if (t.volume_24h > 1_000_000) parts.push(`High 24h volume: $${(t.volume_24h / 1e6).toFixed(1)}M`);
    if (t.liquidity_usd > 100_000) parts.push(`Solid liquidity: $${(t.liquidity_usd / 1e3).toFixed(0)}K`);
    if (t.age_hours < 24) parts.push(`New token (${t.age_hours}h old)`);
    if (Math.abs(t.price_change_1h) > 20) parts.push(`Sharp price movement: ${t.price_change_1h}% 1h`);
    return parts.join('. ') || 'Detected on-chain activity above thresholds';
  }

  _assessRisks(result) {
    const t = result.token;
    const risks = [];
    if (t.age_hours < 6 && (t.liquidity_usd < 50_000 || t.volume_24h < 50_000)) {
      risks.push(`Very young token (${t.age_hours}h) with thin metrics`);
    }
    if (t.liquidity_usd < 50_000) risks.push(`Low liquidity ($${(t.liquidity_usd / 1e3).toFixed(0)}K)`);
    if (t.volume_change_pct > 1000) risks.push('Extreme volume spike may indicate wash trading');
    return risks;
  }

  _isDuplicate(key) {
    const now = Date.now();
    const last = this.seenTokens.get(key);
    if (last && (now - last) < 300_000) return true;
    this.seenTokens.set(key, now);
    if (this.seenTokens.size > 1000) {
      for (const [k, ts] of this.seenTokens) {
        if (now - ts > 600_000) this.seenTokens.delete(k);
      }
    }
    return false;
  }
}
