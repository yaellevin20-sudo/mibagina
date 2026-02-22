import { supabase } from './supabase';

// -----------------------------------------------------------------------
// changeEmail(newEmail)
// Calls the change-email Edge Function (Admin API required).
// Throws a typed error string on known failures (e.g. 'email_in_use').
// -----------------------------------------------------------------------
export async function changeEmail(newEmail: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('change-email', {
    body: { newEmail },
  });

  if (error) throw error;

  const body = data as { ok?: boolean; error?: string };
  if (body.error) {
    throw new Error(body.error);
  }
}

// -----------------------------------------------------------------------
// callDeleteAccount()
// Calls the delete-account Edge Function (Admin API deleteUser).
// Must be called AFTER delete_my_account() RPC has succeeded.
// -----------------------------------------------------------------------
export async function callDeleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: {},
  });

  if (error) throw error;

  const body = data as { ok?: boolean; error?: string };
  if (body.error) {
    throw new Error(body.error);
  }
}
