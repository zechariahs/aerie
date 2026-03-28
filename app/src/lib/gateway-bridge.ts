// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

/**
 * Gateway WebSocket bridge — singleton server-side connection to the OpenClaw Gateway.
 *
 * Architecture:
 *   Next.js API routes (server) ←SSE← Browser clients (N)
 *              ↕ WebSocket
 *     OpenClaw Gateway (:18789)
 *
 * One WebSocket connection is maintained for the entire Next.js process.
 * Incoming Gateway events are transformed into ActivityEvent objects and
 * broadcast to all connected SSE clients via an EventEmitter.
 *
 * SINGLETON NOTE: Next.js bundles each API route separately, so module-level
 * variables are NOT shared across routes. All mutable state is stored on
 * globalThis so every bundle (instrumentation, /api/events, /api/gateway/*)
 * reads and writes the same objects.
 *
 * REQUIRES_GATEWAY — operates in fixture mode when USE_FIXTURES=true,
 * streaming synthetic events every 3s instead of connecting to the Gateway.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import type { ActivityEvent, AgentState, GatewayStatus } from '@/types';

// ---------------------------------------------------------------------------
// RPC types (exported — used by callers of sendRequest)
// ---------------------------------------------------------------------------

export interface GatewayRpcResponse {
  id: string;
  result?: Record<string, unknown>;
  error?: string;
}

type PendingRequest = {
  resolve: (r: GatewayRpcResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// Global singleton state
//
// Stored on globalThis so all Next.js bundle instances share the same objects.
// ---------------------------------------------------------------------------

type BridgeGlobals = {
  activityBus: EventEmitter;
  replayBuffer: ActivityEvent[];
  gatewayStatus: GatewayStatus;
  lastEventAt: number | null;
  agentStates: Map<string, AgentState>;
  ws: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  bridgeStarted: boolean;
  pendingRequests: Map<string, PendingRequest>;
  connectRequestId: string | null;
  fixtureInterval: ReturnType<typeof setInterval> | null;
  fixtureIndex: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __gatewayBridge: BridgeGlobals | undefined;
}

function getG(): BridgeGlobals {
  if (!globalThis.__gatewayBridge) {
    const bus = new EventEmitter();
    bus.setMaxListeners(100);
    globalThis.__gatewayBridge = {
      activityBus: bus,
      replayBuffer: [],
      gatewayStatus: 'disconnected',
      lastEventAt: null,
      agentStates: new Map(),
      ws: null,
      reconnectTimer: null,
      reconnectDelay: 2000,
      bridgeStarted: false,
      pendingRequests: new Map(),
      connectRequestId: null,
      fixtureInterval: null,
      fixtureIndex: 0,
    };
  }
  return globalThis.__gatewayBridge;
}

// ---------------------------------------------------------------------------
// Public read-only accessors (consumed by /api/events, /api/gateway/status)
// ---------------------------------------------------------------------------

/** The shared EventEmitter — SSE routes subscribe to its 'event' events. */
export function getActivityBus(): EventEmitter { return getG().activityBus; }

export function getGatewayStatus(): GatewayStatus { return getG().gatewayStatus; }
export function getLastEventAt(): number | null { return getG().lastEventAt; }
export function getAgentStates(): Map<string, AgentState> { return getG().agentStates; }

const REPLAY_BUFFER_SIZE = 100;

function pushReplay(event: ActivityEvent): void {
  const g = getG();
  g.replayBuffer.push(event);
  if (g.replayBuffer.length > REPLAY_BUFFER_SIZE) g.replayBuffer.shift();
}

export function getReplayBuffer(): ActivityEvent[] {
  return [...getG().replayBuffer];
}

// ---------------------------------------------------------------------------
// Gateway credentials
// ---------------------------------------------------------------------------

function gatewayUrl(): string {
  return process.env['OPENCLAW_GATEWAY_URL'] ?? 'ws://localhost:18789';
}

function gatewayToken(): string {
  return process.env['OPENCLAW_GATEWAY_TOKEN'] ?? '';
}

// ---------------------------------------------------------------------------
// Fixture streaming (dev mode)
// ---------------------------------------------------------------------------

