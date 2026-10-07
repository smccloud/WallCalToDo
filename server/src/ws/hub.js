import { WebSocketServer } from 'ws';
import { getCachedEvents, getCachedGridEvents } from '../services/calendarService.js';
import { getCachedTasks } from '../services/todoService.js';
import { getSettings } from '../services/settingsService.js';
import { getCachedWeather } from '../services/weatherService.js';

const HEARTBEAT_MS = 30000;

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    // Hydrate a newly (re)connected display immediately rather than making
    // it wait for the next poll cycle to have anything to show.
    socket.send(JSON.stringify(calendarMessage()));
    socket.send(JSON.stringify({ type: 'todo', data: getCachedTasks() }));
    socket.send(JSON.stringify({ type: 'settings', data: getSettings() }));
    socket.send(JSON.stringify({ type: 'weather', data: getCachedWeather() }));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));
}

// One calendar message, in both the shapes a display needs it:
//
//   data — the complete list from both providers, which the day agenda, the
//          to-do panel and the legend read.
//   grid — the month grid's view of it, Microsoft's per-day cap applied
//          (see getCachedGridEvents).
//
// Split because the cap is a decision about a month cell: hand it to every
// panel fed from this message and the agenda lists "the next two" meetings
// instead of the day it exists to show.
export function calendarMessage() {
  return { type: 'calendar', data: getCachedEvents(), grid: getCachedGridEvents() };
}

// The common case at every call site outside poller.js, which builds the
// message itself so it can diff it first (see pushCalendar).
export function broadcastCalendar() {
  broadcast(calendarMessage());
}

export function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((socket) => {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  });
}
