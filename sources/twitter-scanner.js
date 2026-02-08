import { Logger } from '../utils/logger.js';

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

const NITTER_INSTANCES = [
  'xcancel.com',
  'nitter.poast.org',
  'nitter.net',
];

const FETCH_TIMEOUT_MS = 8000;

export class TwitterScannerClient {
  constructor(config = {}) {
    this.accounts = config.accounts || [
      'lookonchain', 'WatcherGuru', 'whale_alert',
      'CryptoCapo_', 'MustStopMurad', 'AltcoinGordon',
    ];
    this.cacheTtlMs = (config.cache_ttl_seconds || 180) * 1000;
    this.logger = new Logger('XScanner');
    this.cache = { data: null, ts: 0 };
    this.seenIds = new Set();
    this.workingInstance = null;
    this.syndicationWorking = null; // null = untested, true/false
    this.syndicationDisabledAt = 0;
    this.nitterFails = 0;
  }

  _timedFetch(url, opts = {}) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
    );
    return Promise.race([fetch(url, opts), timeout]);
  }

  async scan() {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    this.logger.info(`Scanning ${this.accounts.length} accounts...`);
    const signals = [];
    let succeeded = 0;
    let failed = 0;

    for (const account of this.accounts) {
      try {
        const tweets = await this._fetchAccount(account);
        for (const tweet of tweets) {
          const id = `${account}-${tweet.id}`;
          if (!this.seenIds.has(id)) {
            this.seenIds.add(id);
            signals.push(tweet);
          }
        }
        if (tweets.length > 0) succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(`@${account} failed: ${err.message}`);
      }
    }

    if (this.seenIds.size > 1000) {
      const arr = Array.from(this.seenIds);
      this.seenIds = new Set(arr.slice(-500));
    }

    this.cache = { data: signals, ts: now };
    this.logger.info(`Scan complete: ${signals.length} tweets (${succeeded} accounts OK, ${failed} failed)`);
    return signals;
  }

  async _fetchAccount(account) {
    // Try Twitter syndication API first (no API key needed)
    const synResult = await this._trySyndication(account);
    if (synResult && synResult.length > 0) return synResult;

    // Fallback: Nitter RSS
    const rssResult = await this._tryRSS(account);
    if (rssResult && rssResult.length > 0) return rssResult;

    // Fallback: Nitter HTML scraping
    return await this._tryHTMLScrape(account);
  }

  async _trySyndication(account) {
    // Skip if we already know syndication doesn't work, but retry after 5 min
    if (this.syndicationWorking === false) {
      if (this.syndicationDisabledAt && (Date.now() - this.syndicationDisabledAt) > 300_000) {
        this.logger.info('Syndication cooldown expired, retrying...');
        this.syndicationWorking = null;
      } else {
        return null;
      }
    }

    try {
      const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account}`;
      const res = await this._timedFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!res.ok) {
        if (this.syndicationWorking === null) {
          this.logger.info(`Syndication API returned ${res.status}, disabling`);
          this.syndicationWorking = false; this.syndicationDisabledAt = Date.now();
        }
        return null;
      }
      const html = await res.text();

      // Extract __NEXT_DATA__ JSON from the HTML page
      const dataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!dataMatch) {
        if (this.syndicationWorking === null) {
          this.logger.info('Syndication API: no __NEXT_DATA__ found, disabling');
          this.syndicationWorking = false; this.syndicationDisabledAt = Date.now();
        }
        return null;
      }

      const nextData = JSON.parse(dataMatch[1]);
      const entries = nextData?.props?.pageProps?.timeline?.entries || [];
      const tweets = [];

      for (const entry of entries) {
        if (entry.type !== 'tweet' || tweets.length >= 10) continue;
        const t = entry.content?.tweet;
        if (!t?.full_text) continue;

        const text = t.full_text;
        const tokens = this._extractTokens(text);
        if (tokens.length === 0) continue;

        const likes = t.favorite_count || 0;
        const retweets = t.retweet_count || 0;
        const score = this._scoreTweet(text, tokens, account, likes, retweets);

        for (const symbol of tokens) {
          tweets.push({
            id: t.id_str || t.conversation_id_str || `syn-${tweets.length}`,
            account,
            text: text.slice(0, 400),
            url: `https://x.com/${account}/status/${t.id_str || t.conversation_id_str}`,
            published_at: t.created_at || '',
            likes,
            retweets,
            token: { name: symbol, symbol },
            signal_strength: score,
          });
        }
      }

      if (tweets.length > 0) {
        this.syndicationWorking = true;
        this.logger.debug(`Syndication OK for @${account}: ${tweets.length} tweets`);
      }
      return tweets;
    } catch (err) {
      if (this.syndicationWorking === null) {
        this.logger.info(`Syndication API failed: ${err.message}, trying Nitter`);
        this.syndicationWorking = false; this.syndicationDisabledAt = Date.now();
      }
      return null;
    }
  }

  async _tryRSS(account) {
    // Skip Nitter if too many consecutive failures
    if (this.nitterFails >= 3 && !this.workingInstance) return null;

    const instances = this.workingInstance
      ? [this.workingInstance]
      : [NITTER_INSTANCES[0]]; // only try first instance until one works

    for (const instance of instances) {
      try {
        const url = `https://${instance}/${account}/rss`;
        const res = await this._timedFetch(url, {
          headers: {
            'User-Agent': instance === 'xcancel.com' ? 'Mistique' : 'AlphaSwarm/1.0',
          },
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<item') && !xml.includes('<entry')) continue;

        const tweets = this._parseRSS(xml, account);
        if (tweets.length > 0) {
          this.workingInstance = instance;
          this.nitterFails = 0;
          this.logger.debug(`RSS working via ${instance} for @${account}`);
          return tweets;
        }
      } catch (_e) {}
    }
    return null;
  }

  async _tryHTMLScrape(account) {
    // Skip Nitter if too many consecutive failures
    if (this.nitterFails >= 3 && !this.workingInstance) {
      if (this.nitterFails === 3) {
        this.logger.info('Nitter instances all down, disabling Nitter fallback');
        this.nitterFails = 4; // only log once
      }
      return [];
    }

    const instances = this.workingInstance
      ? [this.workingInstance]
      : [NITTER_INSTANCES[0]]; // only try first instance

    for (const instance of instances) {
      try {
        const url = `https://${instance}/${account}`;
        const res = await this._timedFetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!res.ok) {
          this.nitterFails++;
          continue;
        }
        const html = await res.text();
        if (!html.includes('tweet-content')) {
          this.nitterFails++;
          continue;
        }

        const tweets = this._parseHTML(html, account);
        if (tweets.length > 0) {
          this.workingInstance = instance;
          this.nitterFails = 0;
          this.logger.debug(`HTML scrape working via ${instance} for @${account}`);
          return tweets;
        }
      } catch (_e) {
        this.nitterFails++;
      }
    }
    return [];
  }

  _parseRSS(xml, account) {
    const tweets = [];
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && tweets.length < 10) {
      const block = match[1];
      const title = this._extractTag(block, 'title');
      const link = this._extractTag(block, 'link');
      const desc = this._stripHtml(this._extractTag(block, 'description'));
      const pubDate = this._extractTag(block, 'pubDate');

      const text = `${title} ${desc}`.trim();
      const tokens = this._extractTokens(text);
      if (tokens.length === 0) continue;

      const id = link.match(/status\/(\d+)/)?.[1] || link;
      const score = this._scoreTweet(text, tokens, account);

      for (const symbol of tokens) {
        tweets.push({
          id,
          account,
          text: text.slice(0, 400),
          url: link.replace(/nitter\.[^/]+|xcancel\.com/, 'x.com'),
          published_at: pubDate || '',
          token: { name: symbol, symbol },
          signal_strength: score,
        });
      }
    }
    return tweets;
  }

  _parseHTML(html, account) {
    const tweets = [];
    // Match tweet content blocks
    const tweetRegex = /class="timeline-item[\s\S]*?class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match;
    while ((match = tweetRegex.exec(html)) !== null && tweets.length < 10) {
      const rawText = this._stripHtml(match[1]);
      const tokens = this._extractTokens(rawText);
      if (tokens.length === 0) continue;

      // Try to extract tweet link
      const linkBefore = html.slice(Math.max(0, match.index - 500), match.index);
      const linkMatch = linkBefore.match(/href="\/[^/]+\/status\/(\d+)/);
      const id = linkMatch ? linkMatch[1] : `html-${tweets.length}`;

      // Try to extract stats (likes, retweets)
      const statsAfter = html.slice(match.index, match.index + 2000);
      const likes = parseInt(statsAfter.match(/icon-heart[^<]*<\/span>\s*(\d[\d,]*)/)?.[1]?.replace(/,/g, '') || '0');
      const retweets = parseInt(statsAfter.match(/icon-retweet[^<]*<\/span>\s*(\d[\d,]*)/)?.[1]?.replace(/,/g, '') || '0');

      const score = this._scoreTweet(rawText, tokens, account, likes, retweets);

      for (const symbol of tokens) {
        tweets.push({
          id,
          account,
          text: rawText.slice(0, 400),
          url: `https://x.com/${account}/status/${id}`,
          likes,
          retweets,
          token: { name: symbol, symbol },
          signal_strength: score,
        });
      }
    }
    return tweets;
  }

  _extractTokens(text) {
    const tokens = new Set();
    const cashTags = text.match(/\$([A-Z]{2,10})\b/g);
    if (cashTags) {
      for (const tag of cashTags) tokens.add(tag.slice(1));
    }
    const lower = text.toLowerCase();
    for (const [name, symbol] of Object.entries(TOKEN_MAP)) {
      if (lower.includes(name)) tokens.add(symbol);
    }
    return Array.from(tokens);
  }

  _scoreTweet(text, tokens, account, likes = 0, retweets = 0) {
    let score = 3;

    // Engagement boost
    if (likes >= 1000 || retweets >= 500) score += 3;
    else if (likes >= 100 || retweets >= 50) score += 2;
    else if (likes >= 10 || retweets >= 5) score += 1;

    // Whale/alpha accounts get credibility boost
    const alphaAccounts = ['lookonchain', 'whale_alert', 'WatcherGuru'];
    if (alphaAccounts.includes(account)) score += 1;

    // Multiple tokens = more interesting
    if (tokens.length >= 2) score += 1;

    // Urgency/alpha keywords
    const lower = text.toLowerCase();
    const alphaKeywords = ['buy', 'bought', 'accumulating', 'whale', 'transfer', 'breaking', 'just in', 'alert', 'listing', 'pump'];
    const hits = alphaKeywords.filter(kw => lower.includes(kw)).length;
    if (hits >= 2) score += 2;
    else if (hits >= 1) score += 1;

    return Math.min(10, score);
  }

  _extractTag(block, tag) {
    const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
    const cdataMatch = block.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = block.match(regex);
    return m ? m[1].trim() : '';
  }

  _stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }
}
