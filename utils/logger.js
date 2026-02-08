export class Logger {
  constructor(name) {
    this.name = name;
  }

  _ts() {
    return new Date().toISOString().slice(11, 19);
  }

  info(msg, ...args) {
    console.log(`[${this._ts()}] [${this.name}] INFO: ${msg}`, ...args);
  }

  warn(msg, ...args) {
    console.warn(`[${this._ts()}] [${this.name}] WARN: ${msg}`, ...args);
  }

  error(msg, ...args) {
    console.error(`[${this._ts()}] [${this.name}] ERROR: ${msg}`, ...args);
  }

  debug(msg, ...args) {
    if (globalThis.ALPHASWARM_DEBUG) {
      console.log(`[${this._ts()}] [${this.name}] DEBUG: ${msg}`, ...args);
    }
  }
}
