/** @typedef {import('pear-interface')} */

// Polyfill global fetch for Bare runtime (must be before any module that uses fetch)
import bareFetch from 'bare-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = bareFetch;
  globalThis.Request = bareFetch.Request;
  globalThis.Response = bareFetch.Response;
  globalThis.Headers = bareFetch.Headers;
}

import fs from 'fs';
import path from 'path';
import b4a from 'b4a';
import PeerWallet from 'trac-wallet';
import { Peer, Wallet, createConfig as createPeerConfig, ENV as PEER_ENV } from 'trac-peer';
import { MainSettlementBus } from 'trac-msb/src/index.js';
import { createConfig as createMsbConfig, ENV as MSB_ENV } from 'trac-msb/src/config/env.js';
import { ensureTextCodecs } from 'trac-peer/src/textCodec.js';
import { getPearRuntime, ensureTrailingSlash } from 'trac-peer/src/runnerArgs.js';
import { Terminal } from 'trac-peer/src/terminal/index.js';
import SampleProtocol from './contract/protocol.js';
import SampleContract from './contract/contract.js';
import { Timer } from './features/timer/index.js';
import Sidechannel from './features/sidechannel/index.js';
import ScBridge from './features/sc-bridge/index.js';
import { OnChainAgent } from './agents/onchain-agent.js';
import { NewsAgent } from './agents/news-agent.js';
import { SentimentAgent } from './agents/sentiment-agent.js';
import { JudgeAgent } from './agents/judge-agent.js';
import { TelegramAgent } from './agents/telegram-agent.js';
import { RedditAgent } from './agents/reddit-agent.js';
import { TwitterScanAgent } from './agents/twitter-scan-agent.js';
import { Scanner } from './features/scanner/index.js';
import { TelegramRelay } from './relay/telegram-bot.js';
import { TwitterRelay } from './relay/twitter-bot.js';

const { env, storeLabel, flags } = getPearRuntime();

const peerStoreNameRaw =
  (flags['peer-store-name'] && String(flags['peer-store-name'])) ||
  env.PEER_STORE_NAME ||
  storeLabel ||
  'peer';

const peerStoresDirectory = ensureTrailingSlash(
  (flags['peer-stores-directory'] && String(flags['peer-stores-directory'])) ||
    env.PEER_STORES_DIRECTORY ||
    'stores/'
);

const msbStoreName =
  (flags['msb-store-name'] && String(flags['msb-store-name'])) ||
  env.MSB_STORE_NAME ||
  `${peerStoreNameRaw}-msb`;

const msbStoresDirectory = ensureTrailingSlash(
  (flags['msb-stores-directory'] && String(flags['msb-stores-directory'])) ||
    env.MSB_STORES_DIRECTORY ||
    'stores/'
);

const subnetChannel =
  (flags['subnet-channel'] && String(flags['subnet-channel'])) ||
  env.SUBNET_CHANNEL ||
  'trac-peer-subnet';

const sidechannelsRaw =
  (flags['sidechannels'] && String(flags['sidechannels'])) ||
  (flags['sidechannel'] && String(flags['sidechannel'])) ||
  env.SIDECHANNELS ||
  '';

const parseBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseKeyValueList = (raw) => {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const idx = entry.indexOf(':');
      const alt = entry.indexOf('=');
      const splitAt = idx >= 0 ? idx : alt;
      if (splitAt <= 0) return null;
      const key = entry.slice(0, splitAt).trim();
      const value = entry.slice(splitAt + 1).trim();
      if (!key || !value) return null;
      return [key, value];
    })
    .filter(Boolean);
};

const parseWelcomeValue = (raw) => {
  if (!raw) return null;
  let text = String(raw || '').trim();
  if (!text) return null;
  if (text.startsWith('@')) {
    try {
      const filePath = path.resolve(text.slice(1));
      text = String(fs.readFileSync(filePath, 'utf8') || '').trim();
      if (!text) return null;
    } catch (_e) {
      return null;
    }
  }
  if (text.startsWith('b64:')) text = text.slice(4);
  if (text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch (_e) {
      return null;
    }
  }
  try {
    const decoded = b4a.toString(b4a.from(text, 'base64'));
    return JSON.parse(decoded);
  } catch (_e) {}
  return null;
};

const sidechannelDebugRaw =
  (flags['sidechannel-debug'] && String(flags['sidechannel-debug'])) ||
  env.SIDECHANNEL_DEBUG ||
  '';
