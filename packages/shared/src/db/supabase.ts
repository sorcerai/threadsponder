import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Public client for frontend (respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Service client for backend (bypasses RLS)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Create a tenant-scoped client
export function createTenantClient(tenantId: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        'x-tenant-id': tenantId,
      },
    },
  });
}

export { createClient };
