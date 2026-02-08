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
    if (token.price_usd) msg += `Price: $${token.price_usd}\n`;
    if (token.volume_24h) {
      msg += `Vol 24h: $${Formatter._fmtNum(token.volume_24h)}`;
      if (token.volume_change_pct) msg += ` (+${token.volume_change_pct}%)`;
      msg += '\n';
    }
    if (token.liquidity_usd) msg += `Liq: $${Formatter._fmtNum(token.liquidity_usd)}\n`;
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

    if (token.price_usd) msg += `\u{1F4B5} Price: \`$${token.price_usd}\`\n`;
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
    for (const s of signals) {
      const t = s.data?.token || s.token;
      if (t && (t.symbol || t.name)) return t;
    }
    return {};
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

  static _fmtNum(n) {
    if (!n) return '0';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }
}
