import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database.ts';
import { processImport } from '../../../src/lib/import-service.ts';

const allowed = new Set(['https://content-intelligence-yangzha.travisfrey5197.chatgpt.site', 'http://127.0.0.1:3000', 'http://localhost:3000']);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Origin': origin && allowed.has(origin) ? origin : '', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowed.has(origin)) return reply({ error: '此网站未获准调用导入服务。' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: '仅支持 POST。' }, 405);
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: '请先登录。' }, 401);
  // No service-role client: Auth, Storage and database calls all use the user JWT.
  const client = createClient<Database>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !user.user) return reply({ error: '登录已过期，请重新登录。' }, 401);
  try {
    const text = await request.text();
    if (text.length > 2048) return reply({ error: '请求过大。' }, 413);
    const input = JSON.parse(text);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.batch_id) || !['validate', 'commit'].includes(input.action)) return reply({ error: '批次或操作无效。' }, 400);
    return reply(await processImport(client, input.batch_id, input.action, user.user.id));
  } catch (error) {
    // Do not log raw files, comment text, tokens, or database internals.
    return reply({ error: error instanceof Error ? error.message : '导入服务暂时不可用，请稍后重试。' }, 400);
  }
});
