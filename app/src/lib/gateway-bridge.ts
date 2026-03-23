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
// In-process event bus (SSE clients subscribe to this)
// ---------------------------------------------------------------------------

export const activityBus = new EventEmitter();
activityBus.setMaxListeners(100); // allow many concurrent SSE clients

// ---------------------------------------------------------------------------
// Shared mutable state (read by /api/gateway/status)
// ---------------------------------------------------------------------------

export let gatewayStatus: GatewayStatus = 'disconnected';
export let lastEventAt: number | null = null;
export const agentStates = new Map<string, AgentState>();

// ---------------------------------------------------------------------------
// Internal reconnection state
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 2000; // starts at 2s, backs off to 60s
const MAX_RECONNECT_DELAY = 60_000;
let bridgeStarted = false;

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

let fixtureInterval: ReturnType<typeof setInterval> | null = null;
let fixtureIndex = 0;

function startFixtureStream(): void {
  if (fixtureInterval) return;

  const fixturePath = path.join(process.cwd(), 'fixtures', 'activity-events.json');
  let events: ActivityEvent[] = [];
  try {
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    events = JSON.parse(raw) as ActivityEvent[];
  } catch {
    console.error('[gateway-bridge] fixture file not found:', fixturePath);
    return;
  }

  gatewayStatus = 'connected';

  // Emit one fixture event every 3 seconds, cycling through the list
  fixtureInterval = setInterval(() => {
    if (events.length === 0) return;
    const event = events[fixtureIndex % events.length];
    if (!event) return;
    fixtureIndex++;

    // Stamp current time so the feed looks live
    const live: ActivityEvent = { ...event, timestamp: new Date().toISOString() };
    lastEventAt = Date.now();
    activityBus.emit('event', live);
    updateAgentState(live);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Agent state tracker
// ---------------------------------------------------------------------------

function updateAgentState(event: ActivityEvent): void {
  const existing = agentStates.get(event.agentId) ?? {
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
      // tool.call, message.sent — agent is active
      next.status = 'ACTIVE';
  }

  agentStates.set(event.agentId, next);
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
      `INSERT OR IGNORE INTO cron_runs
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

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  gatewayStatus = 'reconnecting';
  console.log(`[gateway-bridge] reconnecting in ${reconnectDelay}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function connect(): void {
  if (ws) {
    ws.removeAllListeners();
    ws.terminate();
    ws = null;
  }

  const url = gatewayUrl();
  const token = gatewayToken();

  try {
    ws = new WebSocket(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    console.error('[gateway-bridge] failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    console.log('[gateway-bridge] connected to Gateway');
    gatewayStatus = 'connected';
    reconnectDelay = 2000; // reset backoff on successful connect

  });

  ws.on('message', (data) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      // Non-JSON frame (heartbeat ping) — ignore
      return;
    }

    // Handle connect challenge — Gateway sends this immediately after open;
    // respond with token + nonce to complete authentication.
    if (msg['type'] === 'event' && msg['event'] === 'connect.challenge') {
      const payload = msg['payload'] as Record<string, unknown> | undefined;
      const nonce = typeof payload?.['nonce'] === 'string' ? payload['nonce'] : '';
      console.log('[gateway-bridge] received connect.challenge, responding with auth');
      ws?.send(JSON.stringify({ type: 'auth', nonce, token }));
      return;
    }

    // Handle pairing-required response
    if (msg['type'] === 'pairing-required') {
      gatewayStatus = 'pairing-required';
      const pairingId = typeof msg['deviceId'] === 'string' ? msg['deviceId'] : 'unknown';
      console.warn(
        `[gateway-bridge] Gateway pairing required — run: openclaw devices approve ${pairingId}`,
      );
      return;
    }

    // Transform Gateway event → ActivityEvent
    const event = transformGatewayMessage(msg);
    if (!event) return;

    lastEventAt = Date.now();
    updateAgentState(event);
    persistCronRun(event);
    activityBus.emit('event', event);
  });

  ws.on('error', (err) => {
    console.error('[gateway-bridge] WebSocket error:', err.message);
  });

  ws.on('close', (code) => {
    console.warn(`[gateway-bridge] WebSocket closed (code ${code})`);
    ws = null;
    if (gatewayStatus !== 'pairing-required') {
      scheduleReconnect();
    }
  });
}

// ---------------------------------------------------------------------------
// Message → ActivityEvent transformer
// ---------------------------------------------------------------------------

function transformGatewayMessage(msg: Record<string, unknown>): ActivityEvent | null {
  // The Gateway event schema is inferred — adapt gracefully if fields differ.
  const rawType = msg['type'] ?? msg['event'];
  if (typeof rawType !== 'string') {
    // Unknown message shape — log for diagnostics, do not crash
    console.debug('[gateway-bridge] unknown message shape:', JSON.stringify(msg).slice(0, 200));
    return null;
  }

  const knownTypes = new Set([
    'cron.start', 'cron.end', 'cron.error',
    'session.start', 'session.end',
    'tool.call', 'message.sent', 'error',
  ]);

  const type = knownTypes.has(rawType)
    ? (rawType as ActivityEvent['type'])
    : 'error'; // treat unknown event types as informational errors

  const agentId =
    typeof msg['agentId'] === 'string' ? msg['agentId'] :
    typeof msg['agent_id'] === 'string' ? msg['agent_id'] :
    'unknown';

  const summary = buildSummary(type, msg);
  const id = typeof msg['id'] === 'string' ? msg['id'] : crypto.randomUUID();
  const timestamp = typeof msg['timestamp'] === 'string'
    ? msg['timestamp']
    : new Date().toISOString();

  // Omit known top-level fields; pass the rest through as meta
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
// Public initializer — called once from the SSE route or gateway/ws route
// ---------------------------------------------------------------------------

/**
 * Starts the Gateway bridge if not already running.
 * Safe to call multiple times — only one connection is maintained.
 * In fixture mode, streams synthetic events every 3s instead.
 */
export function ensureBridgeStarted(): void {
  if (bridgeStarted) return;
  bridgeStarted = true;

  if (process.env['USE_FIXTURES'] === 'true') {
    console.log('[gateway-bridge] fixture mode — skipping real Gateway connection');
    startFixtureStream();
    return;
  }

  connect();
}
