import { BaseAgent } from './base-agent.js';
import { TwitterScannerClient } from '../sources/twitter-scanner.js';

export class TwitterScanAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('X Scout', 'xscout', peer, config);
    this.scanner = new TwitterScannerClient(config.sources?.twitter_scanner || {});
  }

  async scan() {
    const signals = [];

    try {
      const results = await this.scanner.scan();
      for (const tweet of results) {
        if (tweet.signal_strength >= 4) {
          signals.push({
            source: 'twitter',
            type: 'x_post',
            token: tweet.token,
            twitter: {
              account: tweet.account,
              text: tweet.text,
              url: tweet.url,
              likes: tweet.likes || 0,
              retweets: tweet.retweets || 0,
            },
            signal_strength: tweet.signal_strength,
            reasoning: `@${tweet.account}: "${tweet.text.slice(0, 80)}" (${tweet.likes || '?'} likes, ${tweet.retweets || '?'} RTs)`,
            risks: this._assessRisks(tweet),
          });
        }
      }
    } catch (err) {
      this.logger.error(`X scan failed: ${err.message}`);
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'crypto Twitter/X analyst focused on whale movements, influencer calls, and breaking news from key accounts',
    };
  }

  _assessRisks(tweet) {
    const risks = [];
    const lower = (tweet.text || '').toLowerCase();
    if (lower.includes('1000x') || lower.includes('guaranteed') || lower.includes('easy money')) {
      risks.push('Extreme hype language');
    }
    if (lower.includes('nfa') || lower.includes('dyor') || lower.includes('not financial advice')) {
      risks.push('Disclaimer present (NFA/DYOR)');
    }
    if ((tweet.likes || 0) < 10 && (tweet.retweets || 0) < 5) {
      risks.push('Low engagement tweet');
    }
    const alphaAccounts = ['lookonchain', 'whale_alert', 'WatcherGuru'];
    if (!alphaAccounts.includes(tweet.account)) {
      risks.push('Non-verified alpha source');
    }
    return risks;
  }
}
