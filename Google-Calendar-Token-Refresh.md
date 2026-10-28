# Google Calendar Token Refresh

When Google OAuth refresh tokens become invalid (revoked, expired, or invalidated), WallCalToDo now automatically detects the  error, removes the affected account, clears all cached calendar and task data for it, and broadcasts updates to the UI. Users no longer need to manually reconnect - the account will be removed and can be re-added from the companion app.

Added in v1.0.8.
