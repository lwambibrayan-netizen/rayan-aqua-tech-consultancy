import handler from './[...path].js';

// Explicit Vercel function entrypoint for project collection requests.
// Use the emitted .js extension because this project runs as native Node ESM.
// The shared handler enforces Supabase authentication and per-engineer ownership.
export default handler;
