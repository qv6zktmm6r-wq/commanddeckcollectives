// Supabase Edge Function entry point. Deploy with JWT verification off (the handler checks the owner sign-in itself):
//   supabase functions deploy shopify-stock --no-verify-jwt --project-ref tfavgqqqagcqhfeeutzc
import { createHandler } from './handler.ts';

Deno.serve(createHandler({ env: (name) => Deno.env.get(name), fetch }));
