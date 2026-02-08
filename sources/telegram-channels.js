import { Logger } from '../utils/logger.js';

// Same token map as news-agent for consistency
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

const CALL_KEYWORDS = [
  'moon', 'gem', 'alpha', 'call', 'signal', 'buy', 'ape',
  'breakout', 'pump', '100x', '10x', '50x', 'entry', 'target',
  'bullish', 'long', 'accumulate', 'dip', 'undervalued',
];

export class TelegramChannelsClient {
  constructor(config = {}) {
    this.channels = (config.channels || []).map(c => c.replace(/^@/, ''));
    this.keywords = config.keywords || CALL_KEYWORDS;
    this.cacheTtlMs = (config.cache_ttl_seconds || 120) * 1000;
    this.logger = new Logger('TelegramScan');
    this.cache = { data: null, ts: 0 };
    this.seenIds = new Set();
  }

  async scan() {
    if (this.channels.length === 0) {
      this.logger.warn('No channels configured, skipping');
      return [];
    }

    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    const signals = [];
    for (const channel of this.channels) {
      try {
        const messages = await this._fetchChannel(channel);
        for (const msg of messages) {
          const id = `${channel}/${msg.messageId}`;
          if (!this.seenIds.has(id)) {
            this.seenIds.add(id);
            const tokens = this._extractTokens(msg.text);
            const strength = this._scoreMessage(msg.text, tokens);
            if (tokens.length > 0 && strength >= 3) {
              for (const symbol of tokens) {
                signals.push({
                  channel,
                  messageId: msg.messageId,
                  text: msg.text.slice(0, 500),
                  link: `https://t.me/${channel}/${msg.messageId}`,
                  posted_at: msg.datetime || '',
                  token: { name: symbol, symbol },
                  signal_strength: strength,
                });
              }
            }
          }
        }
      } catch (err) {
        this.logger.error(`Channel ${channel} failed: ${err.message}`);
      }
    }

    // Cleanup old IDs
    if (this.seenIds.size > 1000) {
      const arr = Array.from(this.seenIds);
      this.seenIds = new Set(arr.slice(-500));
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} signals from ${this.channels.length} channels`);
    return signals;
  }

  async _fetchChannel(channel) {
    const url = `https://t.me/s/${channel}`;
    this.logger.debug(`Fetching channel: ${channel}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return this._parseMessages(html, channel);
  }

  _parseMessages(html, channel) {
    const messages = [];

    // Extract message blocks using data-post attribute
    const msgRegex = /data-post="([^"]*)"[\s\S]*?tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/gi;
    let match;
    while ((match = msgRegex.exec(html)) !== null) {
      const postId = match[1]; // format: "channel/123"
      const rawHtml = match[2];
      const text = this._stripHtml(rawHtml);
      const messageId = postId.split('/').pop() || '';

      // Try to find datetime near this message
      const dtRegex = new RegExp(`data-post="${postId.replace('/', '\\/')}"[\\s\\S]{0,2000}?datetime="([^"]*)"`, 'i');
      const dtMatch = html.match(dtRegex);

      if (text.length > 10) {
        messages.push({
          messageId,
          text,
          datetime: dtMatch ? dtMatch[1] : '',
        });
      }
    }

    // Fallback: try simpler pattern if first regex finds nothing
    if (messages.length === 0) {
      const simpleRegex = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/gi;
      let idx = 0;
      while ((match = simpleRegex.exec(html)) !== null) {
        const text = this._stripHtml(match[1]);
        if (text.length > 10) {
          messages.push({
            messageId: String(idx++),
            text,
            datetime: '',
          });
        }
      }
    }

    return messages.slice(-15); // Last 15 messages
  }

  _extractTokens(text) {
    const tokens = new Set();

    // $SYMBOL cashtags
    const cashTags = text.match(/\$([A-Z]{2,10})\b/g);
    if (cashTags) {
      for (const tag of cashTags) {
        tokens.add(tag.slice(1));
      }
    }

    // #SYMBOL hashtags
    const hashTags = text.match(/#([A-Z]{2,10})\b/g);
    if (hashTags) {
      for (const tag of hashTags) {
        tokens.add(tag.slice(1));
      }
    }

    // Known token names
    const lower = text.toLowerCase();
    for (const [name, symbol] of Object.entries(TOKEN_MAP)) {
      if (lower.includes(name)) tokens.add(symbol);
    }

    return Array.from(tokens);
  }

  _scoreMessage(text, tokens) {
    let score = 3; // Base score for any message with tokens

    const lower = text.toLowerCase();
    let keywordHits = 0;
    for (const kw of this.keywords) {
      if (lower.includes(kw.toLowerCase())) keywordHits++;
    }

    // Keyword bonus: +1 per 2 keywords, max +3
    score += Math.min(3, Math.floor(keywordHits / 2));

    // Multiple tokens mentioned: +1
    if (tokens.length >= 2) score += 1;

    // Message has numbers (prices, targets): +1
    if (/\d+[\.,]\d+/.test(text) || /\$\d/.test(text)) score += 1;

    // Contract address present: +1
    if (/0x[a-fA-F0-9]{20,}/.test(text) || /[1-9A-HJ-NP-Za-km-z]{32,}/.test(text)) score += 1;

    return Math.min(10, score);
  }

  _stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }
}