const sidechannelDebug = parseBool(sidechannelDebugRaw, false);
const sidechannelQuietRaw =
  (flags['sidechannel-quiet'] && String(flags['sidechannel-quiet'])) ||
  env.SIDECHANNEL_QUIET ||
  '';
const sidechannelQuiet = parseBool(sidechannelQuietRaw, false);
const sidechannelMaxBytesRaw =
  (flags['sidechannel-max-bytes'] && String(flags['sidechannel-max-bytes'])) ||
  env.SIDECHANNEL_MAX_BYTES ||
  '';
const sidechannelMaxBytes = Number.parseInt(sidechannelMaxBytesRaw, 10);
const sidechannelAllowRemoteOpenRaw =
  (flags['sidechannel-allow-remote-open'] && String(flags['sidechannel-allow-remote-open'])) ||
  env.SIDECHANNEL_ALLOW_REMOTE_OPEN ||
  '';
const sidechannelAllowRemoteOpen = parseBool(sidechannelAllowRemoteOpenRaw, true);
const sidechannelAutoJoinRaw =
  (flags['sidechannel-auto-join'] && String(flags['sidechannel-auto-join'])) ||
  env.SIDECHANNEL_AUTO_JOIN ||
  '';
const sidechannelAutoJoin = parseBool(sidechannelAutoJoinRaw, false);
const sidechannelPowRaw =
  (flags['sidechannel-pow'] && String(flags['sidechannel-pow'])) ||
  env.SIDECHANNEL_POW ||
  '';
const sidechannelPowEnabled = parseBool(sidechannelPowRaw, true);
const sidechannelPowDifficultyRaw =
  (flags['sidechannel-pow-difficulty'] && String(flags['sidechannel-pow-difficulty'])) ||
  env.SIDECHANNEL_POW_DIFFICULTY ||
  '12';
const sidechannelPowDifficulty = Number.parseInt(sidechannelPowDifficultyRaw, 10);
const sidechannelPowEntryRaw =
  (flags['sidechannel-pow-entry'] && String(flags['sidechannel-pow-entry'])) ||
  env.SIDECHANNEL_POW_ENTRY ||
  '';
const sidechannelPowRequireEntry = parseBool(sidechannelPowEntryRaw, false);
const sidechannelPowChannelsRaw =
  (flags['sidechannel-pow-channels'] && String(flags['sidechannel-pow-channels'])) ||
  env.SIDECHANNEL_POW_CHANNELS ||
  '';
const sidechannelPowChannels = sidechannelPowChannelsRaw
  ? sidechannelPowChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelInviteRequiredRaw =
  (flags['sidechannel-invite-required'] && String(flags['sidechannel-invite-required'])) ||
  env.SIDECHANNEL_INVITE_REQUIRED ||
  '';
const sidechannelInviteRequired = parseBool(sidechannelInviteRequiredRaw, false);
const sidechannelInviteChannelsRaw =
  (flags['sidechannel-invite-channels'] && String(flags['sidechannel-invite-channels'])) ||
  env.SIDECHANNEL_INVITE_CHANNELS ||
  '';
const sidechannelInviteChannels = sidechannelInviteChannelsRaw
  ? sidechannelInviteChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelInviterKeysRaw =
  (flags['sidechannel-inviter-keys'] && String(flags['sidechannel-inviter-keys'])) ||
  env.SIDECHANNEL_INVITER_KEYS ||
  '';
const sidechannelInviterKeys = sidechannelInviterKeysRaw
  ? sidechannelInviterKeysRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : [];
const sidechannelInviteTtlRaw =
  (flags['sidechannel-invite-ttl'] && String(flags['sidechannel-invite-ttl'])) ||
  env.SIDECHANNEL_INVITE_TTL ||
  '604800';
const sidechannelInviteTtlSec = Number.parseInt(sidechannelInviteTtlRaw, 10);
const sidechannelInviteTtlMs = Number.isFinite(sidechannelInviteTtlSec)
  ? Math.max(sidechannelInviteTtlSec, 0) * 1000
  : 0;
const sidechannelOwnerRaw =
  (flags['sidechannel-owner'] && String(flags['sidechannel-owner'])) ||
  env.SIDECHANNEL_OWNER ||
  '';
