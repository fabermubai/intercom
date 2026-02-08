# PRD — AlphaSwarm

## Product Requirement Document pour Claude Code

**Projet :** AlphaSwarm — Essaim d'agents IA autonomes qui chassent les meilleures opportunités crypto en temps réel, débattent entre eux sur Intercom, et publient leurs alpha calls sur un canal public + Telegram.

**Deadline :** 12 février 2026 à 00:00 UTC (Intercom Vibe Competition)

**Stack :** JavaScript (Node.js), Pear Runtime, Intercom (Trac Network)

---

## LIENS DE RÉFÉRENCE (À CONSULTER EN PREMIER)

| Ressource | URL |
|-----------|-----|
| **Tweet officiel de la compétition** | https://x.com/TracNetwork/status/2019059255521821152 |
| **Repo de la compétition (règles)** | https://github.com/Trac-Systems/intercom-competition |
| **Repo Intercom (à cloner comme base)** | https://github.com/Trac-Systems/intercom |
| **SKILL.md Intercom** | https://github.com/Trac-Systems/intercom/blob/main/SKILL.md |
| **Trac Contract Example** | https://github.com/Trac-Systems/trac-contract-example |
| **Moltbook (poster l'annonce)** | https://www.moltbook.com |

---

## 1. CONTEXTE

### 1.1 Qu'est-ce qu'Intercom (Trac Network)

Intercom est un protocole P2P de coordination entre agents, construit sur Trac Network. Il utilise le **Pear Runtime** (Holepunch) pour la communication pair-à-pair. L'architecture repose sur :

- Des **sidechannels** (canaux de messagerie P2P rapides et éphémères)
- Un **contrat + protocole** pour l'état déterministe et le chat
- Un canal de rendez-vous global `0000intercom` pour la découverte entre agents

Repo de référence : https://github.com/Trac-Systems/intercom
SKILL.md de référence : https://github.com/Trac-Systems/intercom/blob/main/SKILL.md
Repo de compétition : https://github.com/Trac-Systems/intercom-competition

### 1.2 Règles de la compétition

1. Cloner Intercom et construire une app dessus
2. Poster l'app sur Moltbook (general) avec lien vers le clone ET le repo Intercom principal
3. Ajouter une adresse Trac dans le README pour les paiements
4. Mettre à jour le SKILL.md du clone pour que d'autres agents puissent l'exécuter
5. Fournir une preuve que l'app fonctionne (screenshot, terminal output, vidéo)
6. Soumettre via Issue ou PR sur le repo de compétition

**Récompense :** 500 TNK par app éligible + bonus potentiel pour les meilleures apps.

### 1.3 Ce que fait AlphaSwarm

AlphaSwarm est un **essaim d'agents IA spécialisés** qui :

1. **Scannent** en continu des sources de données crypto (DexScreener, CryptoPanic, CoinGecko, Telegram)
2. **Débattent** entre eux sur un canal Intercom privé pour évaluer la qualité des opportunités
3. **Publient** les meilleurs alpha calls sur un canal Intercom public (`0000alphaswarm`)
4. **Relayent** les calls vers un bot Telegram pour une diffusion large

C'est un "KOL collectif" — un groupe d'agents qui simule un panel d'analystes crypto débattant pour identifier les meilleures opportunités.

---

## 2. ARCHITECTURE

### 2.1 Vue d'ensemble

```
                    ┌─────────────────────────────────────────────────┐
                    │            SOURCES DE DONNÉES (APIs)            │
                    │                                                 │
                    │  DexScreener   CryptoPanic   CoinGecko   RSS   │
                    │  (volumes,     (news,        (prix,      feeds  │
                    │   new tokens)  sentiment)    trending)          │
                    └────────┬──────────┬──────────┬──────────┬──────┘
                             │          │          │          │
                    ┌────────▼──────────▼──────────▼──────────▼──────┐
                    │              AGENTS SPÉCIALISÉS                 │
                    │                                                 │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
                    │  │ Agent    │ │ Agent    │ │ Agent        │   │
                    │  │ OnChain  │ │ News     │ │ Sentiment    │   │
                    │  │          │ │          │ │              │   │
                    │  │ Volumes, │ │ Crypto   │ │ CryptoPanic  │   │
                    │  │ Nouveaux │ │ Panic,   │ │ votes,       │   │
                    │  │ tokens,  │ │ RSS,     │ │ tendances    │   │
                    │  │ Whales   │ │ breaking │ │ sociales     │   │
                    │  └────┬─────┘ └────┬─────┘ └──────┬──────┘   │
                    │       │            │              │            │
                    └───────┼────────────┼──────────────┼────────────┘
                            │            │              │
                    ┌───────▼────────────▼──────────────▼────────────┐
                    │         CANAL INTERCOM PRIVÉ (débat)            │
                    │         "alphaswarm-debate"                     │
                    │                                                 │
                    │  Agents échangent signaux, arguments,           │
                    │  contre-arguments. Le débat est visible.        │
                    │                                                 │
                    └──────────────────┬─────────────────────────────┘
                                       │
                    ┌──────────────────▼─────────────────────────────┐
                    │              AGENT JUGE                         │
                    │                                                 │
                    │  - Synthétise les inputs de tous les agents     │
                    │  - Attribue un score de conviction (1-10)       │
                    │  - Rédige un résumé du call avec arguments      │
                    │  - Décide de publier ou non (seuil ≥ 7/10)     │
                    │                                                 │
                    └──────────────────┬─────────────────────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                    ┌─────▼─────┐ ┌───▼────┐ ┌────▼──────┐
                    │ Canal     │ │Telegram│ │ Logs      │
                    │ Intercom  │ │ Bot    │ │ on-chain  │
                    │ Public    │ │ Relay  │ │ (optionnel│
                    │0000alpha  │ │        │ │  via TNK) │
                    │  swarm    │ │        │ │           │
                    └───────────┘ └────────┘ └───────────┘
```

### 2.2 Structure des fichiers

Le projet DOIT cloner le repo Intercom comme base et ajouter la logique AlphaSwarm par-dessus.

```
alphaswarm/                          # Clone de https://github.com/Trac-Systems/intercom
├── index.js                         # Point d'entrée — démarre le peer Intercom + tous les agents
├── package.json                     # Dépendances (hérite d'Intercom + ajouts)
├── config.json                      # Configuration utilisateur (clés API, seuils, etc.)
├── config.example.json              # Exemple de configuration
├── README.md                        # Documentation complète + infos compétition
├── SKILL.md                         # Skill file pour agents (format compétition)
│
├── contract/
│   ├── protocol.js                  # Protocole Intercom (hérité + extensions AlphaSwarm)
│   └── contract.js                  # Contrat (hérité + logs de réputation optionnels)
│
├── agents/
│   ├── base-agent.js                # Classe abstraite pour tous les agents
│   ├── onchain-agent.js             # Agent On-Chain (DexScreener, GeckoTerminal)
│   ├── news-agent.js                # Agent News (CryptoPanic, RSS feeds)
│   ├── sentiment-agent.js           # Agent Sentiment (CryptoPanic votes, tendances)
│   └── judge-agent.js               # Agent Juge (synthèse, scoring, publication)
│
├── sources/
│   ├── dexscreener.js               # Client API DexScreener
│   ├── cryptopanic.js               # Client API CryptoPanic
│   ├── coingecko.js                 # Client API CoinGecko
│   └── rss.js                       # Parser RSS pour news crypto
│
├── relay/
│   └── telegram-bot.js              # Bot Telegram qui relaie les calls
│
├── utils/
│   ├── logger.js                    # Logging formaté
│   ├── formatter.js                 # Formatage des messages (Intercom + Telegram)
│   └── scoring.js                   # Système de scoring des opportunités
│
└── features/                        # Features Intercom (oracles, timers)
    └── scanner/
        └── index.js                 # Feature de scan périodique
```

---

## 3. SPÉCIFICATIONS DÉTAILLÉES

### 3.1 Configuration (config.json)

```json
{
  "alphaswarm": {
    "public_channel": "0000alphaswarm",
    "debate_channel": "alphaswarm-debate",
    "scan_interval_seconds": 60,
    "publish_threshold": 7,
    "max_calls_per_hour": 10,
    "language": "en"
  },
  "sources": {
    "dexscreener": {
      "enabled": true,
      "chains": ["solana", "ethereum", "base"],
      "min_volume_usd": 50000,
      "min_liquidity_usd": 10000,
      "max_age_hours": 24
    },
    "cryptopanic": {
      "enabled": true,
      "api_key": "YOUR_CRYPTOPANIC_API_KEY",
      "categories": ["news", "media"],
      "min_votes": 3
    },
    "coingecko": {
      "enabled": true,
      "watch_trending": true,
      "watch_gainers": true
    },
    "rss": {
      "enabled": true,
      "feeds": [
        "https://cointelegraph.com/rss",
        "https://theblock.co/rss.xml",
        "https://decrypt.co/feed"
      ]
    }
  },
  "agents": {
    "llm_provider": "anthropic",
    "llm_api_key": "YOUR_ANTHROPIC_API_KEY",
    "llm_model": "claude-sonnet-4-20250514",
    "debate_rounds": 2,
    "agent_temperature": 0.7
  },
  "telegram": {
    "enabled": true,
    "bot_token": "YOUR_TELEGRAM_BOT_TOKEN",
    "channel_id": "@alphaswarm_calls"
  }
}
```

### 3.2 Agents

#### 3.2.1 Base Agent (base-agent.js)

Classe abstraite dont tous les agents héritent.

```javascript
class BaseAgent {
  constructor(name, role, peer) {
    this.name = name;       // Ex: "OnChain Scout"
    this.role = role;       // Ex: "onchain"
    this.peer = peer;       // Référence au peer Intercom
  }

  // Méthode appelée à chaque cycle de scan
  async scan() { throw new Error('Not implemented'); }

  // Envoie un signal au canal de débat
  async submitSignal(signal) { /* envoie sur le debate channel */ }

  // Participe au débat (répond aux signaux des autres)
  async debate(signals) { throw new Error('Not implemented'); }
}
```

#### 3.2.2 Agent OnChain (onchain-agent.js)

**Rôle :** Surveille les données on-chain pour détecter les mouvements significatifs.

**Sources :** DexScreener API, CoinGecko API

**Ce qu'il détecte :**
- Tokens avec une explosion de volume soudaine (>300% sur 1h)
- Nouvelles paires de trading avec liquidité significative
- Tokens trending sur DexScreener/CoinGecko
- Mouvements de prix anormaux (>20% en 1h)

**Format de signal :**
```json
{
  "agent": "OnChain Scout",
  "type": "volume_spike",
  "token": {
    "name": "TOKEN",
    "symbol": "TKN",
    "chain": "solana",
    "address": "0x...",
    "price_usd": 0.045,
    "volume_24h": 2500000,
    "volume_change_1h": 450,
    "liquidity_usd": 150000,
    "age_hours": 6
  },
  "signal_strength": 8,
  "reasoning": "Volume multiplié par 4.5x en 1h avec liquidité solide. Nouveaux holders en augmentation.",
  "risks": ["Token très jeune (6h)", "Top holder détient 15%"],
  "timestamp": "2026-02-10T14:32:00Z"
}
```

#### 3.2.3 Agent News (news-agent.js)

**Rôle :** Surveille les actualités crypto pour détecter les catalyseurs de prix.

**Sources :** CryptoPanic API, RSS feeds (CoinTelegraph, The Block, Decrypt)

**Ce qu'il détecte :**
- News à fort impact sur un token/projet spécifique
- Annonces de listings sur des exchanges majeurs
- Partenariats, mises à jour techniques, régulations
- News avec sentiment fortement positif ou négatif

**Format de signal :**
```json
{
  "agent": "News Hawk",
  "type": "breaking_news",
  "token": {
    "name": "Arbitrum",
    "symbol": "ARB",
    "related_tokens": ["ETH"]
  },
  "news": {
    "title": "Arbitrum annonce un programme de grants de 200M$",
    "source": "CoinTelegraph",
    "url": "https://...",
    "sentiment": "bullish",
    "cryptopanic_votes": { "positive": 45, "negative": 2 }
  },
  "signal_strength": 7,
  "reasoning": "Programme de grants massif = augmentation de l'activité sur le réseau. Historiquement, ce type d'annonce cause un pump de 15-30%.",
  "risks": ["Might be already priced in", "Execution timeline unclear"],
  "timestamp": "2026-02-10T14:35:00Z"
}
```

#### 3.2.4 Agent Sentiment (sentiment-agent.js)

**Rôle :** Analyse le sentiment du marché et les tendances sociales.

**Sources :** CryptoPanic (votes communautaires), CoinGecko trending, données de marché globales

**Ce qu'il détecte :**
- Tokens avec un sentiment extrêmement positif/négatif
- Changements soudains de sentiment
- Tokens trending sur plusieurs plateformes simultanément
- Divergences entre sentiment et prix (sentiment bullish mais prix en baisse = opportunité potentielle)

**Format de signal :** Même structure que les autres agents, avec `type: "sentiment_shift"`.

#### 3.2.5 Agent Juge (judge-agent.js)

**Rôle :** C'est le cerveau du système. Il ne scanne pas de données, il **synthétise et arbitre**.

**Fonctionnement :**

1. **Collecte** tous les signaux des autres agents sur le canal de débat
2. **Lance un débat** en envoyant les signaux agrégés avec une question : "Faut-il publier un call sur ce token ?"
3. **Chaque agent répond** avec des arguments pour/contre (via appel LLM)
4. **Synthèse finale** : le Juge analyse le débat et produit un verdict

**Le débat est visible sur le canal Intercom** — c'est la fonctionnalité clé qui montre la puissance d'Intercom pour la coordination multi-agents.

**Critères de publication :**
- Score de conviction ≥ 7/10
- Au moins 2 agents sur 3 en accord
- Pas de red flags critiques (rug pull signals, honeypot, etc.)
- Quota horaire non atteint

**Format du call publié :**
```
🚨 ALPHASWARM CALL — Score: 8.5/10

🪙 Token: $XYZ (Solana)
💰 Prix: $0.045
📊 Volume 24h: $2.5M (+450% 1h)
💧 Liquidité: $150K

📰 Catalyseur: Annonce de listing sur Binance
📈 Signal: Volume explosion + news bullish + sentiment très positif

🟢 Arguments POUR:
- Volume multiplié par 4.5x en 1h (OnChain Scout)
- News de listing confirmée par source fiable (News Hawk)
- Sentiment community 95% bullish (Sentiment Analyst)

🔴 Risques:
- Token jeune (6h), potentiel rug
- Top holder détient 15%

⏰ 2026-02-10 14:40 UTC
🤖 Consensus: 3/3 agents bullish
```

### 3.3 Flux de Données (Cycle Complet)

```
1. SCAN (toutes les 60 secondes)
   ├── onchain-agent.scan()  → interroge DexScreener + CoinGecko
   ├── news-agent.scan()     → interroge CryptoPanic + RSS feeds
   └── sentiment-agent.scan()→ interroge CryptoPanic votes + trending

2. SIGNAUX (envoyés sur le canal de débat Intercom)
   ├── Chaque agent envoie ses signaux au debate channel
   └── Format: { agent, type, token, signal_strength, reasoning, risks }

3. AGRÉGATION (par le Judge)
   ├── Collecte les signaux des 60 dernières secondes
   ├── Regroupe par token (si plusieurs agents ont détecté le même)
   └── Filtre les signaux faibles (signal_strength < 5)

4. DÉBAT (sur le canal de débat Intercom — VISIBLE)
   ├── Judge pose la question : "Faut-il call $XYZ ?"
   ├── Chaque agent répond avec arguments (via LLM)
   ├── 2 rounds de débat max
   └── Messages visibles sur Intercom en temps réel

5. VERDICT
   ├── Judge synthétise le débat (via LLM)
   ├── Attribue un score de conviction (1-10)
   └── Si score ≥ 7 → PUBLIER

6. PUBLICATION
   ├── Message formaté sur canal public "0000alphaswarm"
   └── Relay vers bot Telegram
```

### 3.4 Sources de Données — Implémentation

#### DexScreener (sources/dexscreener.js)

```
API Base: https://api.dexscreener.com/latest
Endpoints utilisés:
  - GET /dex/tokens/trending         → Tokens trending
  - GET /dex/pairs/{chainId}/{pairAddress} → Détails d'une paire
  - GET /dex/tokens/{tokenAddress}   → Chercher un token
  - GET /dex/search?q={query}        → Recherche

Pas de clé API requise.
Rate limit: respecter 300 req/min.

Ce qu'on extrait:
  - Nouveaux tokens avec volume élevé
  - Paires avec volume en explosion
  - Prix, liquidité, volume 24h, variations
```

#### CryptoPanic (sources/cryptopanic.js)

```
API Base: https://cryptopanic.com/api/v1
Endpoint: GET /posts/?auth_token={API_KEY}

Paramètres utiles:
  - filter: rising | hot | bullish | bearish | important
  - currencies: BTC,ETH,SOL (filtrer par token)
  - kind: news | media
  - regions: en (anglais)

Clé API gratuite requise (inscription sur cryptopanic.com/developers/api/).

Ce qu'on extrait:
  - Titre, source, URL
  - Votes de la communauté (positive, negative, important, liked, etc.)
  - Tokens associés
  - Sentiment dérivé des votes
```

#### CoinGecko (sources/coingecko.js)

```
API Base: https://api.coingecko.com/api/v3
Endpoints utilisés:
  - GET /search/trending              → Top 7 trending tokens
  - GET /coins/{id}                   → Détails d'un token
  - GET /coins/markets?vs_currency=usd&order=volume_desc → Top volumes

Pas de clé API requise (free tier: 30 calls/min).

Ce qu'on extrait:
  - Tokens trending
  - Variations de prix 1h/24h/7j
  - Market cap, volume
```

#### RSS Feeds (sources/rss.js)

```
Feeds à parser:
  - https://cointelegraph.com/rss
  - https://theblock.co/rss.xml
  - https://decrypt.co/feed

Utiliser un parser RSS (ex: rss-parser npm).
Extraire: titre, description, date, lien.
Filtrer par mots-clés pertinents (listing, partnership, launch, hack, etc.).
```

### 3.5 Débat entre Agents (via LLM)

Le débat est le cœur d'AlphaSwarm. Chaque agent a un **persona** défini.

**Appel LLM pour chaque agent pendant le débat :**

```
System prompt (Agent OnChain Scout):
"Tu es OnChain Scout, un analyste on-chain spécialisé. Tu évalues les tokens
en te basant UNIQUEMENT sur les données on-chain : volume, liquidité, age du
token, distribution des holders, patterns de trading. Tu es sceptique par
nature et tu cherches les red flags (rug pulls, honeypots, wash trading).
Donne ton avis en 2-3 phrases max."

User prompt:
"Voici un signal détecté sur $XYZ:
- Volume 24h: $2.5M (en hausse de 450% sur 1h)
- Liquidité: $150K
- Token age: 6h
- News associée: 'XYZ annonce un listing sur Binance'
- Sentiment CryptoPanic: 95% bullish

Les autres agents pensent:
- News Hawk (7/10): La news de listing est confirmée par une source fiable.
- Sentiment Analyst (8/10): Sentiment extrêmement bullish, divergence haussière.

Ton verdict ? Score de conviction (1-10) et arguments."
```

**Le Juge fait la synthèse finale :**

```
System prompt (Judge):
"Tu es le Juge d'AlphaSwarm. Tu synthétises les arguments de tous les agents
pour produire un verdict final. Tu dois être objectif et peser les arguments
pour ET contre. Tu publies un call SEULEMENT si le consensus est fort (≥7/10).
Produis un JSON avec: score, verdict (call/skip), arguments_pour, risques, resume."
```

### 3.6 Bot Telegram (relay/telegram-bot.js)

**Fonctionnement simple :**
- Écoute le canal Intercom public `0000alphaswarm`
- Quand un call est publié, le formate en message Telegram
- L'envoie sur le canal Telegram configuré

**Commandes Telegram (bonus) :**
- `/status` — Statut des agents (en ligne, dernier scan)
- `/last` — Dernier call publié
- `/stats` — Stats (nombre de calls, taux de réussite)

**Dépendance :** `node-telegram-bot-api` (npm)

---

## 4. IMPLÉMENTATION — INSTRUCTIONS POUR CLAUDE CODE

### 4.1 Étape 0 : Setup du projet

```bash
# 1. Cloner Intercom comme base
git clone https://github.com/Trac-Systems/intercom.git alphaswarm
cd alphaswarm

# 2. Lire le SKILL.md et le README d'Intercom OBLIGATOIREMENT
# Comprendre comment fonctionne : index.js, contract/protocol.js, contract/contract.js

# 3. Installer les dépendances Intercom
npm install -g pear
npm install

# 4. Ajouter les dépendances AlphaSwarm
npm install rss-parser node-telegram-bot-api node-fetch
```

### 4.2 Étape 1 : Comprendre Intercom

**CRITIQUE : Avant d'écrire une seule ligne de code, Claude Code DOIT :**

1. Lire `SKILL.md` du repo Intercom cloné
2. Lire `README.md` du repo Intercom
3. Lire `index.js` pour comprendre comment un peer Intercom est initialisé
4. Lire `contract/protocol.js` pour comprendre le protocole de messaging
5. Lire `contract/contract.js` pour comprendre le contrat
6. Lire le contenu de `features/` pour comprendre les features/oracles

**L'app AlphaSwarm doit s'intégrer dans l'architecture Intercom existante, pas la remplacer.**

### 4.3 Étape 2 : Créer les sources de données

Commencer par les clients API (le plus simple, pas de dépendance Intercom) :

1. `sources/dexscreener.js` — Client DexScreener
2. `sources/cryptopanic.js` — Client CryptoPanic
3. `sources/coingecko.js` — Client CoinGecko
4. `sources/rss.js` — Parser RSS

**Chaque source doit :**
- Avoir une méthode `async fetch()` qui retourne des signaux normalisés
- Gérer les erreurs gracieusement (ne pas crasher si une API est down)
- Respecter les rate limits
- Logger ce qu'elle fait

**Tester chaque source indépendamment avant d'intégrer.**

### 4.4 Étape 3 : Créer les agents

1. `agents/base-agent.js` — Classe abstraite
2. `agents/onchain-agent.js` — Utilise dexscreener.js + coingecko.js
3. `agents/news-agent.js` — Utilise cryptopanic.js + rss.js
4. `agents/sentiment-agent.js` — Utilise cryptopanic.js (votes) + coingecko.js (trending)
5. `agents/judge-agent.js` — Utilise l'API Anthropic pour le débat + synthèse

**Chaque agent scanner doit :**
- Appeler ses sources à chaque cycle
- Détecter les anomalies/opportunités selon ses critères
- Formater un signal structuré (JSON)
- Envoyer le signal sur le canal de débat Intercom

**L'agent Judge doit :**
- Collecter les signaux des autres agents
- Appeler l'API Anthropic pour faire "débattre" les agents
- Produire un verdict avec un score
- Si score ≥ seuil, publier sur le canal public

### 4.5 Étape 4 : Intégrer avec Intercom

**C'est l'étape la plus importante pour la compétition.**

- Modifier `index.js` pour démarrer tous les agents au boot
- Utiliser le protocole Intercom pour que les agents communiquent via les sidechannels
- Les messages de débat doivent être des vrais messages Intercom sur le canal de débat
- Les calls finaux doivent être des vrais messages Intercom sur le canal public
- Un utilisateur qui rejoint `0000alphaswarm` doit voir les calls arriver en temps réel

### 4.6 Étape 5 : Bot Telegram

- Créer `relay/telegram-bot.js`
- L'agent relay écoute le canal public Intercom
- Quand un call est publié, il le formate et l'envoie sur Telegram
- C'est un composant optionnel mais important pour l'UX

### 4.7 Étape 6 : Documentation

- Mettre à jour `README.md` avec :
  - Description d'AlphaSwarm
  - Instructions d'installation et de configuration
  - Adresse Trac pour les paiements
  - Lien Moltbook post
  - Preuves de fonctionnement
- Mettre à jour `SKILL.md` au format compétition
- Ajouter `config.example.json`

---

## 5. CONTRAINTES TECHNIQUES

### 5.1 Pear Runtime

- **TOUJOURS utiliser `pear run . store1`** pour lancer l'app, JAMAIS `node index.js`
- Le Pear Runtime est nécessaire pour le P2P (Holepunch)
- Chaque instance crée son identité (wallet) automatiquement au premier lancement

### 5.2 APIs gratuites

- **DexScreener** : Pas de clé API, 300 req/min max
- **CryptoPanic** : Clé API gratuite requise, tier gratuit suffisant
- **CoinGecko** : Pas de clé API pour le free tier, 30 calls/min
- **RSS** : Pas de limitation
- **Anthropic API** : Clé API requise (payante), utiliser claude-sonnet-4-20250514 pour le bon ratio coût/qualité
- **Telegram Bot API** : Gratuit, créer un bot via @BotFather

### 5.3 Performance

- Scan toutes les 60 secondes (configurable)
- Le débat LLM prend ~5-10 secondes par round
- Ne pas spammer les APIs : mettre en cache les résultats entre les cycles
- Logger proprement (pas de console.log partout, utiliser le logger)

### 5.4 Gestion d'erreurs

- Si une source API est down → continuer avec les autres
- Si l'API LLM est down → ne pas publier de call, attendre
- Si Telegram est down → publier quand même sur Intercom
- Chaque erreur doit être loggée proprement

---

## 6. PRIORITÉS (si temps limité)

### P0 — Minimum pour la compétition (OBLIGATOIRE)
- [ ] Clone Intercom fonctionnel
- [ ] Au moins 2 agents scanners (OnChain + News)
- [ ] Agent Judge qui produit des calls
- [ ] Communication entre agents via Intercom (messages sur sidechannel)
- [ ] Canal public `0000alphaswarm` avec les calls
- [ ] README + SKILL.md + config.example.json complets
- [ ] Preuve de fonctionnement (screenshot terminal)

### P1 — Différenciateurs (IMPORTANT)
- [ ] Agent Sentiment (3ème agent)
- [ ] Débat LLM visible sur le canal de débat
- [ ] Bot Telegram relay

### P2 — Bonus (SI TEMPS)
- [ ] Commandes Telegram (/status, /last, /stats)
- [ ] Logs de réputation on-chain via contrat Trac
- [ ] Historique des calls avec tracking de performance
- [ ] Interface de configuration via commandes Intercom

---

## 7. FORMAT DE SOUMISSION

### Issue/PR sur le repo de compétition :

```
App name: AlphaSwarm
Repo URL: https://github.com/[USERNAME]/alphaswarm
Moltbook post URL: https://www.moltbook.com/post/[POST_ID]
Trac address: trac1[ADRESSE]
Proof link: [screenshot/video/demo]
Short summary: AlphaSwarm is a multi-agent AI system that scans crypto markets
in real-time (DexScreener, CryptoPanic, CoinGecko), debates opportunities via
Intercom sidechannels, and publishes high-conviction alpha calls to a public
channel + Telegram bot. Agents debate like a panel of analysts before publishing.
```

### Post Moltbook :

```
Intercom app submission: AlphaSwarm

Clone: https://github.com/[USERNAME]/alphaswarm
Main repo: https://github.com/Trac-Systems/intercom
Trac address: trac1[ADRESSE]
Proof: [link]
Summary: Multi-agent AI alpha scanner. Agents scan DexScreener, CryptoPanic,
and CoinGecko, debate on Intercom, and publish high-conviction calls.
```
