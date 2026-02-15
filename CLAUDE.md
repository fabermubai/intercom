# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AlphaSwarm is a multi-agent AI crypto alpha scanner built on the Trac Network's Intercom protocol. Agents scan 9+ data sources, debate via LLM, and publish high-conviction token calls to P2P channels and Telegram.

## Running the App

```bash
# MUST use Pear Runtime (never `node index.js`)
pear run . store1

# Multi-peer testing (second terminal, after store1 boots):
pear run . store2 --subnet-bootstrap <hex-from-store1>

# Kill stale processes on Windows:
wmic process where "name like '%pear%'" call terminate
```

## Architecture

```
Sources (DexScreener, CoinGecko, PumpFun, GMGN, RSS, Reddit, X, Telegram)
    ↓ scan()
Agents (OnChain, News, Sentiment, Reddit, X, Telegram)
    ↓ submitSignal() → sidechannel.broadcast() + EventEmitter
JudgeAgent
    ↓ LLM multi-round debate → score 1-10
    ↓ publish if score >= threshold
Relays (Telegram bot, X bot) + Intercom public channel
```

**Signal flow:** Agent.scan() → Agent.submitSignal() → Sidechannel broadcast (P2P) + local EventEmitter → Judge.signalBuffer → LLM debate → publish/skip → Telegram relay

**Key globals:**
- `globalThis._alphaswarmJudge` — Judge instance for onMessage callback routing
- `globalThis.fetch` — polyfilled from `bare-fetch` at startup

## Pear/Bare Runtime Constraints

- **No `process`** — use `globalThis` instead of `process.env`
- **No native `fetch`** — polyfilled via `import bareFetch from 'bare-fetch'` + `globalThis.fetch = bareFetch`
- **No `AbortController`** — use `Promise.race` with `setTimeout` for timeouts
- **No npm deps beyond Intercom base** — uses `bare-fetch` (transitive dep), regex-based parsers
- **ESM only** (`"type": "module"` in package.json)
- **Lock files persist** if process killed ungracefully → `wmic` to terminate

## Contract Rules (contract/contract.js)

The contract is deterministic on-chain execution. It MUST NOT contain:
- try-catch blocks
- HTTP/API calls
- Random values
- Complex calculations

All non-deterministic logic (API calls, LLM, scoring) lives in `agents/` and `sources/`, never in the contract.

## Key Thresholds & Config

| Setting | Default | Notes |
|---------|---------|-------|
| `publish_threshold` | 7 | Score needed for standard calls |
| `lowcap_threshold` | 5 | Score needed for lowcap (<$100M MC) calls |
| Large cap threshold | 10 | Tokens with MC >$100M need extreme conviction |
| `debate_rounds` | 2 | LLM debate rounds per token |
| `scan_interval_seconds` | 60 | Time between scan cycles |
| `max_calls_per_hour` | 10 | Rate limit for published calls |
| `maxEvalsPerCycle` | 5 | Max tokens evaluated per Judge cycle |

## LLM Provider Config

Supports `"anthropic"` (cloud) or `"local"` (LM Studio) via `config.json`:
- Anthropic: `llm_model: "claude-sonnet-4-20250514"`, timeout 60s
- Local: any OpenAI-compatible endpoint, timeout 30s
- Fallback: heuristic scoring (average of signal_strength values) when LLM fails

## API Rate Limits

- DexScreener: 300 req/min (no key)
- CoinGecko: 30 req/min free tier (3 min cache)
- CryptoPanic: free tier with API key (`api/free/v1` NOT `api/v1`)
- Pump.fun: requires JWT → DexScreener fallback
- GMGN: Cloudflare-blocked → 10 min backoff

## P2P Communication (Sidechannel)

- `peer.sidechannel.broadcast(channel, message)` to send
- `onMessage` callback on Sidechannel constructor to receive
- `addChannel(name)` to join channels
- AlphaSwarm channels: `alphaswarm-debate` (agent signals), `0000alphaswarm` (published calls)
- Features include POW spam prevention, rate limiting (64KB/s), invite system

## Important Patterns

- **Agents extend BaseAgent** — must implement `scan()` returning signal array
- **Judge uses listener pattern** — `onCall(fn)` and `onWatchlist(fn)` for relay attachment
- **Formatter is static** — `Formatter.formatTelegramCall(verdict, signals, options)`
- **Config is passed through constructors** — agents, sources, and relays all receive the full config object
- **Seen/cache sets** — most sources maintain `seenTokens` Set + TTL cache to avoid duplicates; prune at 500 entries

## config.json

Contains API keys and secrets — already in `.gitignore`. Use `config.example.json` as template. Never commit `config.json`.
