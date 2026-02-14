import { BaseAgent } from './base-agent.js';
import { DexScreenerClient } from '../sources/dexscreener.js';
import { CoinGeckoClient } from '../sources/coingecko.js';
import { PumpFunClient } from '../sources/pumpfun.js';
import { GMGNClient } from '../sources/gmgn.js';
import { Scoring } from '../utils/scoring.js';

export class OnChainAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('OnChain Scout', 'onchain', peer, config);
    this.dexscreener = new DexScreenerClient(config.sources?.dexscreener || {});
    this.coingecko = new CoinGeckoClient(config.sources?.coingecko || {});
    this.pumpfun = new PumpFunClient(config.sources?.pumpfun || {});
    this.gmgn = new GMGNClient(config.sources?.gmgn || {});
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
          // Lower threshold for young tokens — catch early gems
          const minStrength = (result.token.age_hours || 999) < 48 ? 4 : 5;
          if (result.signal_strength >= minStrength) {
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

    // Pump.fun scan (brand new Solana tokens)
    try {
      const pumpResults = await this.pumpfun.scan();
      for (const result of pumpResults) {
        const addr = result.token?.address;
        if (addr && !this._isDuplicate(addr)) {
          // New pump.fun tokens get a generous score — they are ultra-fresh
          const ageBonus = result.token.age_hours < 1 ? 3 : result.token.age_hours < 6 ? 2 : 1;
          const socialBonus = result.token.has_socials ? 1 : 0;
          const graduatedBonus = result.token.graduated ? 2 : 0;
          const kingBonus = result.type === 'king_of_hill' ? 2 : 0;
          result.signal_strength = Math.min(10, 4 + ageBonus + socialBonus + graduatedBonus + kingBonus);
          result.reasoning = this._buildPumpReasoning(result);
          result.risks = this._assessPumpRisks(result);
          signals.push(result);
        }
      }
    } catch (err) {
      this.logger.error(`Pump.fun scan failed: ${err.message}`);
    }

    // GMGN scan (trending Solana tokens)
    try {
      const gmgnResults = await this.gmgn.scan();
      for (const result of gmgnResults) {
        const addr = result.token?.address;
        if (addr && !this._isDuplicate(addr)) {
          result.signal_strength = Scoring.volumeScore(
            result.token.price_change_1h ? Math.abs(result.token.price_change_1h) * 5 : 0,
            result.token.volume_24h || 0,
            result.token.liquidity_usd || 0,
            result.token.age_hours
          );
          // Boost for fresh tokens with swaps activity
          if (result.token.age_hours < 6) result.signal_strength = Math.min(10, result.signal_strength + 2);
          if (result.token.swaps_1h > 100) result.signal_strength = Math.min(10, result.signal_strength + 1);
          const minStrength = result.token.age_hours < 24 ? 3 : 4;
          if (result.signal_strength >= minStrength) {
            result.reasoning = this._buildGmgnReasoning(result);
            result.risks = ['GMGN data — verify on DexScreener before aping'];
            signals.push(result);
          }
        }
      }
    } catch (err) {
      this.logger.error(`GMGN scan failed: ${err.message}`);
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

  _buildPumpReasoning(result) {
    const t = result.token;
    const parts = [`New pump.fun launch (${t.age_hours < 1 ? '<1h' : t.age_hours + 'h'} old)`];
    if (result.type === 'king_of_hill') parts.push('King of the Hill on pump.fun');
    if (t.graduated) parts.push('Graduated to Raydium');
    if (t.has_socials) parts.push('Has social links (Twitter/Telegram/Website)');
    if (t.reply_count > 10) parts.push(`${t.reply_count} replies on pump.fun`);
    if (t.liquidity_usd > 10000) parts.push(`Liquidity: $${(t.liquidity_usd / 1e3).toFixed(0)}K`);
    return parts.join('. ');
  }

  _assessPumpRisks(result) {
    const t = result.token;
    const risks = ['Pump.fun token — extremely high risk, potential rug pull'];
    if (!t.has_socials) risks.push('No social links');
    if (!t.graduated) risks.push('Still on bonding curve (not yet on Raydium)');
    if (t.liquidity_usd < 5000) risks.push(`Very low liquidity ($${Math.round(t.liquidity_usd)})`);
    return risks;
  }

  _buildGmgnReasoning(result) {
    const t = result.token;
    const parts = [];
    if (result.type === 'new_pair') parts.push(`New pair on GMGN (${t.age_hours < 1 ? '<1h' : t.age_hours + 'h'} old)`);
    if (result.type === 'trending_swaps') parts.push(`Trending by swaps on GMGN${t.swaps_1h ? ` (${t.swaps_1h} swaps/1h)` : ''}`);
    if (t.volume_24h > 50000) parts.push(`Volume: $${(t.volume_24h / 1e3).toFixed(0)}K`);
    if (t.holder_count > 100) parts.push(`${t.holder_count} holders`);
    if (t.market_cap > 0) parts.push(`MC: $${(t.market_cap / 1e3).toFixed(0)}K`);
    return parts.join('. ') || 'Detected on GMGN';
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
