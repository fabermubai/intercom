import { BaseAgent } from './base-agent.js';
import { Formatter } from '../utils/formatter.js';
import { Scoring } from '../utils/scoring.js';
import { FearGreedClient } from '../sources/fear-greed.js';

// Large/mid caps — require exceptional catalysts, not routine signals
const LARGE_CAPS = new Set([
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT',
  'LINK', 'MATIC', 'UNI', 'LTC', 'ATOM', 'XLM', 'NEAR', 'TON', 'HBAR',
  'ARB', 'OP', 'AAVE', 'SUI', 'APT', 'FIL', 'ICP', 'PEPE', 'SHIB', 'WIF',
]);

const PERSONAS = {
  onchain: `You are OnChain Scout, an on-chain analyst. You evaluate tokens based ONLY on on-chain data: volume, liquidity, token age, holder distribution, trading patterns. You look for red flags (rug pulls, honeypots, wash trading) but recognize that young tokens with strong volume and liquidity can be early alpha opportunities — age alone is not a disqualifier. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  news: `You are News Hawk, a crypto news analyst. You evaluate tokens based on news catalysts: listings, partnerships, technical upgrades, regulatory changes. You assess news credibility and potential price impact. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  sentiment: `You are Sentiment Analyst, a market sentiment specialist. You evaluate tokens based on community sentiment, social trends, and market psychology. You look for divergences between sentiment and price. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  telegram: `You are Telegram Scout, a crypto community analyst. You evaluate tokens based on community calls, hype signals, and emerging trends from Telegram channels. You are wary of pump-and-dump schemes and look for genuine community conviction vs manufactured hype. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  reddit: `You are Reddit Scout, a crypto community analyst focused on Reddit. You evaluate tokens based on subreddit discussions, upvote patterns, comment sentiment, and crowd conviction from communities like r/CryptoMoonShots, r/cryptocurrency, and r/SatoshiStreetBets. You watch for astroturfing, coordinated pumps, and distinguish genuine grassroots interest from manufactured hype. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  xscout: `You are X Scout, a crypto Twitter analyst. You evaluate tokens based on tweets from whale trackers, influencers, and alpha accounts. You assess the credibility of the source, the engagement metrics (likes, retweets), and whether the signal represents genuine alpha or paid promotion. You watch for coordinated shilling and distinguish real whale movements from noise. Give your verdict in 2-3 sentences max with a conviction score (1-10).`,

  judge: `You are the Judge of AlphaSwarm, an AI-powered crypto alpha scanner focused on finding HIGH-MULTIPLIER opportunities. You synthesize arguments from all agents to produce a final verdict. Your priority is finding LOWCAP gems with 5-100x potential — young tokens with strong volume, liquidity, and multi-source buzz. For large caps (BTC, ETH, SOL, etc.), only score 8+ if there is an EXCEPTIONAL catalyst (major crash recovery, critical news, extreme fear/greed divergence). For lowcaps, be more generous — early discovery is the goal. You MUST respond with ONLY a JSON object (no markdown, no extra text) in this format: { "score": <number 1-10>, "verdict": "call" or "skip", "arguments_for": [<string>, ...], "risks": [<string>, ...], "summary": "<one sentence summary>" }`,
};

export class JudgeAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Judge', 'judge', peer, config);
    this.signalBuffer = [];
    this.agents = [];
    this.publishThreshold = config.alphaswarm?.publish_threshold || 7;
    this.maxCallsPerHour = config.alphaswarm?.max_calls_per_hour || 10;
    this.debateRounds = config.agents?.debate_rounds || 2;
    this.callHistory = [];
    this.callListeners = [];
    this.llmApiKey = config.agents?.llm_api_key || '';
    this.llmModel = config.agents?.llm_model || 'claude-sonnet-4-20250514';
    this.llmTemperature = config.agents?.agent_temperature || 0.7;
    this.fearGreed = new FearGreedClient(config.sources?.fear_greed || {});
    this.fearGreedCache = null;
    this.rateLimitedUntil = 0;
    this.maxEvalsPerCycle = 5;
    this.llmDelayMs = 2500; // ms between LLM calls to avoid 429
    this.publishedTokens = new Map(); // token -> last published timestamp
    this.largecapCooldownMs = 2 * 3_600_000; // 2h cooldown for large caps
    this.defaultCooldownMs = 30 * 60_000; // 30 min cooldown for others
  }

  async scan() {
    return [];
  }

  registerAgents(agents) {
    this.agents = agents;
    for (const agent of agents) {
      agent.onSignal((signal) => {
        this.signalBuffer.push(signal);
        this.logger.info(`Signal from ${signal.agent}: ${signal.data?.type || 'unknown'} - ${signal.data?.token?.symbol || '?'}`);
      });
    }
  }

  onCall(fn) {
    this.callListeners.push(fn);
  }

  async start() {
    this.running = true;
    this.logger.info('Judge started, listening for signals...');
    const interval = (this.config.alphaswarm?.scan_interval_seconds || 60) * 1000;

    while (this.running) {
      try {
        await this.processSignals();
      } catch (err) {
        this.logger.error(`Processing error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  async processSignals() {
    if (this.signalBuffer.length === 0) return;

    // Refresh macro sentiment
    try {
      this.fearGreedCache = await this.fearGreed.scan();
    } catch (_e) {}

    this.logger.info(`Processing ${this.signalBuffer.length} buffered signals`);
    const grouped = this._groupByToken(this.signalBuffer);
    this.signalBuffer = [];

    // Build candidate list with priority scoring
    const now = Date.now();
    const candidates = [];
    let skippedCooldown = 0;

    for (const [tokenKey, signals] of Object.entries(grouped)) {
      const maxStrength = Math.max(...signals.map(s => s.data?.signal_strength || 0));
      const uniqueAgents = new Set(signals.map(s => s.role)).size;
      const hasMultipleAgents = uniqueAgents >= 2;
      const isLargeCap = LARGE_CAPS.has(tokenKey);

      // Minimum strength to even consider
      const minStrength = hasMultipleAgents ? 4 : (this.llmApiKey ? 6 : 7);
      if (maxStrength < minStrength) {
        this.logger.debug(`Skipping ${tokenKey}: strength ${maxStrength} < ${minStrength}`);
        continue;
      }

      // Cooldown: don't re-evaluate recently published tokens
      const lastPublished = this.publishedTokens.get(tokenKey) || 0;
      const cooldown = isLargeCap ? this.largecapCooldownMs : this.defaultCooldownMs;
      if (lastPublished && (now - lastPublished) < cooldown) {
        skippedCooldown++;
        continue;
      }

      // Priority: lowcaps get big boost, large caps get penalized
      let priority = maxStrength + uniqueAgents;
      if (isLargeCap) {
        priority -= 5; // large caps deprioritized
      } else {
        priority += 3; // lowcap bonus
      }

      candidates.push({ tokenKey, signals, maxStrength, uniqueAgents, isLargeCap, priority });
    }

    if (skippedCooldown > 0) {
      this.logger.debug(`${skippedCooldown} tokens skipped (cooldown)`);
    }

    // Sort by priority descending — lowcaps first
    candidates.sort((a, b) => b.priority - a.priority);

    let evalsThisCycle = 0;
    let deferred = 0;
    for (const { tokenKey, signals, maxStrength, isLargeCap } of candidates) {
      if (evalsThisCycle >= this.maxEvalsPerCycle) {
        this.signalBuffer.push(...signals);
        deferred++;
        continue;
      }

      if (!this._withinRateLimit()) {
        this.logger.warn('Rate limit reached, deferring evaluation');
        this.signalBuffer.push(...signals);
        break;
      }

      // Skip if LLM is rate-limited (429 backoff)
      if (this.rateLimitedUntil > Date.now()) {
        this.logger.info(`LLM rate-limited, deferring ${tokenKey} (${Math.round((this.rateLimitedUntil - Date.now()) / 1000)}s remaining)`);
        this.signalBuffer.push(...signals);
        continue;
      }

      const tag = isLargeCap ? 'LARGECAP' : 'LOWCAP';
      this.logger.info(`Evaluating ${tokenKey} [${tag}] (${signals.length} signals, max strength ${maxStrength}) [${evalsThisCycle + 1}/${this.maxEvalsPerCycle}]`);

      const verdict = await this.runDebate(tokenKey, signals);
      evalsThisCycle++;

      // Dynamic threshold: large caps need 9+, others need 7
      const threshold = isLargeCap ? 9 : this.publishThreshold;
      if (verdict && verdict.score >= threshold) {
        this._publish(verdict, signals);
      } else {
        this.logger.info(`${tokenKey}: score ${verdict?.score || 0}/10 - below threshold (${threshold}${isLargeCap ? ' largecap' : ''})`);
      }
    }
    if (deferred > 0) {
      this.logger.info(`Cycle eval limit (${this.maxEvalsPerCycle}) reached, ${deferred} tokens deferred to next cycle`);
    }
  }

  async runDebate(tokenKey, signals) {
    const context = this._buildContext(tokenKey, signals);

    // Announce debate
    this.submitDebateMessage({
      type: 'debate_start',
      token: tokenKey,
      signal_count: signals.length,
      message: `Evaluating ${tokenKey}: ${signals.length} signals detected`,
    });

    const debateLog = [];

    for (let round = 0; round < this.debateRounds; round++) {
      const roles = [...new Set(signals.map(s => s.role))];

      for (const role of roles) {
        const persona = PERSONAS[role] || PERSONAS.onchain;
        const prompt = round === 0
          ? context
          : `${context}\n\nPrevious debate:\n${debateLog.join('\n')}`;

        const response = await this._callLLM(persona, prompt);
        const agentName = signals.find(s => s.role === role)?.agent || role;

        debateLog.push(`[${agentName}] (Round ${round + 1}): ${response}`);

        this.submitDebateMessage({
          type: 'debate_round',
          round: round + 1,
          agent: agentName,
          message: response,
        });
      }
    }

    // Final synthesis
    const synthesisPrompt = `${context}\n\nFull debate:\n${debateLog.join('\n')}\n\nProduce your final JSON verdict now.`;
    const verdictRaw = await this._callLLM(PERSONAS.judge, synthesisPrompt);
    const verdict = this._parseVerdict(verdictRaw, tokenKey, signals);

    this.submitDebateMessage({
      type: 'verdict',
      token: tokenKey,
      score: verdict.score,
      decision: verdict.verdict,
      summary: verdict.summary,
    });

    return verdict;
  }

  // Strip lone surrogates and control chars that break JSON.stringify
  _sanitize(str) {
    if (typeof str !== 'string') return str;
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // High surrogate
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
        // Valid surrogate pair — keep both
        if (next >= 0xDC00 && next <= 0xDFFF) {
          out += str[i] + str[i + 1];
          i++;
        }
        // Lone high surrogate — skip
        continue;
      }
      // Lone low surrogate — skip
      if (code >= 0xDC00 && code <= 0xDFFF) continue;
      // Control chars (except tab, newline, carriage return)
      if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) continue;
      out += str[i];
    }
    return out;
  }

  // Remove escaped lone surrogates from a JSON string (\uD800-\uDFFF)
  _sanitizeJsonBody(json) {
    return json.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex, offset, str) => {
      const code = parseInt(hex, 16);
      if (code >= 0xD800 && code <= 0xDBFF) {
        // High surrogate — check if followed by escaped low surrogate
        const rest = str.slice(offset + 6, offset + 12);
        if (/^\\u[0-9a-fA-F]{4}/.test(rest)) {
          const nextCode = parseInt(rest.slice(2, 6), 16);
          if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) return match;
        }
        return '';
      }
      if (code >= 0xDC00 && code <= 0xDFFF) {
        // Low surrogate — check if preceded by escaped high surrogate
        if (offset >= 6) {
          const prev = str.slice(offset - 6, offset);
          if (/\\u[0-9a-fA-F]{4}$/.test(prev)) {
            const prevCode = parseInt(prev.slice(2, 6), 16);
            if (prevCode >= 0xD800 && prevCode <= 0xDBFF) return match;
          }
        }
        return '';
      }
      return match;
    });
  }

  async _callLLM(systemPrompt, userPrompt) {
    if (!this.llmApiKey) {
      this.logger.debug('No LLM API key, using heuristic');
      return this._heuristicResponse(userPrompt);
    }

    // Skip if rate-limited
    if (this.rateLimitedUntil > Date.now()) {
      this.logger.debug('LLM rate-limited, using heuristic');
      return this._heuristicResponse(userPrompt);
    }

    // Throttle: wait between calls to avoid hitting rate limit
    await new Promise(r => setTimeout(r, this.llmDelayMs));

    try {
      const body = this._sanitizeJsonBody(JSON.stringify({
        model: this.llmModel,
        max_tokens: 512,
        temperature: this.llmTemperature,
        system: this._sanitize(systemPrompt),
        messages: [{ role: 'user', content: this._sanitize(userPrompt) }],
      }));

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.llmApiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });

      if (!res.ok) {
        const errText = await res.text();
        // Handle rate limit (429) with backoff
        if (res.status === 429) {
          const retryAfter = parseInt(res.headers?.get?.('retry-after') || '60');
          this.rateLimitedUntil = Date.now() + (retryAfter * 1000);
          this.logger.warn(`LLM rate limited (429), backing off ${retryAfter}s`);
          return this._heuristicResponse(userPrompt);
        }
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      // Successful call — clear any rate limit
      this.rateLimitedUntil = 0;
      const data = await res.json();
      return data.content?.[0]?.text || '';
    } catch (err) {
      this.logger.error(`LLM call failed: ${err.message}`);
      return this._heuristicResponse(userPrompt);
    }
  }

  _heuristicResponse(context) {
    // Fallback: extract signal strengths and produce a simple verdict
    const strengthMatch = context.match(/signal_strength[":]*\s*(\d+)/g);
    const strengths = (strengthMatch || []).map(m => parseInt(m.match(/(\d+)/)[1]));
    const avg = strengths.length > 0 ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 5;

    return JSON.stringify({
      score: Math.round(avg),
      verdict: avg >= 7 ? 'call' : 'skip',
      arguments_for: ['Automated heuristic scoring based on signal strengths'],
      risks: ['No LLM analysis available - heuristic only'],
      summary: `Heuristic score: ${Math.round(avg)}/10 based on ${strengths.length} signal(s)`,
    });
  }

  _parseVerdict(raw, tokenKey, signals) {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: Number(parsed.score) || 0,
          verdict: parsed.verdict || 'skip',
          arguments_for: Array.isArray(parsed.arguments_for) ? parsed.arguments_for : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks : [],
          summary: parsed.summary || '',
          token: tokenKey,
        };
      }
    } catch {}

    // Fallback: heuristic aggregate
    const aggScore = Scoring.aggregateScore(signals);
    return {
      score: aggScore,
      verdict: aggScore >= this.publishThreshold ? 'call' : 'skip',
      arguments_for: ['Could not parse LLM verdict, using aggregate scoring'],
      risks: ['LLM verdict parsing failed'],
      summary: `Aggregate score: ${aggScore}/10`,
      token: tokenKey,
    };
  }

  _publish(verdict, signals) {
    const formattedCall = Formatter.formatAlphaCall(verdict, signals);
    this.publishCall(formattedCall);
    this.callHistory.push({ timestamp: Date.now(), verdict });
    this.publishedTokens.set(verdict.token, Date.now());
    const tag = LARGE_CAPS.has(verdict.token) ? 'LARGECAP' : 'LOWCAP';
    this.logger.info(`PUBLISHED [${tag}]: ${verdict.token} - Score ${verdict.score}/10`);

    for (const fn of this.callListeners) {
      try {
        fn({ verdict, signals, formatted: formattedCall });
      } catch {}
    }
  }

  _groupByToken(signals) {
    const groups = {};
    let skipped = 0;
    for (const signal of signals) {
      const symbol = signal.data?.token?.symbol;
      const name = signal.data?.token?.name;
      // Skip signals with no identifiable token (generic news)
      if (!symbol && !name) { skipped++; continue; }
      const key = (symbol || name).toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(signal);
    }
    if (skipped) this.logger.debug(`Skipped ${skipped} signals with no token identifier`);
    return groups;
  }

  _buildContext(tokenKey, signals) {
    const isLargeCap = LARGE_CAPS.has(tokenKey);
    let ctx = `Token under evaluation: ${tokenKey} [${isLargeCap ? 'LARGE CAP — requires exceptional catalyst' : 'LOW/MID CAP — high multiplier potential'}]\n`;
    if (this.fearGreedCache) {
      ctx += `\nMarket Macro: Fear & Greed Index = ${this.fearGreedCache.value}/100 (${this.fearGreedCache.label})\n`;
    }
    ctx += `\nSignals detected:\n`;
    for (const s of signals) {
      ctx += `\n--- ${s.agent} (${s.role}) ---\n`;
      ctx += `Type: ${s.data?.type || 'unknown'}\n`;
      ctx += `Strength: ${s.data?.signal_strength || '?'}/10\n`;
      if (s.data?.token) {
        const t = s.data.token;
        if (t.price_usd) ctx += `Price: $${t.price_usd}\n`;
        if (t.volume_24h) ctx += `Volume 24h: $${t.volume_24h}\n`;
        if (t.liquidity_usd) ctx += `Liquidity: $${t.liquidity_usd}\n`;
        if (t.chain) ctx += `Chain: ${t.chain}\n`;
        if (t.age_hours) ctx += `Token age: ${t.age_hours}h\n`;
      }
      if (s.data?.news) {
        ctx += `News: "${s.data.news.title}" (${s.data.news.source})\n`;
        if (s.data.news.sentiment) ctx += `Sentiment: ${s.data.news.sentiment}\n`;
      }
      if (s.data?.sentiment) {
        ctx += `Sentiment: ${s.data.sentiment.ratio} - ${s.data.sentiment.mentions} mentions\n`;
        if (s.data.sentiment.trending) ctx += `Trending: yes\n`;
      }
      if (s.data?.reddit) {
        const r = s.data.reddit;
        ctx += `Reddit: r/${r.subreddit} - "${r.title}" (${r.upvotes} upvotes, ${r.num_comments} comments)\n`;
      }
      if (s.data?.twitter) {
        const tw = s.data.twitter;
        ctx += `X/Twitter: @${tw.account} - "${tw.text?.slice(0, 120)}" (${tw.likes} likes, ${tw.retweets} RTs)\n`;
      }
      if (s.data?.reasoning) ctx += `Reasoning: ${s.data.reasoning}\n`;
      if (s.data?.risks?.length) ctx += `Risks: ${s.data.risks.join('; ')}\n`;
    }
    return ctx;
  }

  _withinRateLimit() {
    const oneHourAgo = Date.now() - 3_600_000;
    this.callHistory = this.callHistory.filter(c => c.timestamp > oneHourAgo);
    return this.callHistory.length < this.maxCallsPerHour;
  }
}