const sidechannelOwnerEntries = parseKeyValueList(sidechannelOwnerRaw);
const sidechannelOwnerMap = new Map();
for (const [channel, key] of sidechannelOwnerEntries) {
  const normalizedKey = key.trim().toLowerCase();
  if (channel && normalizedKey) sidechannelOwnerMap.set(channel.trim(), normalizedKey);
}
const sidechannelOwnerWriteOnlyRaw =
  (flags['sidechannel-owner-write-only'] && String(flags['sidechannel-owner-write-only'])) ||
  env.SIDECHANNEL_OWNER_WRITE_ONLY ||
  '';
const sidechannelOwnerWriteOnly = parseBool(sidechannelOwnerWriteOnlyRaw, false);
const sidechannelOwnerWriteChannelsRaw =
  (flags['sidechannel-owner-write-channels'] && String(flags['sidechannel-owner-write-channels'])) ||
  env.SIDECHANNEL_OWNER_WRITE_CHANNELS ||
  '';
const sidechannelOwnerWriteChannels = sidechannelOwnerWriteChannelsRaw
  ? sidechannelOwnerWriteChannelsRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const sidechannelWelcomeRaw =
  (flags['sidechannel-welcome'] && String(flags['sidechannel-welcome'])) ||
  env.SIDECHANNEL_WELCOME ||
  '';
const sidechannelWelcomeEntries = parseKeyValueList(sidechannelWelcomeRaw);
const sidechannelWelcomeMap = new Map();
for (const [channel, value] of sidechannelWelcomeEntries) {
  const welcome = parseWelcomeValue(value);
  if (channel && welcome) sidechannelWelcomeMap.set(channel.trim(), welcome);
}
const sidechannelWelcomeRequiredRaw =
  (flags['sidechannel-welcome-required'] && String(flags['sidechannel-welcome-required'])) ||
  env.SIDECHANNEL_WELCOME_REQUIRED ||
  '';
const sidechannelWelcomeRequired = parseBool(sidechannelWelcomeRequiredRaw, true);

const sidechannelEntry = '0000intercom';
const sidechannelExtras = sidechannelsRaw
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0 && value !== sidechannelEntry);

// === AlphaSwarm Config ===
let alphaswarmConfig = {};
try {
  if (fs.existsSync('config.json')) {
    alphaswarmConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  }
} catch (err) {
  console.warn('[AlphaSwarm] Could not load config.json, using defaults:', err?.message);
}
const alphaDebateChannel = alphaswarmConfig.alphaswarm?.debate_channel || 'alphaswarm-debate';
const alphaPublicChannel = alphaswarmConfig.alphaswarm?.public_channel || '0000alphaswarm';
const alphaChannels = [alphaDebateChannel, alphaPublicChannel].filter(
  (c) => c !== sidechannelEntry && !sidechannelExtras.includes(c)
);
sidechannelExtras.push(...alphaChannels);

if (sidechannelWelcomeRequired && !sidechannelOwnerMap.has(sidechannelEntry)) {
  console.warn(
    `[sidechannel] welcome required for non-entry channels; entry "${sidechannelEntry}" is open and does not require owner/welcome.`
  );
}

const subnetBootstrapHex =
  (flags['subnet-bootstrap'] && String(flags['subnet-bootstrap'])) ||
  env.SUBNET_BOOTSTRAP ||
  null;

const scBridgeEnabledRaw =
  (flags['sc-bridge'] && String(flags['sc-bridge'])) ||
  env.SC_BRIDGE ||
  '';
const scBridgeEnabled = parseBool(scBridgeEnabledRaw, false);
const scBridgeHost =
  (flags['sc-bridge-host'] && String(flags['sc-bridge-host'])) ||
  env.SC_BRIDGE_HOST ||
  '127.0.0.1';
const scBridgePortRaw =
  (flags['sc-bridge-port'] && String(flags['sc-bridge-port'])) ||
  env.SC_BRIDGE_PORT ||
  '';
const scBridgePort = Number.parseInt(scBridgePortRaw, 10);
const scBridgeFilter =
  (flags['sc-bridge-filter'] && String(flags['sc-bridge-filter'])) ||
  env.SC_BRIDGE_FILTER ||
  '';
const scBridgeFilterChannelRaw =
  (flags['sc-bridge-filter-channel'] && String(flags['sc-bridge-filter-channel'])) ||
  env.SC_BRIDGE_FILTER_CHANNEL ||
  '';
const scBridgeFilterChannels = scBridgeFilterChannelRaw
  ? scBridgeFilterChannelRaw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : null;
