import { BaseAgent } from './base-agent.js';
import { RSSClient } from '../sources/rss.js';
import { Scoring } from '../utils/scoring.js';

// Map of known token names/aliases to symbols for extraction from news titles
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

function extractTokenSymbol(text) {
  // Check for $SYMBOL pattern first
  const cashTag = text.match(/\$([A-Z]{2,10})\b/);
  if (cashTag) return cashTag[1];
  // Check known token names
  const lower = text.toLowerCase();
  for (const [name, symbol] of Object.entries(TOKEN_MAP)) {
    if (lower.includes(name)) return symbol;
  }
  return '';
}

export class NewsAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('News Hawk', 'news', peer, config);
    this.rss = new RSSClient(config.sources?.rss || {});
    this.seenUrls = new Set();
  }

  async scan() {
    const signals = [];

    // RSS scan
    try {
      const rssResults = await this.rss.scan();
      for (const article of rssResults) {
        if (!this.seenUrls.has(article.url)) {
          this.seenUrls.add(article.url);
          const symbol = extractTokenSymbol(`${article.title} ${article.description || ''}`);
          signals.push({
            source: 'rss',
            type: 'news_article',
            token: {
              name: symbol || article.title.slice(0, 30),
              symbol,
            },
            news: {
              title: article.title,
              source: article.feed_source,
              url: article.url,
              description: article.description,
            },
            signal_strength: symbol ? 6 : 4,
            reasoning: `News article: "${article.title}"${symbol ? ` (mentions ${symbol})` : ''}`,
            risks: ['RSS articles need cross-referencing with price data'],
          });
        }
      }
    } catch (err) {
      this.logger.error(`RSS scan failed: ${err.message}`);
    }

    // Cleanup
    if (this.seenUrls.size > 500) {
      const arr = Array.from(this.seenUrls);
      this.seenUrls = new Set(arr.slice(-250));
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'crypto news analyst focused on catalysts, listings, partnerships, and regulatory changes',
    };
  }

}
