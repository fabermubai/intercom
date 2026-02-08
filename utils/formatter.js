export class Formatter {
  static formatAlphaCall(verdict, signals) {
    const token = Formatter._extractToken(signals);
    const score = verdict.score || 0;
    const args = verdict.arguments_for || [];
    const risks = verdict.risks || [];
    const agentNames = [...new Set(signals.map(s => s.agent || s.role || 'unknown'))];
    const bullishAgents = [...new Set(
      signals.filter(s => (s.data?.signal_strength || 0) >= 6).map(s => s.agent || s.role || 'unknown')
    )];

    const scoreBar = Formatter._scoreBar(score);
    const scoreLabel = score >= 8 ? 'STRONG' : score >= 7 ? 'MODERATE' : 'WEAK';

    let msg = `ALPHASWARM CALL\n\n`;
    if (token.symbol) msg += `$${token.symbol}`;
    if (token.chain) msg += ` | ${token.chain}`;
    msg += '\n';
    if (token.address && token.address.length > 20) msg += `CA: ${token.address}\n`;
    if (token.price_usd) msg += `Price: $${token.price_usd}\n`;
    if (token.market_cap) msg += `MC: $${Formatter._fmtNum(token.market_cap)}\n`;
    if (token.volume_24h) {
      msg += `Vol 24h: $${Formatter._fmtNum(token.volume_24h)}`;
      if (token.volume_change_pct) msg += ` (+${token.volume_change_pct}%)`;
      msg += '\n';
    }
    if (token.liquidity_usd) msg += `Liq: $${Formatter._fmtNum(token.liquidity_usd)}\n`;
    const dexUrl = Formatter._dexScreenerUrl(token);
    if (dexUrl) msg += `DexScreener: ${dexUrl}\n`;
    msg += '\n';

    msg += `Score: ${scoreBar} ${score}/10 (${scoreLabel})\n`;
    msg += `Agents: ${bullishAgents.length}/${agentNames.length} bullish | ${signals.length} signals\n\n`;

    if (verdict.summary) msg += `${verdict.summary}\n\n`;

    if (args.length > 0) {
      msg += 'FOR:\n';
      for (const a of args) msg += `+ ${a}\n`;
      msg += '\n';
    }

    if (risks.length > 0) {
      msg += 'RISKS:\n';
      for (const r of risks) msg += `- ${r}\n`;
      msg += '\n';
    }

    msg += `${new Date().toISOString().slice(0, 19)} UTC`;
    return msg;
  }

  static formatDebateMessage(msg) {
    const agent = msg.agent || 'Unknown';
    const type = msg.type || 'message';
    const data = msg.data || msg.message || '';
    if (type === 'debate_start') {
      return `[DEBATE] ${data.message || `Evaluating: ${data.token}`}`;
    }
    if (type === 'debate_round') {
      return `[DEBATE R${data.round}] ${data.agent}: ${data.message}`;
    }
    if (type === 'verdict') {
      return `[VERDICT] ${data.token}: Score ${data.score}/10 - ${data.decision}`;
    }
    return `[${agent}] ${typeof data === 'string' ? data : JSON.stringify(data)}`;
  }

  static formatTelegramCall(verdict, signals) {
    const token = Formatter._extractToken(signals);
    const score = verdict.score || 0;
    const args = verdict.arguments_for || [];
    const risks = verdict.risks || [];
    const agentNames = [...new Set(signals.map(s => s.agent || s.role || 'unknown'))];
    const bullishAgents = [...new Set(
      signals.filter(s => (s.data?.signal_strength || 0) >= 6).map(s => s.agent || s.role || 'unknown')
    )];

    const scoreBar = Formatter._scoreBar(score);
    const scoreEmoji = score >= 9 ? '\u{1F525}' : score >= 8 ? '\u{1F7E2}' : score >= 7 ? '\u{1F7E1}' : '\u{1F7E0}';
    const chainEmoji = Formatter._chainEmoji(token.chain);

    let msg = `\u{1F4E1} *ALPHASWARM CALL* ${scoreEmoji}\n`;
    msg += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n`;

    if (token.symbol) msg += `\u{1F4B0} *$${token.symbol}*`;
    if (token.chain) msg += ` ${chainEmoji} _${token.chain}_`;
    msg += '\n\n';

    if (token.address && token.address.length > 20) msg += `\u{1F4CB} CA: \`${token.address}\`\n`;
    if (token.price_usd) msg += `\u{1F4B5} Price: \`$${token.price_usd}\`\n`;
    if (token.market_cap) msg += `\u{1F4C8} MC: \`$${Formatter._fmtNum(token.market_cap)}\`\n`;
    if (token.volume_24h) msg += `\u{1F4CA} Vol 24h: \`$${Formatter._fmtNum(token.volume_24h)}\`\n`;
    if (token.liquidity_usd) msg += `\u{1F3CA} Liq: \`$${Formatter._fmtNum(token.liquidity_usd)}\`\n`;
    msg += '\n';

    msg += `\u{1F3AF} *Score:* ${scoreBar} *${score}/10*\n`;
    msg += `\u{1F916} *Agents:* ${bullishAgents.length}/${agentNames.length} bullish | ${signals.length} signals\n\n`;

    if (verdict.summary) msg += `\u{1F4AC} _${verdict.summary}_\n\n`;

    if (args.length > 0) {
      msg += '\u2705 *Arguments FOR:*\n';
      for (const a of args) msg += `  \u2022 ${a}\n`;
    }
    if (risks.length > 0) {
      msg += '\n\u26A0\uFE0F *Risks:*\n';
      for (const r of risks) msg += `  \u2022 ${r}\n`;
    }

    // DexScreener link
    const dexUrl = Formatter._dexScreenerUrl(token);
    if (dexUrl) msg += `\n\u{1F50D} [View on DexScreener](${dexUrl})\n`;

    msg += `\n\u23F0 _${new Date().toISOString().slice(0, 19)} UTC_`;
    msg += `\n\u{1F517} _Powered by AlphaSwarm AI_`;
    return msg;
  }

  static formatTelegramWatchlist(verdict, signals) {
    const token = Formatter._extractToken(signals);
    const score = verdict.score || 0;
    const risks = verdict.risks || [];
    const chainEmoji = Formatter._chainEmoji(token.chain);

    const scoreBar = Formatter._scoreBar(score);
    const scoreEmoji = score >= 5 ? '\u{1F7E1}' : score >= 3 ? '\u{1F7E0}' : '\u{1F534}';

    let msg = `\u{1F4E1} *ALPHASWARM RADAR* ${scoreEmoji}\n`;
    msg += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n`;

    if (token.symbol) msg += `\u{1F4B0} *$${token.symbol}*`;
    if (token.chain) msg += ` ${chainEmoji} _${token.chain}_`;
    msg += '\n\n';

    if (token.address && token.address.length > 20) msg += `\u{1F4CB} CA: \`${token.address}\`\n`;
    if (token.price_usd) msg += `\u{1F4B5} Price: \`$${token.price_usd}\`\n`;
    if (token.market_cap) msg += `\u{1F4C8} MC: \`$${Formatter._fmtNum(token.market_cap)}\`\n`;
    if (token.volume_24h) msg += `\u{1F4CA} Vol 24h: \`$${Formatter._fmtNum(token.volume_24h)}\`\n`;
    if (token.liquidity_usd) msg += `\u{1F3CA} Liq: \`$${Formatter._fmtNum(token.liquidity_usd)}\`\n`;
    msg += '\n';

    msg += `\u{1F3AF} *Score:* ${scoreBar} *${score}/10*\n\n`;

    if (verdict.summary) msg += `\u{1F4AC} _${verdict.summary}_\n\n`;

    if (risks.length > 0) {
      msg += '\u26A0\uFE0F *Risks:*\n';
      for (const r of risks) msg += `  \u2022 ${r}\n`;
      msg += '\n';
    }

    msg += `\u{1F6A8} *DISCLAIMER:* This token scored *${score}/10* — below our call threshold. `;
    msg += `It may be interesting to watch for a deep/dip entry if you believe in the project. `;
    msg += `*DYOR — this is NOT a call.*\n`;

    const dexUrl = Formatter._dexScreenerUrl(token);
    if (dexUrl) msg += `\n\u{1F50D} [View on DexScreener](${dexUrl})\n`;

    msg += `\n\u23F0 _${new Date().toISOString().slice(0, 19)} UTC_`;
    msg += `\n\u{1F517} _Powered by AlphaSwarm AI_`;
    return msg;
  }

  static formatSignal(signal) {
    const d = signal.data || signal;
    const agent = signal.agent || d.agent || 'Unknown';
    const type = d.type || 'unknown';
    const token = d.token?.symbol || d.title || 'N/A';
    const strength = d.signal_strength || '?';
    return `[${agent}] ${type}: ${token} (strength: ${strength}/10)`;
  }

  static _extractToken(signals) {
    let best = null;
    let bestScore = -1;
    for (const s of signals) {
      const t = s.data?.token || s.token;
      if (!t || (!t.symbol && !t.name)) continue;
      // Prefer tokens with real on-chain data (address, chain, liquidity)
      let sc = 0;
      if (t.address && t.address.length > 10) sc += 4;
      if (t.chain && t.chain !== 'multi') sc += 3;
      if (t.pair_url) sc += 2;
      if (t.price_usd) sc += 1;
      if (t.volume_24h) sc += 1;
      if (t.liquidity_usd) sc += 1;
      if (t.market_cap) sc += 1;
      if (sc > bestScore) { best = t; bestScore = sc; }
    }
    return best || {};
  }

  static _scoreBar(score) {
    const filled = Math.round(Math.max(0, Math.min(10, score)));
    return '\u{1F7E9}'.repeat(filled) + '\u2B1C'.repeat(10 - filled);
  }

  static _chainEmoji(chain) {
    if (!chain) return '';
    const c = chain.toLowerCase();
    if (c === 'solana' || c === 'sol') return '\u{1F7E3}';
    if (c === 'ethereum' || c === 'eth') return '\u{1F535}';
    if (c === 'base') return '\u{1F535}';
    if (c === 'bsc' || c === 'bnb') return '\u{1F7E1}';
    if (c === 'arbitrum' || c === 'arb') return '\u{1F535}';
    if (c === 'polygon' || c === 'matic') return '\u{1F7E3}';
    if (c === 'avalanche' || c === 'avax') return '\u{1F534}';
    return '\u26AA';
  }

  static _dexScreenerUrl(token) {
    if (token.pair_url) return token.pair_url;
    if (token.address && token.chain && token.chain !== 'multi') {
      return `https://dexscreener.com/${token.chain}/${token.address}`;
    }
    // Fallback: search link by symbol
    if (token.symbol) {
      return `https://dexscreener.com/search?q=${token.symbol}`;
    }
    return '';
  }

  static _fmtNum(n) {
    if (!n) return '0';
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }
}
