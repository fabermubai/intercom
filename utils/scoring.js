export class Scoring {
  static volumeScore(volumeChangePct, volume24h, liquidityUsd, ageHours = null) {
    let score = 1;
    if (volumeChangePct > 500) score += 3;
    else if (volumeChangePct > 300) score += 2;
    else if (volumeChangePct > 100) score += 1;

    if (volume24h > 5_000_000) score += 2;
    else if (volume24h > 1_000_000) score += 1.5;
    else if (volume24h > 500_000) score += 1;

    if (liquidityUsd > 500_000) score += 2;
    else if (liquidityUsd > 100_000) score += 1.5;
    else if (liquidityUsd > 50_000) score += 1;
    else if (liquidityUsd > 0 && liquidityUsd < 10_000) score -= 1;

    // Early discovery bonus: young token with solid fundamentals
    if (ageHours !== null && ageHours < 24 && liquidityUsd >= 10_000 && volume24h >= 50_000) {
      score += 1.5;
    }

    return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  }

  static newsScore(sentiment, voteCount, source) {
    let score = 3;
    if (sentiment === 'bullish') score += 2;
    else if (sentiment === 'bearish') score += 1;

    if (voteCount > 50) score += 3;
    else if (voteCount > 20) score += 2;
    else if (voteCount > 5) score += 1;

    const trustedSources = ['cointelegraph', 'theblock', 'coindesk', 'decrypt', 'bloomberg'];
    if (trustedSources.some(s => (source || '').toLowerCase().includes(s))) {
      score += 1;
    }

    return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  }

  static sentimentScore(positiveVotes, negativeVotes, isTrending) {
    let score = 3;
    const total = positiveVotes + negativeVotes;
    if (total > 0) {
      const ratio = positiveVotes / total;
      if (ratio > 0.9) score += 3;
      else if (ratio > 0.75) score += 2;
      else if (ratio > 0.6) score += 1;
    }
    if (total > 30) score += 1;
    if (isTrending) score += 2;

    return Math.max(1, Math.min(10, Math.round(score * 10) / 10));
  }

  static aggregateScore(signals) {
    if (!signals || signals.length === 0) return 0;
    const scores = signals.map(s => s.data?.signal_strength || s.signal_strength || 0);
    const sum = scores.reduce((a, b) => a + b, 0);
    const avg = sum / scores.length;
    const bonus = signals.length >= 3 ? 1 : signals.length >= 2 ? 0.5 : 0;
    return Math.max(1, Math.min(10, Math.round((avg + bonus) * 10) / 10));
  }
}
