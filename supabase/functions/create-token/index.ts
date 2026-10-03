import { admin, authUser, cors, json, randomToken, sha256 } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const user = await authUser(req);
  if (!user) return json({ error: "Sign in required" }, 401);
  const { file_id, ttl_seconds = 300, max_views = 5 } = await req.json().catch(() => ({}));
  const ttl = Math.min(Math.max(Number(ttl_seconds) || 300, 60), 86400);
  const views = Math.min(Math.max(Number(max_views) || 5, 1), 100);

  const { data: file } = await admin.from("files").select("id").eq("id", file_id).eq("owner_id", user.id).maybeSingle();
  if (!file) return json({ error: "File not found" }, 404);

  const token = randomToken(); // 256 bits of entropy
  const expires_at = new Date(Date.now() + ttl * 1000).toISOString();
  const { error } = await admin.from("share_tokens").insert({ file_id, token_hash: await sha256(token), expires_at, max_views: views });
  if (error) return json({ error: "Could not create link" }, 500);
  return json({ url: `${Deno.env.get("APP_URL")}/r/${token}`, expires_at });
});
