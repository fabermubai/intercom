import { BaseAgent } from './base-agent.js';
import { RedditClient } from '../sources/reddit.js';

export class RedditAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Reddit Scout', 'reddit', peer, config);
    this.reddit = new RedditClient(config.sources?.reddit || {});
  }

  async scan() {
    const signals = [];

    try {
      const results = await this.reddit.scan();
      for (const post of results) {
        if (post.signal_strength >= 4) {
          signals.push({
            source: 'reddit',
            type: 'community_post',
            token: post.token,
            reddit: {
              title: post.title,
              subreddit: post.subreddit,
              url: post.url,
              upvotes: post.upvotes,
              upvote_ratio: post.upvote_ratio,
              num_comments: post.num_comments,
              author: post.author,
            },
            signal_strength: post.signal_strength,
            reasoning: `r/${post.subreddit}: "${post.title.slice(0, 80)}" (${post.upvotes} upvotes, ${post.num_comments} comments)`,
            risks: this._assessRisks(post),
          });
        }
      }
    } catch (err) {
      this.logger.error(`Reddit scan failed: ${err.message}`);
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'crypto Reddit community analyst focused on emerging gems, crowd sentiment, and early-stage hype from subreddits like CryptoMoonShots and SatoshiStreetBets',
    };
  }

  _assessRisks(post) {
    const risks = [];
    if (post.subreddit === 'CryptoMoonShots') risks.push('CryptoMoonShots has high scam rate');
    if (post.upvotes < 20) risks.push('Low community engagement');
    if (post.upvote_ratio < 0.6) risks.push('Controversial post (low upvote ratio)');
    if (post.num_comments < 5) risks.push('Low discussion activity');
    const lower = (post.title + ' ' + post.text).toLowerCase();
    if (lower.includes('1000x') || lower.includes('guaranteed')) risks.push('Extreme hype language');
    return risks;
  }
}
