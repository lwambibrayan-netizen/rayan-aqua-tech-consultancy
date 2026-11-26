import handler from './[...path]';

// Explicit Vercel function entrypoint for project collection requests.
// The shared handler dispatches GET and POST /api/projects and enforces
// Supabase authentication plus per-engineer project ownership.
export default handler;
