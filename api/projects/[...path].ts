import handler from '../[...path].js';

// Explicit nested project API entrypoint. This ensures Vercel routes
// /api/projects/:projectId/docs/* and /api/projects/:projectId/gis-drafts/*
// to the authenticated handler rather than the SPA fallback.
export default handler;
