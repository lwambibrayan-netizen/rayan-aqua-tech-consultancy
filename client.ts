import { createClient, type User as SupabaseUser } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export type WorkspaceUser = { userId: string; name?: string; email?: string; picture?: string };
function asWorkspaceUser(user: SupabaseUser | null): WorkspaceUser | null {
  if (!user) return null;
  const metadata = user.user_metadata ?? {};
  return {
    userId: user.id,
    email: user.email ?? undefined,
    name: String(metadata.full_name ?? metadata.name ?? user.email ?? ''),
    picture: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : undefined,
  };
}

export const auth = {
  async getUser(): Promise<WorkspaceUser | null> {
    if (!supabase) throw new Error('Authentication is not configured. Set the Supabase public URL and anon key.');
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    return asWorkspaceUser(data.user);
  },
  async signInWithPassword(email: string, password: string): Promise<void> {
    if (!supabase) throw new Error('Authentication is not configured. Set the Supabase public URL and publishable key.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUpWithPassword(email: string, password: string): Promise<boolean> {
    if (!supabase) throw new Error('Authentication is not configured. Set the Supabase public URL and publishable key.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    return !data.session;
  },
  async signInWithGoogle(): Promise<void> {
    if (!supabase) throw new Error('Authentication is not configured. Set the Supabase public URL and publishable key.');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  },
  async signOut(): Promise<void> {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};

type ApiResponse<T = any> = { data: T };
async function request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  if (!supabase) throw new Error('Backend is not configured. Set the Supabase public URL and anon key.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your sign-in session has expired. Please sign in again.');
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed (${response.status}).`);
  return { data: payload as T };
}
async function downloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  if (!supabase) throw new Error('Backend is not configured. Set the Supabase public URL and anon key.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your sign-in session has expired. Please sign in again.');
  const response = await fetch(path, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.error === 'string' ? payload.error : `Download failed (${response.status}).`);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return { blob: await response.blob(), filename: match?.[1] || 'rayanaqua-terrain-output' };
}
export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
  download: downloadFile,
};
