# AlphaSwarm

**Multi-agent AI alpha scanner built on Intercom (Trac Network)**

AlphaSwarm is an autonomous swarm of specialized AI agents that scan crypto markets in real-time, debate opportunities via Intercom sidechannels, and publish high-conviction alpha calls to a public channel and Telegram.

Built for the [Intercom Vibe Competition](https://github.com/Trac-Systems/intercom-competition) | Based on [Intercom](https://github.com/Trac-Systems/intercom)

**Trac Address:** `trac10njpx7gluagxkg96tld2f90nj9mvpgy5gc4akf7z77pncu9u8enstmvsyx`

---

## How It Works

```
  DexScreener  CoinGecko  Pump.fun  GMGN  RSS  Telegram  Reddit  X/Twitter
       |           |          |       |     |      |         |        |
       v           v          v       v     v      v         v        v
  +---------+ +--------+ +---------+ +--------+ +------+ +------+
  | OnChain | | News   | |Sentiment| |Telegram| |Reddit| |  X   |
  | Scout   | | Hawk   | |Analyst  | | Scout  | |Scout | |Scout |
  +---------+ +--------+ +---------+ +--------+ +------+ +------+
       |           |          |          |         |        |
       +-----+-----+----+-----+----+-----+--------+--------+
             |                |
             v                v
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
     lowcap >= 5   |  largecap >= 9
                   v
     +------+------+------+------+
     |      |             |      |
     v      v             v      v
+--------+ +----------+ +----+ +-------+
| Public | | Telegram | | X  | | Radar |
| 0000.. | | (opt.)   | |(op)| | <$1M  |
+--------+ +----------+ +----+ +-------+
```

### Agents

| Agent | Role | Data Sources |
|-------|------|-------------|
| **OnChain Scout** | Detects volume spikes, new tokens, price movements | DexScreener, CoinGecko, Pump.fun, GMGN |
| **News Hawk** | Detects news catalysts (listings, partnerships, hacks) | RSS feeds |
| **Sentiment Analyst** | Analyzes community sentiment shifts and Fear & Greed Index | CoinGecko trending, Alternative.me |
| **Telegram Scout** | Monitors crypto Telegram channels for alpha signals | Telegram channels (no bot token needed) |
| **Reddit Scout** | Scans crypto subreddits for trending tokens and discussions | Reddit JSON API |
| **X Scout** | Tracks crypto influencer tweets for whale alerts and calls | Twitter Syndication API (no API key needed) |
| **Judge** | Orchestrates LLM debate, scores opportunities, publishes calls | Anthropic API (Claude) or local LLM (LM Studio) |

### The Debate

The debate is visible on the `alphaswarm-debate` Intercom sidechannel. Each cycle:

1. All 6 scanner agents detect signals and broadcast them to the debate channel
2. The Judge collects signals and groups them by token
3. Tokens are prioritized: lowcap gems first, large caps deprioritized (focus on high-multiplier opportunities)
4. The Judge asks each agent persona (via LLM) for their verdict in a multi-round debate
5. After 2 rounds of debate, the Judge synthesizes a final verdict with a conviction score (1-10)
6. **Degen mode:** Lowcaps published if score >= 5 (with risk tier disclaimer) | Large caps (market cap > $100M) only if score >= 9
7. Published calls go to the public channel `0000alphaswarm` + optional Telegram/X relay
8. **Radar watchlist:** Microcap tokens (confirmed MC < $1M) that score below threshold are published as "ALPHASWARM RADAR" on Telegram with DYOR disclaimer — potential dip entries to watch

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
| `agents.llm_provider` | Optional | `"anthropic"` (default) or `"local"` for LM Studio |
| `agents.llm_base_url` | Optional | API base URL (`https://api.anthropic.com` or `http://localhost:1234` for LM Studio) |
| `agents.llm_api_key` | Optional | Anthropic API key (or `"lm-studio"` for local) — without it, uses heuristic scoring |
| `agents.llm_model` | Optional | Model name (e.g. `claude-sonnet-4-20250514` or `qwen/qwen3-8b`) |
| `telegram.bot_token` | Optional | Telegram bot token from @BotFather |
| `telegram.channel_id` | Optional | Telegram channel to post calls |
| `twitter.app_key` | Optional | X/Twitter app key from [developer.x.com](https://developer.x.com) |
| `twitter.app_secret` | Optional | X/Twitter app secret |
| `twitter.access_token` | Optional | X/Twitter access token |
| `twitter.access_secret` | Optional | X/Twitter access secret |

The system works without any API keys (using DexScreener + CoinGecko free APIs + heuristic scoring). Adding an LLM (Anthropic API or local via LM Studio) enables the full multi-round debate experience.

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
│   ├── telegram-agent.js       # Telegram channel scanner
│   ├── reddit-agent.js         # Reddit subreddit scanner
│   ├── twitter-scan-agent.js   # X/Twitter influencer scanner
│   └── judge-agent.js          # Debate orchestrator + publisher
├── sources/
│   ├── dexscreener.js          # DexScreener API client
│   ├── coingecko.js            # CoinGecko API client
│   ├── pumpfun.js              # Pump.fun new launches client
│   ├── gmgn.js                 # GMGN trending tokens client
│   ├── rss.js                  # RSS feed parser
│   ├── fear-greed.js           # Fear & Greed Index client
│   ├── telegram-channels.js    # Telegram channel scraper
│   ├── reddit.js               # Reddit JSON API client
│   └── twitter-scanner.js      # Twitter Syndication API client
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
- More data sources (LunarCrush, on-chain whale wallets)
- Call performance tracking (win rate, avg ROI)
- On-chain reputation scoring via Trac contract
- Historical call database with backtesting

---

## License

Based on the Intercom reference implementation by Trac Systems.
