import crypto from 'crypto';
import { Logger } from '../utils/logger.js';

export class TwitterRelay {
  constructor(config = {}) {
    this.logger = new Logger('TwitterRelay');
    this.appKey = config.twitter?.app_key || '';
    this.appSecret = config.twitter?.app_secret || '';
    this.accessToken = config.twitter?.access_token || '';
    this.accessSecret = config.twitter?.access_secret || '';
    this.enabled = !!(config.twitter?.enabled && this.appKey && this.appSecret && this.accessToken && this.accessSecret);
    this.apiUrl = 'https://api.x.com/2/tweets';
  }

  start() {
    if (!this.enabled) {
      this.logger.info('Twitter relay disabled (missing credentials)');
      return;
    }
    this.logger.info('Twitter relay started');
  }

  attachToJudge(judgeAgent) {
    judgeAgent.onCall(({ verdict, signals }) => {
      this.postCall(verdict, signals);
    });
  }

  async postCall(verdict, signals) {
    if (!this.enabled) return;
    try {
      const tweet = TwitterRelay.formatTweet(verdict, signals);
      await this._post(tweet);
      this.logger.info('Call posted to X');
    } catch (err) {
      this.logger.error(`X post failed: ${err.message}`);
    }
  }

  static formatTweet(verdict, signals) {
    const token = TwitterRelay._extractToken(signals);
    const score = verdict.score || 0;
    const symbol = token.symbol || '???';
    const chain = token.chain || '';
    const price = token.price_usd ? `$${token.price_usd}` : '';
    const volume = TwitterRelay._fmtNum(token.volume_24h);
    const volChange = token.volume_change_pct ? `+${token.volume_change_pct}%` : '';
    const consensus = signals.length;
    const bullish = signals.filter(s => (s.data?.signal_strength || 0) >= 6).length;
    const catalyst = (verdict.summary || '').slice(0, 60);
    const chainTag = chain && chain !== 'multi' ? ` #${chain}` : '';

    // Build tweet, max 280 chars
    let tweet = `ALPHASWARM -- Score: ${score}/10\n`;
    tweet += `$${symbol}`;
    if (chain && chain !== 'multi') tweet += ` (${chain})`;
    tweet += '\n';
    if (price) tweet += `${price}`;
    if (volume) tweet += ` | Vol: $${volume}`;
    if (volChange) tweet += ` (${volChange})`;
    tweet += '\n';
    if (catalyst) tweet += `${catalyst}\n`;
    tweet += `Consensus: ${bullish}/${consensus} agents bullish\n`;
    tweet += `#crypto #alpha${chainTag}`;

    // Trim to 280
    if (tweet.length > 280) {
      tweet = tweet.slice(0, 277) + '...';
    }
    return tweet;
  }

  async _post(text) {
    const method = 'POST';
    const params = this._oauthParams();
    const body = JSON.stringify({ text });

    // OAuth 1.0a signature
    const signatureBase = this._buildSignatureBase(method, this.apiUrl, params);
    const signingKey = `${this._encode(this.appSecret)}&${this._encode(this.accessSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
    params.oauth_signature = signature;

    const authHeader = 'OAuth ' + Object.keys(params).sort().map(
      k => `${this._encode(k)}="${this._encode(params[k])}"`
    ).join(', ');

    const res = await fetch(this.apiUrl, {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X API ${res.status}: ${err.slice(0, 200)}`);
    }
    return res.json();
  }

  _oauthParams() {
    return {
      oauth_consumer_key: this.appKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.accessToken,
      oauth_version: '1.0',
    };
  }

  _buildSignatureBase(method, url, params) {
    const sorted = Object.keys(params).sort().map(
      k => `${this._encode(k)}=${this._encode(params[k])}`
    ).join('&');
    return `${method}&${this._encode(url)}&${this._encode(sorted)}`;
  }

  _encode(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  static _extractToken(signals) {
    for (const s of signals) {
      const t = s.data?.token || s.token;
      if (t && (t.symbol || t.name)) return t;
    }
    return {};
  }

  static _fmtNum(n) {
    if (!n) return '';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }
}
