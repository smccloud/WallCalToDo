import { Router } from 'express';
import { getCachedEvents } from '../services/calendarService.js';
import { getCachedTasks } from '../services/todoService.js';
import { currentBuildId } from '../services/buildStamp.js';
import { isAuthorized as isGoogleAuthorized } from '../auth/googleAuth.js';
import { isAuthorized as isMsAuthorized } from '../auth/microsoftAuth.js';

export const apiRouter = Router();

apiRouter.get('/calendar', (req, res) => res.json(getCachedEvents()));
apiRouter.get('/todo', (req, res) => res.json(getCachedTasks()));

apiRouter.get('/status', async (req, res) => {
  res.json({
    googleConnected: isGoogleAuthorized(),
    microsoftConnected: await isMsAuthorized(),
    // Which build of the display this backend is serving. Not something the
    // app itself reads — it's here so that "is the wall running the code I
    // just deployed?" is answerable over SSH with curl, which on a display
    // with no keyboard is otherwise a question with no way to ask it.
    build: currentBuildId(),
  });
});
