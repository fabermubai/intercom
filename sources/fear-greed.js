import { Logger } from '../utils/logger.js';

export class FearGreedClient {
  constructor(config = {}) {
    this.url = 'https://api.alternative.me/fng/?limit=1&format=json';
    this.cacheTtlMs = (config.cache_ttl_seconds || 300) * 1000;
    this.logger = new Logger('FearGreed');
    this.cache = { data: null, ts: 0 };
  }

  async scan() {
    const now = Date.now();
    if (this.cache.data && (now - this.cache.ts) < this.cacheTtlMs) {
      return this.cache.data;
    }

    try {
      const res = await fetch(this.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const entry = json?.data?.[0];
      if (!entry) return null;

      const result = {
        value: parseInt(entry.value) || 50,
        label: entry.value_classification || 'Neutral',
        timestamp: parseInt(entry.timestamp) * 1000 || now,
      };

      this.cache = { data: result, ts: now };
      this.logger.info(`Fear & Greed: ${result.value} (${result.label})`);
      return result;
    } catch (err) {
      this.logger.error(`Fetch failed: ${err.message}`);
      return this.cache.data || { value: 50, label: 'Neutral', timestamp: now };
    }
  }
}
