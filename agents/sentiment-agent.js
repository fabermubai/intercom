import { BaseAgent } from './base-agent.js';
import { CoinGeckoClient } from '../sources/coingecko.js';

export class SentimentAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Sentiment Analyst', 'sentiment', peer, config);
    this.coingecko = new CoinGeckoClient(config.sources?.coingecko || {});
    this.previousSentiment = new Map();
  }

  async scan() {
    const signals = [];

    let geckoResults = [];
    try {
      geckoResults = await this.coingecko.scan();
    } catch (err) {
      this.logger.error(`CoinGecko trending failed: ${err.message}`);
    }

    for (const r of geckoResults) {
      const symbol = r.token?.symbol?.toUpperCase();
      if (!symbol) continue;
      const strength = r.signal_strength || 6;
      const prevStrength = this.previousSentiment.get(symbol) || 0;
      const shift = strength - prevStrength;
      this.previousSentiment.set(symbol, strength);

      if (strength >= 5 || Math.abs(shift) >= 2) {
        signals.push({
          source: 'sentiment',
          type: shift >= 2 ? 'sentiment_shift' : 'strong_sentiment',
          token: { name: symbol, symbol },
          sentiment: {
            trending: true,
            shift: shift > 0 ? `+${shift.toFixed(1)}` : shift.toFixed(1),
            price_change_24h: r.token?.price_change_24h,
            market_cap_rank: r.token?.market_cap_rank,
          },
          signal_strength: strength,
          reasoning: `${symbol} trending on CoinGecko${shift >= 2 ? `, sentiment shifted +${shift.toFixed(1)}` : ''}`,
          risks: r.token?.market_cap_rank > 200 ? ['Low market cap rank'] : [],
        });
      }
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'market sentiment specialist focused on community sentiment, social trends, and market psychology',
    };
  }

}
