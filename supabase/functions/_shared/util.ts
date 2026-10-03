import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}`;

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_URL")!,
  "Access-Control-Allow-Headers": "authorization, content-type, range, apikey, x-client-info",
  "Access-Control-Expose-Headers": "content-range, accept-ranges, content-length",
  Vary: "Origin",
};
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function authUser(req: Request) {
  const t = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!t) return null;
  const { data } = await admin.auth.getUser(t);
  return data.user;
}

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

const hmacKey = () =>
  crypto.subtle.importKey("raw", enc.encode(Deno.env.get("STREAM_SIGNING_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sign = async (p: string) => b64u(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(p)));

// Short-lived stream session: "<fileId>.<exp>.<sig>". Issued by `resolve`, checked by `stream`.
export async function signStream(fileId: string, ttl = 600) {
  const p = `${fileId}.${Math.floor(Date.now() / 1000) + ttl}`;
  return `${p}.${await sign(p)}`;
}
export async function verifyStream(s: string) {
  const [id, exp, sig] = s.split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  return (await sign(`${id}.${exp}`)) === sig ? id : null;
}
