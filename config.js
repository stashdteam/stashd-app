/* Stashd settings. The publishable (anon) key is meant to be public: row-level security
   in supabase/schema.sql is what keeps each person's data private.
   Leave supabaseKey empty to run in local test mode (data stays in this browser). */
window.STASHD_CONFIG = {
  supabaseUrl: 'https://fmwwzixstqlytalqwuda.supabase.co',
  supabaseKey: 'sb_publishable_ZWRjp2JJOI5oAcxhjRuVpA_p8p3Sa8h',
  // Turn these on once each provider is set up in Supabase → Authentication → Sign In / Providers.
  providers: { google: true, apple: false }
};
