import { WebSocketServer } from 'ws';
import { getMergedEvents } from '../services/calendarAggregator.js';
import { getMergedTasks } from '../services/todoAggregator.js';
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
    // it wait for the next poll cycle to have anything to show. Both
    // `calendar` and `todo` are merged snapshots across providers (see
    // calendarAggregator.js / todoAggregator.js) -- sending just one
    // provider's cache here would mean a freshly (re)connected display
    // sits showing only part of the calendar/list until the next poll
    // cycle happens to touch the other provider too.
    socket.send(JSON.stringify({ type: 'calendar', data: getMergedEvents() }));
    socket.send(JSON.stringify({ type: 'todo', data: getMergedTasks() }));
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

export function broadcast(message) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((socket) => {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  });
}
