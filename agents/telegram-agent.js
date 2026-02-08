import { BaseAgent } from './base-agent.js';
import { TelegramChannelsClient } from '../sources/telegram-channels.js';

export class TelegramAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Telegram Scout', 'telegram', peer, config);
    this.telegramChannels = new TelegramChannelsClient(config.sources?.telegram_channels || {});
  }

  async scan() {
    const signals = [];

    try {
      const results = await this.telegramChannels.scan();
      for (const msg of results) {
        if (msg.signal_strength >= 4) {
          signals.push({
            source: 'telegram',
            type: 'crypto_call',
            token: msg.token,
            message: {
              text: msg.text,
              link: msg.link,
              channel: msg.channel,
              posted_at: msg.posted_at,
            },
            signal_strength: msg.signal_strength,
            reasoning: `Telegram @${msg.channel}: "${msg.text.slice(0, 100)}${msg.text.length > 100 ? '...' : ''}"`,
            risks: this._assessRisks(msg),
          });
        }
      }
    } catch (err) {
      this.logger.error(`Telegram scan failed: ${err.message}`);
    }

    return signals;
  }

  async debate(context) {
    return {
      agent: this.name,
      role: this.role,
      persona: 'crypto community analyst focused on alpha calls, hype signals, and emerging trends from Telegram channels',
    };
  }

  _assessRisks(msg) {
    const risks = [];
    risks.push('Unverified Telegram channel source');
    if (msg.signal_strength < 5) risks.push('Low confidence signal');
    const lower = msg.text.toLowerCase();
    if (lower.includes('100x') || lower.includes('1000x')) risks.push('Extreme hype language detected');
    if (lower.includes('dyor') || lower.includes('nfa')) risks.push('Channel disclaims responsibility (DYOR/NFA)');
    if (!lower.includes('0x') && !/[1-9A-HJ-NP-Za-km-z]{32,}/.test(msg.text)) risks.push('No contract address provided');
    return risks;
  }
}
