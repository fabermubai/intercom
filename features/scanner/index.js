export class Scanner {
  constructor(peer, options = {}) {
    this.peer = peer;
    this.agents = options.agents || [];
    this.judgeAgent = options.judgeAgent || null;
    this.running = false;
  }

  async start() {
    this.running = true;
    console.log(`[AlphaSwarm] Scanner starting with ${this.agents.length} agents`);

    // Start all scanner agents (non-blocking)
    for (const agent of this.agents) {
      agent.start().catch(err => {
        console.error(`[AlphaSwarm] Agent ${agent.name} stopped:`, err?.message || err);
      });
    }

    // Start the judge agent (non-blocking)
    if (this.judgeAgent) {
      this.judgeAgent.start().catch(err => {
        console.error('[AlphaSwarm] Judge agent stopped:', err?.message || err);
      });
    }
  }

  async stop() {
    this.running = false;
    for (const agent of this.agents) {
      agent.stop();
    }
    if (this.judgeAgent) {
      this.judgeAgent.stop();
    }
    console.log('[AlphaSwarm] Scanner stopped');
  }

  getStatus() {
    return {
      running: this.running,
      agents: this.agents.map(a => ({
        name: a.name,
        role: a.role,
        running: a.running,
      })),
      judge: this.judgeAgent ? {
        name: this.judgeAgent.name,
        running: this.judgeAgent.running,
        signalBuffer: this.judgeAgent.signalBuffer.length,
        callsThisHour: this.judgeAgent.callHistory.filter(
          c => c.timestamp > Date.now() - 3_600_000
        ).length,
      } : null,
    };
  }
}