const scBridgeToken =
  (flags['sc-bridge-token'] && String(flags['sc-bridge-token'])) ||
  env.SC_BRIDGE_TOKEN ||
  '';
const scBridgeCliRaw =
  (flags['sc-bridge-cli'] && String(flags['sc-bridge-cli'])) ||
  env.SC_BRIDGE_CLI ||
  '';
const scBridgeCliEnabled = parseBool(scBridgeCliRaw, false);
const scBridgeDebugRaw =
  (flags['sc-bridge-debug'] && String(flags['sc-bridge-debug'])) ||
  env.SC_BRIDGE_DEBUG ||
  '';
const scBridgeDebug = parseBool(scBridgeDebugRaw, false);

if (scBridgeEnabled && !scBridgeToken) {
  throw new Error('SC-Bridge requires --sc-bridge-token (auth is mandatory).');
}

const readHexFile = (filePath, byteLength) => {
  try {
    if (fs.existsSync(filePath)) {
      const hex = fs.readFileSync(filePath, 'utf8').trim().toLowerCase();
      if (/^[0-9a-f]+$/.test(hex) && hex.length === byteLength * 2) return hex;
    }
  } catch (_e) {}
  return null;
};

const subnetBootstrapFile = path.join(
  peerStoresDirectory,
  peerStoreNameRaw,
  'subnet-bootstrap.hex'
);

let subnetBootstrap = subnetBootstrapHex ? subnetBootstrapHex.trim().toLowerCase() : null;
if (subnetBootstrap) {
  if (!/^[0-9a-f]{64}$/.test(subnetBootstrap)) {
    throw new Error('Invalid --subnet-bootstrap. Provide 32-byte hex (64 chars).');
  }
} else {
  subnetBootstrap = readHexFile(subnetBootstrapFile, 32);
}

const msbConfig = createMsbConfig(MSB_ENV.MAINNET, {
  storeName: msbStoreName,
  storesDirectory: msbStoresDirectory,
  enableInteractiveMode: false,
});

const msbBootstrapHex = b4a.toString(msbConfig.bootstrap, 'hex');
if (subnetBootstrap && subnetBootstrap === msbBootstrapHex) {
  throw new Error('Subnet bootstrap cannot equal MSB bootstrap.');
}

const peerConfig = createPeerConfig(PEER_ENV.MAINNET, {
  storesDirectory: peerStoresDirectory,
  storeName: peerStoreNameRaw,
  bootstrap: subnetBootstrap || null,
  channel: subnetChannel,
  enableInteractiveMode: true,
  enableBackgroundTasks: true,
  enableUpdater: true,
  replicate: true,
});

const ensureKeypairFile = async (keyPairPath) => {
  if (fs.existsSync(keyPairPath)) return;
  fs.mkdirSync(path.dirname(keyPairPath), { recursive: true });
  await ensureTextCodecs();
  const wallet = new PeerWallet();
  await wallet.ready;
  if (!wallet.secretKey) {
    await wallet.generateKeyPair();
  }
  wallet.exportToFile(keyPairPath, b4a.alloc(0));
};

await ensureKeypairFile(msbConfig.keyPairPath);
await ensureKeypairFile(peerConfig.keyPairPath);

console.log('=============== STARTING MSB ===============');
const msb = new MainSettlementBus(msbConfig);
await msb.ready();

console.log('=============== STARTING PEER ===============');
const peer = new Peer({
  config: peerConfig,
  msb,
  wallet: new Wallet(),
  protocol: SampleProtocol,
  contract: SampleContract,
});
await peer.ready();

const effectiveSubnetBootstrapHex = peer.base?.key
  ? peer.base.key.toString('hex')
  : b4a.isBuffer(peer.config.bootstrap)
      ? peer.config.bootstrap.toString('hex')
      : String(peer.config.bootstrap ?? '').toLowerCase();

if (!subnetBootstrap) {
  fs.mkdirSync(path.dirname(subnetBootstrapFile), { recursive: true });
  fs.writeFileSync(subnetBootstrapFile, `${effectiveSubnetBootstrapHex}\n`);
}

