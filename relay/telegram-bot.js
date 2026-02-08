import { Logger } from '../utils/logger.js';
import { Formatter } from '../utils/formatter.js';

export class TelegramRelay {
  constructor(config = {}) {
    this.logger = new Logger('TelegramRelay');
    this.botToken = config.telegram?.bot_token || '';
    this.channelId = config.telegram?.channel_id || '';
    this.enabled = !!(config.telegram?.enabled && this.botToken && this.channelId);
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
  }

  start() {
    if (!this.enabled) {
      this.logger.info('Telegram relay disabled (no token or channel configured)');
      return;
    }
    this.logger.info(`Telegram relay started for channel ${this.channelId}`);
  }

  attachToJudge(judgeAgent) {
    judgeAgent.onCall(({ verdict, signals }) => {
      this.sendCall(verdict, signals);
    });
  }

  async sendCall(verdict, signals) {
    if (!this.enabled) return;
    try {
      const message = Formatter.formatTelegramCall(verdict, signals);
      await this._sendMessage(message);
      this.logger.info('Call sent to Telegram');
    } catch (err) {
      this.logger.error(`Telegram send failed: ${err.message}`);
    }
  }

  async _sendMessage(text, parseMode = 'Markdown') {
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.channelId,
        text,
        parse_mode: parseMode,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram API ${res.status}: ${err.slice(0, 200)}`);
    }
    return res.json();
  }
}