function startFixtureStream(): void {
  const g = getG();
  if (g.fixtureInterval) return;

  const fixturePath = path.join(process.cwd(), 'fixtures', 'activity-events.json');
  let events: ActivityEvent[] = [];
  try {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    events = JSON.parse(raw) as ActivityEvent[];
  } catch {
    console.error('[gateway-bridge] fixture file not found:', fixturePath);
    return;
  }

  g.gatewayStatus = 'connected';

  g.fixtureInterval = setInterval(() => {
    const g2 = getG();
    if (events.length === 0) return;
    const event = events[g2.fixtureIndex % events.length];
    if (!event) return;
    g2.fixtureIndex++;

    const live: ActivityEvent = { ...event, timestamp: new Date().toISOString() };
    g2.lastEventAt = Date.now();
    pushReplay(live);
    g2.activityBus.emit('event', live);
    updateAgentState(live);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Agent state tracker
// ---------------------------------------------------------------------------

function updateAgentState(event: ActivityEvent): void {
  // Skip synthetic fallback IDs — they don't represent real agents
  if (event.agentId === 'unknown') return;
  const g = getG();
  const existing = g.agentStates.get(event.agentId) ?? {
    agentId: event.agentId,
    status: 'IDLE' as const,
    lastActiveAt: null,
    currentSessionId: null,
  };

  const next: AgentState = { ...existing, lastActiveAt: event.timestamp };

  switch (event.type) {
    case 'session.start':
      next.status = 'ACTIVE';
      next.currentSessionId = typeof event.meta['sessionId'] === 'string'
        ? event.meta['sessionId']
        : null;
      break;
    case 'session.end':
      next.status = 'IDLE';
      next.currentSessionId = null;
      break;
    case 'cron.start':
      next.status = 'ACTIVE';
      break;
    case 'cron.end':
      next.status = 'IDLE';
      break;
    case 'cron.error':
    case 'error':
      next.status = 'ERROR';
      break;
    default:
      next.status = 'ACTIVE';
  }

  g.agentStates.set(event.agentId, next);
}

// ---------------------------------------------------------------------------
// cron_runs persistence — called on cron.end / cron.error events
// ---------------------------------------------------------------------------

function persistCronRun(event: ActivityEvent): void {
  if (event.type !== 'cron.end' && event.type !== 'cron.error') return;

  const cronId = typeof event.meta['cronId'] === 'string' ? event.meta['cronId'] : null;
  if (!cronId) return;

  const status = event.type === 'cron.end' ? 'success' : 'failure';
  const durationMs = typeof event.meta['durationMs'] === 'number' ? event.meta['durationMs'] : null;
  const errorMessage = typeof event.meta['error'] === 'string' ? event.meta['error'] : null;

  try {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO cron_runs
         (id, cron_id, status, started_at, finished_at, duration_ms, error_message)
       VALUES (?, ?, ?, datetime('now', ? || ' seconds'), datetime('now'), ?, ?)`,
    ).run(
      event.id,
      cronId,
      status,
      durationMs != null ? String(-Math.round(durationMs / 1000)) : '0',
      durationMs,
      errorMessage,
    );
  } catch (err) {
    console.error('[gateway-bridge] failed to persist cron_run:', err);
  }
}

// ---------------------------------------------------------------------------
// WebSocket connection lifecycle
// ---------------------------------------------------------------------------

const MAX_RECONNECT_DELAY = 60_000;

function scheduleReconnect(): void {
  const g = getG();
  if (g.reconnectTimer) return;
  g.gatewayStatus = 'reconnecting';
  console.log(`[gateway-bridge] reconnecting in ${g.reconnectDelay}ms`);
  g.reconnectTimer = setTimeout(() => {
    getG().reconnectTimer = null;
    connect();
  }, g.reconnectDelay);
  g.reconnectDelay = Math.min(g.reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function connect(): void {
  const g = getG();

  if (g.ws) {
    g.ws.removeAllListeners();
    g.ws.terminate();
    g.ws = null;
  }

  const url = gatewayUrl();
  const token = gatewayToken();
  const origin = process.env['AERIE_ORIGIN'] ?? 'https://srv1398517.hstgr.cloud';

  try {
    g.ws = new WebSocket(url, { headers: { Origin: origin } });
  } catch (err) {
    console.error('[gateway-bridge] failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  g.ws.on('open', () => {
    console.log('[gateway-bridge] connected to Gateway');
    getG().gatewayStatus = 'connected';
    getG().reconnectDelay = 2000;
  });

  g.ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    const g2 = getG();

    // Handle connect challenge — respond with the full connect request.
    if (msg['type'] === 'event' && msg['event'] === 'connect.challenge') {
      const payload = msg['payload'] as Record<string, unknown> | undefined;
      const nonce = typeof payload?.['nonce'] === 'string' ? payload['nonce'] : '';
      void nonce;
      console.log('[gateway-bridge] received connect.challenge, sending connect request');
      const connectId = crypto.randomUUID();
      g2.connectRequestId = connectId;
      g2.ws?.send(JSON.stringify({
        type: 'req',
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'openclaw-control-ui',
            version: '1.0.0',
            platform: 'linux',
            mode: 'webchat',
          },
          role: 'operator',
          scopes: ['operator.read', 'operator.write', 'operator.admin'],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token },
          locale: 'en-US',
          userAgent: 'aerie/1.0.0',
        },
      }));
      return;
    }

    // Handle RPC responses and auth connect response.
    if (msg['type'] === 'res') {
      const id = typeof msg['id'] === 'string' ? msg['id'] : null;

      if (id && g2.pendingRequests.has(id)) {
        const pending = g2.pendingRequests.get(id)!;
        g2.pendingRequests.delete(id);
        clearTimeout(pending.timer);
        const error = typeof msg['error'] === 'string' ? msg['error'] : undefined;
        const payload2 = msg['payload'] as Record<string, unknown> | undefined;
        pending.resolve({ id, result: payload2, error });
        return;
      }

      if (id && id === g2.connectRequestId) {
        g2.connectRequestId = null;
        const payload2 = msg['payload'] as Record<string, unknown> | undefined;
        if (msg['ok'] === true && payload2?.['type'] === 'hello-ok') {
          console.log('[gateway-bridge] authenticated as operator');
          // Backfill cron_runs from JSONL files now that we know the gateway is live
          void import('./cron-runs-sync').then(({ backfillCronRuns }) => backfillCronRuns()).catch(
            (err: unknown) => console.error('[gateway-bridge] backfill failed:', err),
          );
        } else if (msg['ok'] === false) {
          console.error('[gateway-bridge] connect request rejected:', JSON.stringify(msg).slice(0, 200));
        }
        return;
      }

      console.debug('[gateway-bridge] unexpected res message:', JSON.stringify(msg).slice(0, 200));
      return;
    }

    // Handle pairing-required
    if (msg['type'] === 'pairing-required') {
      g2.gatewayStatus = 'pairing-required';
      const pairingId = typeof msg['deviceId'] === 'string' ? msg['deviceId'] : 'unknown';
      console.warn(
        `[gateway-bridge] Gateway pairing required — run: openclaw devices approve ${pairingId}`,
      );
      return;
    }

    // Transform Gateway event → ActivityEvent
    const event = transformGatewayMessage(msg);
    if (!event) return;

    g2.lastEventAt = Date.now();
    updateAgentState(event);
    persistCronRun(event);
    pushReplay(event);
    g2.activityBus.emit('event', event);
  });

  g.ws.on('error', (err) => {
    console.error('[gateway-bridge] WebSocket error:', err.message);
  });

  g.ws.on('close', (code) => {
    console.warn(`[gateway-bridge] WebSocket closed (code ${code})`);
    const g2 = getG();
    g2.ws = null;
    g2.connectRequestId = null;
    for (const [id, pending] of g2.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Gateway connection closed (code ${code})`));
      g2.pendingRequests.delete(id);
    }
    if (g2.gatewayStatus !== 'pairing-required') {
      scheduleReconnect();
    }
  });
}