console.log('');
console.log('====================INTERCOM ====================');
const msbChannel = b4a.toString(msbConfig.channel, 'utf8');
const msbStorePath = path.join(msbStoresDirectory, msbStoreName);
const peerStorePath = path.join(peerStoresDirectory, peerStoreNameRaw);
const peerWriterKey = peer.writerLocalKey ?? peer.base?.local?.key?.toString('hex') ?? null;
console.log('MSB network bootstrap:', msbBootstrapHex);
console.log('MSB channel:', msbChannel);
console.log('MSB store:', msbStorePath);
console.log('Peer store:', peerStorePath);
console.log('Peer subnet bootstrap:', effectiveSubnetBootstrapHex);
console.log('Peer subnet channel:', subnetChannel);
console.log('Peer pubkey (hex):', peer.wallet.publicKey);
console.log('Peer trac address (bech32m):', peer.wallet.address ?? null);
console.log('Peer writer key (hex):', peerWriterKey);
console.log('Sidechannel entry:', sidechannelEntry);
if (sidechannelExtras.length > 0) {
  console.log('Sidechannel extras:', sidechannelExtras.join(', '));
}
if (scBridgeEnabled) {
  const portDisplay = Number.isSafeInteger(scBridgePort) ? scBridgePort : 49222;
  console.log('SC-Bridge:', `ws://${scBridgeHost}:${portDisplay}`);
}
console.log('================================================================');
console.log('');

const admin = await peer.base.view.get('admin');
if (admin && admin.value === peer.wallet.publicKey && peer.base.writable) {
  const timer = new Timer(peer, { update_interval: 60_000 });
  await peer.protocol.instance.addFeature('timer', timer);
  timer.start().catch((err) => console.error('Timer feature stopped:', err?.message ?? err));
}

let scBridge = null;
if (scBridgeEnabled) {
  scBridge = new ScBridge(peer, {
    host: scBridgeHost,
    port: Number.isSafeInteger(scBridgePort) ? scBridgePort : 49222,
    filter: scBridgeFilter,
    filterChannels: scBridgeFilterChannels || undefined,
    token: scBridgeToken,
    debug: scBridgeDebug,
    cliEnabled: scBridgeCliEnabled,
    requireAuth: true,
    info: {
      msbBootstrap: msbBootstrapHex,
      msbChannel,
      msbStore: msbStorePath,
      peerStore: peerStorePath,
      subnetBootstrap: effectiveSubnetBootstrapHex,
      subnetChannel,
      peerPubkey: peer.wallet.publicKey,
      peerTracAddress: peer.wallet.address ?? null,
      peerWriterKey,
      sidechannelEntry,
      sidechannelExtras: sidechannelExtras.slice(),
    },
  });
}

const sidechannel = new Sidechannel(peer, {
  channels: [sidechannelEntry, ...sidechannelExtras],
  debug: sidechannelDebug,
  maxMessageBytes: Number.isSafeInteger(sidechannelMaxBytes) ? sidechannelMaxBytes : undefined,
  entryChannel: sidechannelEntry,
  allowRemoteOpen: sidechannelAllowRemoteOpen,
  autoJoinOnOpen: sidechannelAutoJoin,
  powEnabled: sidechannelPowEnabled,
  powDifficulty: Number.isInteger(sidechannelPowDifficulty) ? sidechannelPowDifficulty : undefined,
  powRequireEntry: sidechannelPowRequireEntry,
  powRequiredChannels: sidechannelPowChannels || undefined,
  inviteRequired: sidechannelInviteRequired,
  inviteRequiredChannels: sidechannelInviteChannels || undefined,
  inviterKeys: sidechannelInviterKeys,
  inviteTtlMs: sidechannelInviteTtlMs,
  welcomeRequired: sidechannelWelcomeRequired,
  ownerWriteOnly: sidechannelOwnerWriteOnly,
  ownerWriteChannels: sidechannelOwnerWriteChannels || undefined,
  ownerKeys: sidechannelOwnerMap.size > 0 ? sidechannelOwnerMap : undefined,
  welcomeByChannel: sidechannelWelcomeMap.size > 0 ? sidechannelWelcomeMap : undefined,
  onMessage: (channel, payload, connection) => {
    // SC-Bridge forwarding
    if (scBridgeEnabled) {
      scBridge.handleSidechannelMessage(channel, payload, connection);
    }
    // AlphaSwarm message routing
    if (channel === alphaDebateChannel || channel === alphaPublicChannel) {
      try {
        const raw = typeof payload === 'string' ? payload
          : typeof payload?.message === 'string' ? payload.message
          : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.type === 'signal' && globalThis._alphaswarmJudge) {
            globalThis._alphaswarmJudge.signalBuffer.push({
              agent: parsed.agent,
              role: parsed.role,
              data: parsed.data,
            });
          }
        }
      } catch (_e) {}
    }
    // Console logging (unless quiet or bridge-only)
    if (!sidechannelQuiet && !scBridgeEnabled) {
      const display = payload?.message || (typeof payload === 'string' ? payload : JSON.stringify(payload));
      console.log(`[SC:${channel}]`, typeof display === 'string' ? display.slice(0, 200) : display);
    }
  },
});
peer.sidechannel = sidechannel;

