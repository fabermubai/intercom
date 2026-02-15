import { BaseAgent } from './base-agent.js';
import { Formatter } from '../utils/formatter.js';
import { Scoring } from '../utils/scoring.js';
import { FearGreedClient } from '../sources/fear-greed.js';

// Well-known large caps (fallback when market cap data is unavailable)
const KNOWN_LARGE_CAPS = new Set([
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'TRX', 'AVAX', 'DOT',
  'LINK', 'MATIC', 'UNI', 'LTC', 'ATOM', 'XLM', 'NEAR', 'TON', 'HBAR',
]);

// Dynamic large cap threshold: any token with MC > 100M is treated as large cap
const LARGE_CAP_THRESHOLD = 100_000_000;

const PERSONA_NAMES = {
  onchain: 'Brody the Chain Dog',
  news: 'Mika the Insider',
  sentiment: 'Vibe Check Victor',
  telegram: 'TG Phantom',
  reddit: 'Ape Lord',
  xscout: 'X Hawk',
};

const PERSONAS = {
  onchain: `You are "Brody the Chain Dog" — a street-smart on-chain degen who lives on Etherscan and Solscan. You talk like a crypto bro, use slang ("ser", "ngmi", "lfg"), and get hyped about fresh deploys. You evaluate tokens based on on-chain data: volume, liquidity, token age, holder distribution, trading patterns. You look for red flags (rug pulls, honeypots, wash trading) but you are BULLISH on young tokens — a new token (< 24h) with real volume ($50K+) and decent liquidity ($10K+) is a potential gem, not a warning. Age alone is NEVER a disqualifier. Score generously for fresh tokens with strong metrics. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  news: `You are "Mika the Insider" — a sharp, well-connected crypto journalist who always has the scoop before everyone else. You speak with confidence and drop alpha like it's nothing. You evaluate tokens based on news catalysts: listings, partnerships, technical upgrades, regulatory changes. You assess news credibility and potential price impact. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  sentiment: `You are "Vibe Check Victor" — a chill market psychologist who reads the crowd like a book. You use metaphors and talk about "the energy" and "the vibe". You evaluate tokens based on community sentiment, social trends, and market psychology. You look for divergences between sentiment and price. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  telegram: `You are "TG Phantom" — a mysterious lurker who haunts every alpha Telegram group 24/7. You speak in short, cryptic sentences and always know what's being shilled. You evaluate tokens based on community calls, hype signals, and emerging trends from Telegram channels. You are wary of pump-and-dump schemes and look for genuine community conviction vs manufactured hype. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  reddit: `You are "Ape Lord" — a Reddit degenerate who browses r/CryptoMoonShots at 3am. You're skeptical but secretly love a good moonshot. You evaluate tokens based on subreddit discussions, upvote patterns, comment sentiment, and crowd conviction. You watch for astroturfing, coordinated pumps, and distinguish genuine grassroots interest from manufactured hype. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  xscout: `You are "X Hawk" — a CT (Crypto Twitter) veteran who follows every whale and alpha caller. You're sarcastic and don't trust influencers easily. You evaluate tokens based on tweets from whale trackers, influencers, and alpha accounts. You assess the credibility of the source, the engagement metrics (likes, retweets), and whether the signal represents genuine alpha or paid promotion. Give your verdict in 2-3 punchy sentences with personality and a conviction score (1-10).`,

  judge: `You are the Judge of AlphaSwarm, an AI-powered crypto alpha scanner in DEGEN MODE — focused on finding HIGH-MULTIPLIER opportunities in LOWCAP tokens (under $100M market cap). You synthesize arguments from all agents to produce a final verdict.

PRIORITY: Find lowcap gems with 5-100x potential. Be AGGRESSIVE with scoring for lowcaps:
- Brand new tokens (< 24h old) with strong volume and liquidity: score 6+ even with limited data — early entry IS the alpha
- Tokens with multi-source buzz (2+ agents): score 5+ minimum
- Single strong signal from on-chain (volume spike, fresh deploy): score 5+ if volume/liquidity looks real
- The goal is EARLY DISCOVERY — it's better to call a risky gem early than miss a 50x
- Score 7+ for tokens with strong fundamentals across multiple signals
- Score 9+ only for exceptional multi-signal lowcap setups

LARGE CAPS (over $100M MC): Almost NEVER call these. Only score 7+ if ALL of the following: (1) massive price crash (-20%+ in 24h) creating a dip buy opportunity, OR (2) major team/protocol announcement (new chain launch, major partnership, token burn), OR (3) extreme fear/greed divergence. Routine trending or sentiment signals are NOT enough for large caps.

You MUST respond with ONLY a JSON object (no markdown, no extra text) in this format: { "score": <number 1-10>, "verdict": "call" or "skip", "arguments_for": [<string>, ...], "risks": [<string>, ...], "summary": "<one sentence summary>" }`,
};

export class JudgeAgent extends BaseAgent {
  constructor(peer, config = {}) {
    super('Judge', 'judge', peer, config);
    this.signalBuffer = [];
    this.agents = [];
    this.publishThreshold = config.alphaswarm?.publish_threshold || 7;
    this.lowcapThreshold = config.alphaswarm?.lowcap_threshold || 5;
    this.maxCallsPerHour = config.alphaswarm?.max_calls_per_hour || 10;
    this.debateRounds = config.agents?.debate_rounds || 2;
    this.callHistory = [];
    this.callListeners = [];
    this.watchlistListeners = [];
    this.llmProvider = config.agents?.llm_provider || 'anthropic';
    this.llmApiKey = config.agents?.llm_api_key || '';
    this.llmBaseUrl = config.agents?.llm_base_url || 'https://api.anthropic.com';
    this.llmModel = config.agents?.llm_model || 'claude-sonnet-4-20250514';
    this.llmTemperature = config.agents?.agent_temperature || 0.7;
    this.llmMaxTokens = this.llmProvider === 'local' ? 256 : 512;
    this.fearGreed = new FearGreedClient(config.sources?.fear_greed || {});
    this.fearGreedCache = null;
    this.rateLimitedUntil = 0;
    this.maxEvalsPerCycle = 5;
    this.llmDelayMs = this.llmProvider === 'local' ? 500 : 2500; // local = no rate limit
    this.publishedTokens = new Map(); // token -> last published timestamp
    this.largecapCooldownMs = 2 * 3_600_000; // 2h cooldown for large caps
    this.defaultCooldownMs = 30 * 60_000; // 30 min cooldown for others
    this.dexscreener = null; // set via setDexScreener()
  }

  setDexScreener(client) {
    this.dexscreener = client;
  }

  async analyzeToken(query) {
    if (!this.dexscreener) {
      return { error: 'DexScreener not available' };
    }

    this.logger.info(`Manual analysis requested: ${query}`);
    const token = await this.dexscreener.searchToken(query);
    if (!token) {
      return { error: `Token "${query}" not found on DexScreener` };
    }

    const signal = {
      agent: 'Manual Request',
      role: 'onchain',
      data: {
        type: 'manual_analysis',
        signal_strength: 7,
        token,
        reasoning: `User-requested analysis for ${token.symbol}`,
      },
    };

    const verdict = await this.runDebate(token.symbol.toUpperCase(), [signal]);
    if (!verdict) {
      return { error: 'Debate failed — LLM may be unavailable' };
    }

    return { verdict, token, signals: [signal] };
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

  onWatchlist(fn) {
    this.watchlistListeners.push(fn);
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

      // Dynamic large cap detection: market cap > 100M OR well-known name
      const maxMarketCap = Math.max(0, ...signals.map(s => {
        const t = s.data?.token || s.token || {};
        return t.market_cap || 0;
      }));
      const isLargeCap = KNOWN_LARGE_CAPS.has(tokenKey) || maxMarketCap >= LARGE_CAP_THRESHOLD;

      // Minimum strength to even consider
      // Large caps need much stronger signals to avoid wasting LLM calls
      // Lowcaps: aggressive — even weak signals from a single agent get evaluated
      let minStrength;
      if (isLargeCap) {
        minStrength = hasMultipleAgents ? 7 : 8;
      } else {
        minStrength = hasMultipleAgents ? 3 : (this.llmApiKey ? 5 : 6);
      }
      if (maxStrength < minStrength) {
        this.logger.debug(`Skipping ${tokenKey}: strength ${maxStrength} < ${minStrength}${isLargeCap ? ' (largecap)' : ''}`);
        continue;
      }

      // Cooldown: don't re-evaluate recently published tokens
      const lastPublished = this.publishedTokens.get(tokenKey) || 0;
      const cooldown = isLargeCap ? this.largecapCooldownMs : this.defaultCooldownMs;
      if (lastPublished && (now - lastPublished) < cooldown) {
        skippedCooldown++;
        continue;
      }

      // Priority: lowcaps get big boost, large caps heavily penalized
      let priority = maxStrength + uniqueAgents;
      if (isLargeCap) {
        priority -= 10; // large caps heavily deprioritized
      } else {
        priority += 3; // lowcap bonus
      }

      candidates.push({ tokenKey, signals, maxStrength, uniqueAgents, isLargeCap, maxMarketCap, priority });
    }

    if (skippedCooldown > 0) {
      this.logger.debug(`${skippedCooldown} tokens skipped (cooldown)`);
    }

    // Sort by priority descending — lowcaps first
    candidates.sort((a, b) => b.priority - a.priority);

    let evalsThisCycle = 0;
    let deferred = 0;
    for (const { tokenKey, signals, maxStrength, isLargeCap, maxMarketCap } of candidates) {
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

      if (!verdict) continue;

      // Only publish calls at 7/10+
      const threshold = isLargeCap ? 10 : this.publishThreshold;
      if (verdict.score >= threshold) {
        this._publish(verdict, signals);
      } else {
        this.logger.info(`${tokenKey}: score ${verdict.score}/10 - skipped (below ${threshold})`);
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
      const signalRoles = [...new Set(signals.map(s => s.role))];
      // Always bring at least 3 diverse agents to the debate
      const extraRoles = ['onchain', 'sentiment', 'news'].filter(r => !signalRoles.includes(r));
      const roles = [...signalRoles, ...extraRoles].slice(0, Math.max(3, signalRoles.length));

      for (const role of roles) {
        const persona = PERSONAS[role] || PERSONAS.onchain;
        const prompt = round === 0
          ? context
          : `${context}\n\nPrevious debate:\n${debateLog.join('\n')}`;

        const response = await this._callLLM(persona, prompt);
        const personaName = PERSONA_NAMES[role] || signals.find(s => s.role === role)?.agent || role;

        debateLog.push(`[${personaName}] (Round ${round + 1}): ${response}`);

        this.submitDebateMessage({
          type: 'debate_round',
          round: round + 1,
          agent: personaName,
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

    verdict.debateLog = debateLog;
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

    const callStart = Date.now();
    const timeoutMs = this.llmProvider === 'local' ? 30_000 : 60_000;
    try {
      const body = this._sanitizeJsonBody(JSON.stringify({
        model: this.llmModel,
        max_tokens: this.llmMaxTokens,
        temperature: this.llmTemperature,
        system: this._sanitize(systemPrompt),
        messages: [{ role: 'user', content: this._sanitize(userPrompt) }],
      }));

      const apiUrl = `${this.llmBaseUrl}/v1/messages`;
      this.logger.info(`LLM call → ${this.llmModel} ...`);

      // Use Promise.race for timeout (bare-fetch may not support AbortController)
      const fetchPromise = fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.llmApiKey,
          'anthropic-version': '2023-06-01',
        },
        body,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`LLM timeout (${timeoutMs}ms)`)), timeoutMs)
      );
      const res = await Promise.race([fetchPromise, timeoutPromise]);

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
      this.logger.info(`LLM OK (${Date.now() - callStart}ms)`);
      return data.content?.[0]?.text || '';
    } catch (err) {
      const elapsed = Date.now() - callStart;
      this.logger.error(`LLM failed (${elapsed}ms): ${err.message}`);
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
    const tag = KNOWN_LARGE_CAPS.has(verdict.token) ? 'LARGECAP' : 'LOWCAP';
    this.logger.info(`PUBLISHED [${tag}]: ${verdict.token} - Score ${verdict.score}/10`);

    for (const fn of this.callListeners) {
      try {
        fn({ verdict, signals, formatted: formattedCall });
      } catch {}
    }
  }

  _publishWatchlist(verdict, signals) {
    const formattedCall = Formatter.formatAlphaCall(verdict, signals);
    this.publishCall(formattedCall);
    this.publishedTokens.set(verdict.token, Date.now());
    const tag = KNOWN_LARGE_CAPS.has(verdict.token) ? 'LARGECAP' : 'LOWCAP';
    this.logger.info(`WATCHLIST [${tag}]: ${verdict.token} - Score ${verdict.score}/10`);

    for (const fn of this.watchlistListeners) {
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
    const maxMc = Math.max(0, ...signals.map(s => (s.data?.token || s.token || {}).market_cap || 0));
    const isLargeCap = KNOWN_LARGE_CAPS.has(tokenKey) || maxMc >= LARGE_CAP_THRESHOLD;
    let ctx = `Token under evaluation: ${tokenKey} [${isLargeCap ? `LARGE CAP (MC: $${Math.round(maxMc / 1e6)}M) — only call on major crash dip, team announcement, or exceptional catalyst` : 'LOW/MID CAP — high multiplier potential'}]\n`;
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
