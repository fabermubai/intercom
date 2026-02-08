# AlphaSwarm

**Multi-agent AI alpha scanner built on Intercom (Trac Network)**

AlphaSwarm is an autonomous swarm of specialized AI agents that scan crypto markets in real-time, debate opportunities via Intercom sidechannels, and publish high-conviction alpha calls to a public channel and Telegram.

Built for the [Intercom Vibe Competition](https://github.com/Trac-Systems/intercom-competition) | Based on [Intercom](https://github.com/Trac-Systems/intercom)

**Trac Address:** `trac10njpx7gluagxkg96tld2f90nj9mvpgy5gc4akf7z77pncu9u8enstmvsyx`

---

## How It Works

```
  DexScreener   CryptoPanic   CoinGecko   RSS Feeds
       |             |            |           |
       v             v            v           v
  +-----------+ +-----------+ +---------------+
  | OnChain   | | News      | | Sentiment     |
  | Scout     | | Hawk      | | Analyst       |
  +-----------+ +-----------+ +---------------+
       |             |            |
       v             v            v
  +------------------------------------+
  | Debate Channel (alphaswarm-debate) |
  | Agents exchange signals, argue,    |
  | counter-argue via Intercom P2P     |
  +------------------------------------+
                   |
                   v
          +----------------+
          |   Judge Agent  |
          | LLM synthesis  |
          | Score 1-10     |
          +----------------+
                   |
        score >= 7 |
                   v
     +-------------+-------------+-------------+
     |                           |             |
     v                           v             v
+------------------+    +------------+  +----------+
| Public Channel   |    | Telegram   |  | X/Twitter|
| 0000alphaswarm   |    | (optional) |  | (optional|
+------------------+    +------------+  +----------+
```

### Agents

| Agent | Role | Data Sources |
|-------|------|-------------|
| **OnChain Scout** | Detects volume spikes, new tokens, price movements | DexScreener, CoinGecko |
| **News Hawk** | Detects news catalysts (listings, partnerships, hacks) | CryptoPanic, RSS feeds |
| **Sentiment Analyst** | Analyzes community sentiment shifts and trends | CryptoPanic votes, CoinGecko trending |
| **Judge** | Orchestrates LLM debate, scores opportunities, publishes calls | Anthropic API (Claude) |

### The Debate

The debate is visible on the `alphaswarm-debate` Intercom sidechannel. Each cycle:

1. Scanner agents detect signals and broadcast them to the debate channel
2. The Judge collects signals and groups them by token
3. If signals are strong enough, the Judge asks each agent persona (via LLM) for their verdict
4. After 2 rounds of debate, the Judge synthesizes a final verdict with a conviction score (1-10)
5. If score >= 7, the call is published to the public channel `0000alphaswarm`

---

## Installation

### Prerequisites

- Node.js 22+
- [Pear Runtime](https://docs.pears.com) installed globally: `npm install -g pear`

### Setup

```bash
# Clone the repository
git clone https://github.com/fabermubai/intercom.git
cd alphaswarm

# Install dependencies
npm install

# Create your configuration
cp config.example.json config.json
# Edit config.json with your API keys
```

### Configuration

Edit `config.json`:

| Key | Required | Description |
|-----|----------|-------------|
| `sources.cryptopanic.api_key` | Optional | Free API key from [cryptopanic.com/developers/api/](https://cryptopanic.com/developers/api/) |
| `agents.llm_api_key` | Optional | Anthropic API key for LLM debate (without it, uses heuristic scoring) |
| `telegram.bot_token` | Optional | Telegram bot token from @BotFather |
| `telegram.channel_id` | Optional | Telegram channel to post calls |
| `twitter.app_key` | Optional | X/Twitter app key from [developer.x.com](https://developer.x.com) |
| `twitter.app_secret` | Optional | X/Twitter app secret |
| `twitter.access_token` | Optional | X/Twitter access token |
| `twitter.access_secret` | Optional | X/Twitter access secret |

The system works without any API keys (using DexScreener + CoinGecko free APIs + heuristic scoring), but adding the Anthropic key enables the full LLM debate experience.

### Run

```bash
# Start AlphaSwarm
pear run . store1

# To run a second peer (for testing P2P):
# First copy the subnet-bootstrap.hex from store1, then:
pear run . store2 --subnet-bootstrap <hex-from-store1>
```

---

## Terminal Commands

All standard Intercom commands plus:

| Command | Description |
|---------|-------------|
| `/alpha_status` | Show agent status (running, signal buffer, etc.) |
| `/alpha_last` | Show the last published alpha call |
| `/alpha_stats` | Show statistics (total calls, calls/hour, agents) |

Join channels to see activity:
```
/sc_join --channel "alphaswarm-debate"    # Watch the debate
/sc_join --channel "0000alphaswarm"       # See published calls
```

---

## Architecture

```
alphaswarm/
├── index.js                    # Entry point (Intercom + AlphaSwarm init)
├── config.json                 # Your configuration (gitignored)
├── config.example.json         # Config template
├── contract/
│   ├── protocol.js             # Intercom protocol + AlphaSwarm commands
│   └── contract.js             # Intercom contract (deterministic state)
├── agents/
│   ├── base-agent.js           # Abstract agent class
│   ├── onchain-agent.js        # On-chain data scanner
│   ├── news-agent.js           # News scanner
│   ├── sentiment-agent.js      # Sentiment analyzer
│   └── judge-agent.js          # Debate orchestrator + publisher
├── sources/
│   ├── dexscreener.js          # DexScreener API client
│   ├── coingecko.js            # CoinGecko API client
│   ├── cryptopanic.js          # CryptoPanic API client
│   └── rss.js                  # RSS feed parser
├── relay/
│   ├── telegram-bot.js         # Telegram relay bot
│   └── twitter-bot.js          # X/Twitter relay (OAuth 1.0a)
├── utils/
│   ├── logger.js               # Logging utility
│   ├── formatter.js            # Message formatting
│   └── scoring.js              # Signal scoring
└── features/
    ├── scanner/index.js        # AlphaSwarm scanner feature
    ├── sidechannel/index.js    # Intercom sidechannel (inherited)
    ├── sc-bridge/index.js      # Intercom SC-Bridge (inherited)
    └── timer/index.js          # Intercom timer (inherited)
```

---

## Competition Info

- **Competition:** [Intercom Vibe Competition](https://github.com/Trac-Systems/intercom-competition)
- **Based on:** [Intercom (Trac Network)](https://github.com/Trac-Systems/intercom)
- **Trac Address:** `trac10njpx7gluagxkg96tld2f90nj9mvpgy5gc4akf7z77pncu9u8enstmvsyx`

---

## Roadmap

### Monetization (post-competition)
- **Free tier:** Delayed calls (30 min) on public channel `0000alphaswarm`
- **Premium tier:** Real-time calls + full agent debate + risk analysis on private channel
- **Payment:** TNK via Trac smart contract (automatic access on payment verification)
- **Staking model:** Stake X TNK for ongoing access (withdraw anytime)
- **Revenue share:** Signal contributors earn a share of collected TNK

### Planned features
- More data sources (LunarCrush, Telegram KOL channels)
- Call performance tracking (win rate, avg ROI)
- On-chain reputation scoring via Trac contract
- Historical call database with backtesting

---

## License

Based on the Intercom reference implementation by Trac Systems.