// ---------------------------------------------------------------------------
// Message → ActivityEvent transformer
// ---------------------------------------------------------------------------

function transformGatewayMessage(msg: Record<string, unknown>): ActivityEvent | null {
  // Gateway wraps events as { type: 'event', event: '<specific-type>', ... }.
  // Prefer msg['event'] (the specific type) over msg['type'] (the envelope).
  const rawType = msg['event'] ?? msg['type'];
  if (typeof rawType !== 'string') {
    console.debug('[gateway-bridge] unknown message shape:', JSON.stringify(msg).slice(0, 200));
    return null;
  }

  const knownTypes = new Set([
    'cron.start', 'cron.end', 'cron.error',
    'session.start', 'session.end',
    'tool.call', 'message.sent', 'error',
  ]);

  // Drop unrecognised message types entirely — mapping them to 'error' creates
  // phantom ERROR states for 'unknown' agents in the status strip.
  if (!knownTypes.has(rawType)) return null;
  const type = rawType as ActivityEvent['type'];

  const agentId =
    typeof msg['agentId'] === 'string' ? msg['agentId'] :
    typeof msg['agent_id'] === 'string' ? msg['agent_id'] :
    'unknown';

  const summary = buildSummary(type, msg);
  const id = typeof msg['id'] === 'string' ? msg['id'] : crypto.randomUUID();
  const timestamp = typeof msg['timestamp'] === 'string'
    ? msg['timestamp']
    : new Date().toISOString();

  const { type: _t, event: _e, agentId: _a, agent_id: _ai, id: _id, timestamp: _ts, ...rest } = msg;
  void _t; void _e; void _a; void _ai; void _id; void _ts;

  return { id, type, agentId, summary, meta: rest, timestamp };
}

