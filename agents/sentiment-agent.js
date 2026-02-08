import { BaseAgent } from './base-agent.js';
import { CryptoPanicClient } from '../sources/cryptopanic.js';
import { CoinGeckoClient } from '../sources/coingecko.js';
import { Scoring } from '../utils/scoring.js';

export class SentimentAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Sentiment Analyst', 'sentiment', peer, config);
    this.cryptopanic = new CryptoPanicClient(config.sources?.cryptopanic || {});
    this.coingecko = new CoinGeckoClient(config.sources?.coingecko || {});
    this.previousSentiment = new Map();
  }

  async scan() {
    const signals = [];

    // Get trending coins from CoinGecko
    let trendingSymbols = new Set();
    try {
      const geckoResults = await this.coingecko.scan();
      for (const r of geckoResults) {
        if (r.token?.symbol) trendingSymbols.add(r.token.symbol.toUpperCase());
      }
    } catch (err) {
      this.logger.error(`CoinGecko trending failed: ${err.message}`);
    }

    // Get CryptoPanic posts with votes
    try {
      if (this.config.sources?.cryptopanic?.api_key) {
        const posts = await this.cryptopanic.scan();
        // Group posts by token
        const tokenSentiment = new Map();

        for (const post of posts) {
          for (const token of (post.tokens || [])) {
            const sym = token.code?.toUpperCase();
            if (!sym) continue;
            if (!tokenSentiment.has(sym)) {
              tokenSentiment.set(sym, { positive: 0, negative: 0, count: 0, titles: [] });
            }
            const entry = tokenSentiment.get(sym);
            entry.positive += post.votes?.positive || 0;
            entry.negative += post.votes?.negative || 0;
            entry.count++;
            entry.titles.push(post.title);
          }
        }

        for (const [symbol, data] of tokenSentiment) {
          const isTrending = trendingSymbols.has(symbol);
          const strength = Scoring.sentimentScore(data.positive, data.negative, isTrending);
          const prevStrength = this.previousSentiment.get(symbol) || 0;
          const shift = strength - prevStrength;

          this.previousSentiment.set(symbol, strength);

          // Only report if sentiment is strong OR shifted significantly
          if (strength >= 6 || Math.abs(shift) >= 2) {
            const total = data.positive + data.negative;
            const ratio = total > 0 ? Math.round((data.positive / total) * 100) : 50;

            signals.push({
              source: 'sentiment',
              type: shift >= 2 ? 'sentiment_shift' : 'strong_sentiment',
              token: {
                name: symbol,
                symbol,
              },
              sentiment: {
                positive: data.positive,
                negative: data.negative,
                ratio: `${ratio}% bullish`,
                trending: isTrending,
                mentions: data.count,
                shift: shift > 0 ? `+${shift.toFixed(1)}` : shift.toFixed(1),
              },
              signal_strength: strength,
              reasoning: this._buildReasoning(symbol, data, isTrending, shift),
              risks: this._assessRisks(data, isTrending),
            });
          }
        }
      }
    } catch (err) {
      this.logger.error(`Sentiment analysis failed: ${err.message}`);
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

  _buildReasoning(symbol, data, isTrending, shift) {
    const parts = [];
    const total = data.positive + data.negative;
    const ratio = total > 0 ? Math.round((data.positive / total) * 100) : 50;

    parts.push(`${symbol}: ${ratio}% bullish across ${data.count} mentions`);
    if (isTrending) parts.push('Currently trending on CoinGecko');
    if (shift >= 2) parts.push(`Sentiment shifted +${shift.toFixed(1)} points`);
    if (shift <= -2) parts.push(`Sentiment dropped ${shift.toFixed(1)} points`);
    return parts.join('. ');
  }

  _assessRisks(data, isTrending) {
    const risks = [];
    const total = data.positive + data.negative;
    if (total < 10) risks.push('Low sample size for sentiment analysis');
    if (data.positive / Math.max(total, 1) > 0.95) risks.push('Extremely one-sided sentiment may indicate echo chamber');
    if (!isTrending) risks.push('Not trending on major platforms');
    return risks;
  }
}
