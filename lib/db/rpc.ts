import { supabase } from '../supabase';

// -----------------------------------------------------------------------
// RPC return types
// -----------------------------------------------------------------------

export type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  age_years: number;
  created_at: string;
};

export type NamedChild = {
  child_id: string;
  first_name: string;
  age_years: number;
};

export type PlaygroundChildrenResult = {
  named: NamedChild[];
  anonymous_ages: number[];
  no_visible_children: boolean;
};

// -----------------------------------------------------------------------
// create_guardian(p_name)
// Creates the guardians row on first login. Idempotent (ON CONFLICT DO NOTHING).
// Gets email from auth.users server-side — not from client.
// -----------------------------------------------------------------------
export async function createGuardian(name: string): Promise<void> {
  const { error } = await supabase.rpc('create_guardian', { p_name: name });
  if (error) throw error;
}

// -----------------------------------------------------------------------
// touch_last_active()
// Returns false if guardian row not found — log, do not treat as error.
// -----------------------------------------------------------------------
export async function touchLastActive(): Promise<boolean> {
  const { data, error } = await supabase.rpc('touch_last_active');
  if (error) throw error;
  return data as boolean;
}

// -----------------------------------------------------------------------
// get_my_children()
// Returns own children with server-computed age_years.
// -----------------------------------------------------------------------
export async function getMyChildren(): Promise<ChildRow[]> {
  const { data, error } = await supabase.rpc('get_my_children');
  if (error) throw error;
  return data as ChildRow[];
}

// -----------------------------------------------------------------------
// get_playground_children(p_playground_id)
// Three states:
//   data present              → render normally
//   no_visible_children=true  → "No one here right now" (timing race, not error)
//   throws 'Access denied'    → real auth failure, handle separately
// -----------------------------------------------------------------------
export async function getPlaygroundChildren(
  playgroundId: string
): Promise<PlaygroundChildrenResult> {
  const { data, error } = await supabase.rpc('get_playground_children', {
    p_playground_id: playgroundId,
  });
  if (error) throw error;
  return data as PlaygroundChildrenResult;
}
