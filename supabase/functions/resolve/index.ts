import { admin, cors, json, sha256, signStream } from "../_shared/util.ts";

// Public. Validates + consumes one view, returns metadata and a 10-minute signed stream URL.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || token.length < 40 || token.length > 64) return json({ error: "Invalid link" }, 400);
  const { data } = await admin.rpc("consume_token", { p_hash: await sha256(token) });
  const f = data?.[0];
  if (!f) return json({ error: "This link is expired, used up, or revoked" }, 410); // same reply for every failure
  const s = await signStream(f.file_id);
  return json({
    name: f.name, mime: f.mime, size: f.size,
    stream_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/stream?s=${s}`,
  });
});
