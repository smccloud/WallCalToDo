import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { accountsRouter } from './routes/accounts.js';
import { settingsRouter } from './routes/settings.js';
import { credentialsRouter } from './routes/credentials.js';
import { initWebSocket, broadcast } from './ws/hub.js';
import { currentBuild, watchBuild } from './services/buildStamp.js';
import { startPolling } from './services/poller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use('/auth', authRouter);
app.use('/api', apiRouter);
app.use('/api', accountsRouter);
app.use('/api', settingsRouter);
app.use('/api', credentialsRouter);

// Two frontends, one server: the kiosk display (frontend/dist, served at
// "/") and the companion settings app (companion/dist, served at
// "/companion"). Both are built separately and just picked up here so the
// Pi only has to run one process. In dev, run each app's own Vite server
// instead — these static blocks simply won't find anything, which is fine.
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
const companionDist = path.join(__dirname, '..', '..', 'companion', 'dist');

app.use('/companion', express.static(companionDist));
app.get('/companion/*', (req, res, next) => {
  res.sendFile(path.join(companionDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// Serves the display's index.html with a build id stamped into it, rather
// than straight off disk.
//
// This handler exists only because it has to come *before* the static block
// below: express.static serves index.html for "/" itself, so without an
// explicit route ahead of it the page would be served unstamped and every
// display would have no build id to compare against -- which is the same
// silent-no-update failure this whole mechanism exists to prevent.
//
// Anything that isn't a build yet (dev mode, before the first `npm run
// build`) falls through to the static block, which serves what it can.
app.get('/', (req, res, next) => {
  const build = currentBuild();
  if (!build) return next();
  res.type('html').send(build.html);
});

app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path.startsWith('/companion')) {
    return next();
  }
  const build = currentBuild();
  if (!build) return next();
  res.type('html').send(build.html);
});

const server = http.createServer(app);
initWebSocket(server);

// Tells displays to reload themselves when a new build lands on disk, so a
// deploy doesn't need anyone to walk over to the wall. Started after the
// WebSocket server exists so the broadcast below has somewhere to go.
watchBuild((id) => broadcast({ type: 'build', data: { id } }));

// Silent on a successful start: this is a service that's restarted routinely
// (and `systemctl status` says whether it's running), so a startup line in
// the journal is just noise to scroll past. Anything that actually went
// wrong still says so, both here and from the pollers below.
server.listen(config.port, startPolling);