if (scBridge) {
  scBridge.attachSidechannel(sidechannel);
  try {
    scBridge.start();
  } catch (err) {
    console.error('SC-Bridge failed to start:', err?.message ?? err);
  }
  peer.scBridge = scBridge;
}

sidechannel
  .start()
  .then(() => {
    console.log('Sidechannel: ready');

    // === AlphaSwarm Agent Initialization ===
    console.log('');
    console.log('=============== STARTING ALPHASWARM ===============');

    const onchainAgent = new OnChainAgent(peer, alphaswarmConfig);
    const newsAgent = new NewsAgent(peer, alphaswarmConfig);
    const judgeAgent = new JudgeAgent(peer, alphaswarmConfig);
    const scannerAgents = [onchainAgent, newsAgent];

    // Add sentiment agent if CryptoPanic API key is configured
    if (alphaswarmConfig.sources?.cryptopanic?.api_key) {
      const sentimentAgent = new SentimentAgent(peer, alphaswarmConfig);
      scannerAgents.push(sentimentAgent);
      console.log('[AlphaSwarm] Sentiment agent enabled');
    }

    // Add Telegram channel scanner if configured
    if (alphaswarmConfig.sources?.telegram_channels?.enabled) {
      const telegramAgent = new TelegramAgent(peer, alphaswarmConfig);
      scannerAgents.push(telegramAgent);
      console.log('[AlphaSwarm] Telegram channel scanner enabled');
    }

    // Add Reddit scanner if configured
    if (alphaswarmConfig.sources?.reddit?.enabled !== false) {
      const redditAgent = new RedditAgent(peer, alphaswarmConfig);
      scannerAgents.push(redditAgent);
      console.log('[AlphaSwarm] Reddit scanner enabled');
    }

    // Add X/Twitter scanner if configured
    if (alphaswarmConfig.sources?.twitter_scanner?.enabled) {
      const xScoutAgent = new TwitterScanAgent(peer, alphaswarmConfig);
      scannerAgents.push(xScoutAgent);
      console.log('[AlphaSwarm] X/Twitter scanner enabled');
    }

    // Register agents with Judge
    judgeAgent.registerAgents(scannerAgents);
    globalThis._alphaswarmJudge = judgeAgent;

    // Telegram relay
    const telegramRelay = new TelegramRelay(alphaswarmConfig);
    telegramRelay.start();
    telegramRelay.attachToJudge(judgeAgent);

    // Twitter/X relay
    const twitterRelay = new TwitterRelay(alphaswarmConfig);
    twitterRelay.start();
    twitterRelay.attachToJudge(judgeAgent);

    // Store scanner reference on peer for protocol commands
    const scanner = new Scanner(peer, { agents: scannerAgents, judgeAgent });
    peer.alphaswarm = { scanner, judgeAgent, agents: scannerAgents, telegramRelay, twitterRelay };

    scanner.start().catch((err) => {
      console.error('[AlphaSwarm] Scanner stopped:', err?.message ?? err);
    });

    console.log(`[AlphaSwarm] Debate channel: ${alphaDebateChannel}`);
    console.log(`[AlphaSwarm] Public channel: ${alphaPublicChannel}`);
    console.log(`[AlphaSwarm] Agents: ${scannerAgents.map((a) => a.name).join(', ')}`);
    console.log(`[AlphaSwarm] Publish threshold: ${alphaswarmConfig.alphaswarm?.publish_threshold || 7}/10`);
    console.log(`[AlphaSwarm] LLM: ${alphaswarmConfig.agents?.llm_api_key ? 'configured' : 'not configured (heuristic mode)'}`);
    console.log(`[AlphaSwarm] Telegram: ${telegramRelay.enabled ? 'enabled' : 'disabled'}`);
    console.log(`[AlphaSwarm] Twitter/X: ${twitterRelay.enabled ? 'enabled' : 'disabled'}`);
    console.log('====================================================');
    console.log('');
  })
  .catch((err) => {
    console.error('Sidechannel failed to start:', err?.message ?? err);
  });

const terminal = new Terminal(peer);
await terminal.start();
