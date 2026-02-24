import { supabase } from '../supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DuplicateInfo = {
  my_child_id: string;
  match: {
    child_id: string;
    first_name: string;
    birth_year: number;
  };
};

export type JoinResult =
  | { status: 'done' }
  | { status: 'needs_confirmation'; duplicates: DuplicateInfo[] }
  | { status: 'already_member'; group_id: string; group_name: string };

// ---------------------------------------------------------------------------
// validateInviteToken(token)
// Calls join-group Edge Function (action: validate) — rate limited by IP.
// Throws with message 'rate_limited', 'expired_token', or 'invalid_token'.
// ---------------------------------------------------------------------------
export async function validateInviteToken(
  token: string
): Promise<{ group_id: string; group_name: string; inviter_name?: string | null }> {
  const { data, error } = await supabase.functions.invoke('join-group', {
    body: { action: 'validate', token },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { group_id: string; group_name: string };
}

// ---------------------------------------------------------------------------
// joinGroup(params)
// First call (no confirmed_merges): returns done or needs_confirmation.
// Second call (with confirmed_merges): always returns done.
// ---------------------------------------------------------------------------
export async function joinGroup(params: {
  token: string;
  group_id: string;
  child_ids: string[];
  confirmed_merges?: Record<string, string | null>;
}): Promise<JoinResult> {
  const { data, error } = await supabase.functions.invoke('join-group', {
    body: { action: 'join', ...params },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as JoinResult;
}