function buildSummary(type: ActivityEvent['type'], msg: Record<string, unknown>): string {
  switch (type) {
    case 'cron.start':
      return `Cron started: ${msg['cronName'] ?? msg['cronId'] ?? 'unknown'}`;
    case 'cron.end':
      return `Cron finished: ${msg['cronName'] ?? msg['cronId'] ?? 'unknown'} (${msg['status'] ?? 'success'})`;
    case 'cron.error':
      return `Cron failed: ${msg['cronName'] ?? msg['cronId'] ?? 'unknown'} — ${msg['error'] ?? 'unknown error'}`;
    case 'session.start':
      return `Session started — model: ${msg['model'] ?? 'unknown'}`;
    case 'session.end':
      return `Session ended`;
    case 'tool.call':
      return `Tool call: ${msg['tool'] ?? 'unknown'}`;
    case 'message.sent':
      return `Message sent via ${msg['channel'] ?? 'unknown'}`;
    case 'error':
      return typeof msg['error'] === 'string' ? msg['error'] : 'Unknown error';
    default:
      return 'Unknown event';
  }
}

// ---------------------------------------------------------------------------
// Public initializer
// ---------------------------------------------------------------------------

/**
 * Starts the Gateway bridge if not already running.
 * Safe to call multiple times — only one connection is maintained.
 * In fixture mode, streams synthetic events every 3s instead.
 */
/**
 * Seeds agentStates from the most recent cron_run per agent_id so that
 * agent cards show IDLE + real last-active time instead of OFFLINE after
 * a server restart.
 */
function seedAgentStatesFromHistory(): void {
  try {
    const db = (require('./db') as typeof import('./db')).getDb();
    // Pick the most recent finished run per agent_id
    const rows = db.prepare(`
      SELECT agent_id, MAX(COALESCE(finished_at, started_at)) AS last_at
      FROM cron_runs
      WHERE agent_id IS NOT NULL AND agent_id != ''
      GROUP BY agent_id
    `).all() as Array<{ agent_id: string; last_at: string }>;

    const g = getG();
    for (const row of rows) {
      if (!g.agentStates.has(row.agent_id)) {
        g.agentStates.set(row.agent_id, {
          agentId: row.agent_id,
          status: 'IDLE',
          lastActiveAt: row.last_at,
          currentSessionId: null,
        });
      }
    }
    if (rows.length > 0) {
      console.log(`[gateway-bridge] seeded ${rows.length} agent state(s) from cron history`);
    }
  } catch (err) {
    console.error('[gateway-bridge] failed to seed agent states from history:', err);
  }
}

export function ensureBridgeStarted(): void {
  const g = getG();
  if (g.bridgeStarted) return;
  g.bridgeStarted = true;

  if (process.env['USE_FIXTURES'] === 'true') {
    console.log('[gateway-bridge] fixture mode — skipping real Gateway connection');
    startFixtureStream();
    return;
  }

  seedAgentStatesFromHistory();
  connect();
}

// ---------------------------------------------------------------------------
// sendRequest — send an RPC call over the authenticated connection
// ---------------------------------------------------------------------------

const SEND_TIMEOUT_MS = 8000;

/**
 * Sends an RPC request over the existing authenticated Gateway connection.
 * Rejects immediately if the connection is not in 'connected' state.
 * Times out after 8 seconds.
 */
export function sendRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<GatewayRpcResponse> {
  ensureBridgeStarted();
  return new Promise((resolve, reject) => {
    const g = getG();
    if (g.gatewayStatus !== 'connected' || !g.ws) {
      reject(new Error(`Gateway not connected (status: ${g.gatewayStatus})`));
      return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      getG().pendingRequests.delete(id);
      reject(new Error('Gateway RPC timeout'));
    }, SEND_TIMEOUT_MS);

    g.pendingRequests.set(id, { resolve, reject, timer });
    g.ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}
