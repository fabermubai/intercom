import { Logger } from '../utils/logger.js';
import { Formatter } from '../utils/formatter.js';

export class TelegramRelay {
  constructor(config = {}) {
    this.logger = new Logger('TelegramRelay');
    this.botToken = config.telegram?.bot_token || '';
    this.channelId = config.telegram?.channel_id || '';
    this.enabled = !!(config.telegram?.enabled && this.botToken && this.channelId);
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
    this.referralWallet = config.referral?.sol_wallet || '';
    this.judgeAgent = null;
    this.pollOffset = 0;
    this.polling = false;
  }

  start() {
    if (!this.enabled) {
      this.logger.info('Telegram relay disabled (no token or channel configured)');
      return;
    }
    this.logger.info(`Telegram relay started for channel ${this.channelId}`);
  }

  attachToJudge(judgeAgent) {
    this.judgeAgent = judgeAgent;
    judgeAgent.onCall(({ verdict, signals }) => {
      this.sendCall(verdict, signals);
    });
    judgeAgent.onWatchlist(({ verdict, signals }) => {
      this.sendWatchlist(verdict, signals);
    });
  }

  startPolling() {
    if (!this.enabled || !this.botToken) return;
    this.polling = true;
    this.logger.info('Telegram command polling started (/analyze)');
    this._poll();
  }

  async _poll() {
    while (this.polling) {
      try {
        const res = await fetch(`${this.apiBase}/getUpdates?offset=${this.pollOffset}&timeout=30&allowed_updates=["message","channel_post"]`);
        if (!res.ok) {
          this.logger.error(`Polling error: HTTP ${res.status}`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.pollOffset = update.update_id + 1;
            await this._handleUpdate(update);
          }
        }
      } catch (err) {
        this.logger.error(`Polling error: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  async _handleUpdate(update) {
    const msg = update.message || update.channel_post;
    if (!msg?.text) return;

    const text = msg.text.trim();
    const chatId = msg.chat.id;

    // /analyze or /analyse TOKEN
    if (text.startsWith('/analyze') || text.startsWith('/analyse')) {
      const parts = text.split(/\s+/);
      const query = parts[1];
      if (!query) {
        await this._sendTo(chatId, 'Usage: `/analyze TOKEN` or `/analyze ADDRESS`\nExamples:\n`/analyze PLANETS`\n`/analyze 0x1234...` (EVM)\n`/analyze DvV5CK...` (Solana)');
        return;
      }
      await this._handleAnalyze(chatId, query);
      return;
    }

    // /status
    if (text === '/status' || text === '/start') {
      await this._sendTo(chatId, 'AlphaSwarm is running.\nUse `/analyze TOKEN` or paste a contract address to analyze.');
      return;
    }

    // Auto-detect contract address pasted without command
    // EVM: 0x + 40 hex chars | Solana: 32-44 base58 chars (no spaces)
    const trimmed = text.split(/\s+/)[0]; // take first word only
    if (/^0x[a-fA-F0-9]{40,}$/.test(trimmed) || (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) && !trimmed.startsWith('/'))) {
      await this._handleAnalyze(chatId, trimmed);
      return;
    }
  }

  async _handleAnalyze(chatId, query) {
    if (!this.judgeAgent) {
      await this._sendTo(chatId, 'Judge agent not available.');
      return;
    }

    await this._sendTo(chatId, `Analyzing *${query.toUpperCase()}*... please wait.`);

    const result = await this.judgeAgent.analyzeToken(query);

    if (result.error) {
      await this._sendTo(chatId, `Analysis failed: ${result.error}`);
      return;
    }

    const { verdict, token, signals } = result;
    const score = verdict.score;
    // Risk indicator: green (8+), yellow (6-7), orange (4-5), red (1-3)
    const indicator = score >= 8 ? '\u{1F7E2}' : score >= 6 ? '\u{1F7E1}' : score >= 4 ? '\u{1F7E0}' : '\u{1F534}';
    const riskLabel = score >= 8 ? 'LOW RISK' : score >= 6 ? 'MODERATE' : score >= 4 ? 'HIGH RISK' : 'EXTREME RISK';
    const lines = [
      `${indicator} *Manual Analysis: ${token.symbol}* ${indicator}`,
      `\`${token.address}\``,
      `Chain: ${token.chain} | Price: $${token.price_usd}`,
      `Volume 24h: $${Math.round(token.volume_24h).toLocaleString()}`,
      `Liquidity: $${Math.round(token.liquidity_usd).toLocaleString()}`,
      `Market Cap: $${Math.round(token.market_cap).toLocaleString()}`,
      `Age: ${token.age_hours}h`,
      '',
      `${indicator} *Score: ${score}/10* — ${verdict.verdict.toUpperCase()} | ${riskLabel}`,
      `${verdict.summary}`,
    ];
    // Agent debate quotes
    if (verdict.debateLog?.length) {
      lines.push('', '\u{1F4AC} *Agent Debate:*');
      for (const entry of verdict.debateLog) {
        // Format: [AgentName] (Round N): text → extract and show with emoji
        const match = entry.match(/^\[(.+?)\] \(Round (\d+)\): (.+)/s);
        if (match) {
          const [, agent, , text] = match;
          // Truncate long responses
          const short = text.length > 200 ? text.slice(0, 200) + '...' : text;
          lines.push(`\u{1F5E3} *${agent}:* _${short}_`);
        }
      }
    }

    if (verdict.arguments_for?.length) {
      lines.push('', '\u{2705} *For:*');
      for (const a of verdict.arguments_for) lines.push(`  + ${a}`);
    }
    if (verdict.risks?.length) {
      lines.push('', '\u{26A0}\u{FE0F} *Risks:*');
      for (const r of verdict.risks) lines.push(`  - ${r}`);
    }
    if (token.pair_url) {
      lines.push('', `[DexScreener](${token.pair_url})`);
    }

    await this._sendTo(chatId, lines.join('\n'));
    this.logger.info(`Manual analysis sent: ${token.symbol} → ${verdict.score}/10`);
  }

  async sendCall(verdict, signals) {
    if (!this.enabled) return;
    try {
      const message = Formatter.formatTelegramCall(verdict, signals, { referralWallet: this.referralWallet });
      await this._sendMessage(message);
      this.logger.info('Call sent to Telegram');
    } catch (err) {
      this.logger.error(`Telegram send failed: ${err.message}`);
    }
  }

  async sendWatchlist(verdict, signals) {
    if (!this.enabled) return;
    try {
      const message = Formatter.formatTelegramWatchlist(verdict, signals, { referralWallet: this.referralWallet });
      await this._sendMessage(message);
      this.logger.info('Watchlist sent to Telegram');
    } catch (err) {
      this.logger.error(`Telegram watchlist send failed: ${err.message}`);
    }
  }

  async _sendTo(chatId, text, parseMode = 'Markdown') {
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Send to ${chatId} failed: ${err.slice(0, 200)}`);
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
