import { Logger } from '../utils/logger.js';

export class BaseAgent {
  constructor(name, role, peer, config = {}) {
    this.name = name;
    this.role = role;
    this.peer = peer;
    this.config = config;
    this.logger = new Logger(name);
    this.debateChannel = config.alphaswarm?.debate_channel || 'alphaswarm-debate';
    this.publicChannel = config.alphaswarm?.public_channel || '0000alphaswarm';
    this.running = false;
    this._listeners = [];
  }

  async scan() {
    throw new Error('scan() not implemented');
  }

  async debate(_context) {
    throw new Error('debate() not implemented');
  }

  submitSignal(signal) {
    const message = JSON.stringify({
      type: 'signal',
      agent: this.name,
      role: this.role,
      data: signal,
      timestamp: new Date().toISOString(),
    });

    // Broadcast via Intercom sidechannel
    if (this.peer?.sidechannel) {
      try {
        this.peer.sidechannel.broadcast(this.debateChannel, message);
      } catch (err) {
        this.logger.warn(`Sidechannel broadcast failed: ${err.message}`);
      }
    }

    // Also emit locally for in-process Judge
    for (const fn of this._listeners) {
      try {
        fn({ agent: this.name, role: this.role, data: signal });
      } catch {}
    }
  }

  submitDebateMessage(msg) {
    const message = JSON.stringify({
      type: 'debate',
      agent: this.name,
      role: this.role,
      data: msg,
      timestamp: new Date().toISOString(),
    });

    if (this.peer?.sidechannel) {
      try {
        this.peer.sidechannel.broadcast(this.debateChannel, message);
      } catch {}
    }
  }

  publishCall(formattedCall) {
    if (this.peer?.sidechannel) {
      try {
        this.peer.sidechannel.broadcast(this.publicChannel, formattedCall);
        this.logger.info('Call published to public channel');
      } catch (err) {
        this.logger.error(`Publish failed: ${err.message}`);
      }
    }
  }

  onSignal(fn) {
    this._listeners.push(fn);
  }

  async start() {
    this.running = true;
    this.logger.info('Started');
    const interval = (this.config.alphaswarm?.scan_interval_seconds || 60) * 1000;

    while (this.running) {
      try {
        const signals = await this.scan();
        if (signals && signals.length > 0) {
          this.logger.info(`Found ${signals.length} signals`);
          for (const signal of signals) {
            this.submitSignal(signal);
          }
        }
      } catch (err) {
        this.logger.error(`Scan error: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
  }

  stop() {
    this.running = false;
    this.logger.info('Stopped');
  }
}
