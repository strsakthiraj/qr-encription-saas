import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import type { Session } from "@supabase/supabase-js";
import { supabase, SUPABASE_URL } from "./supabase";

type FileRow = { id: string; name: string; mime: string; size: number; created_at: string };
const fmt = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in"); const [msg, setMsg] = useState("");
  const submit = async () => {
    const { error } = mode === "in" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setMsg(error ? error.message : mode === "up" ? "Check your email to confirm your account." : "");
  };
  return (
    <main className="narrow">
      <h1>QRDrop</h1><p className="muted">Share a file with a scan. The link expires on its own.</p>
      <div className="stack">
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button onClick={submit}>{mode === "in" ? "Sign in" : "Create account"}</button>
        <button className="ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Need an account?" : "Have an account?"}</button>
        {msg && <p role="alert" className="muted">{msg}</p>}
      </div>
    </main>
  );
}

function Dashboard() {
  const [files, setFiles] = useState<FileRow[]>([]); const [err, setErr] = useState("");
  const [share, setShare] = useState<{ url: string; expires: number; name: string } | null>(null);
  const [ttl, setTtl] = useState(300); const [now, setNow] = useState(Date.now());
  const load = async () => { const { data } = await supabase.from("files").select("id,name,mime,size,created_at").order("created_at", { ascending: false }); setFiles(data ?? []); };
  useEffect(() => { load(); const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const upload = async (f?: File) => {
    if (!f) return; setErr(""); const body = new FormData(); body.append("file", f);
    const { error } = await supabase.functions.invoke("upload", { body });
    error ? setErr("Upload failed. Files must be 20 MB or smaller.") : load();
  };
  const makeLink = async (f: FileRow) => {
    setErr(""); const { data, error } = await supabase.functions.invoke("create-token", { body: { file_id: f.id, ttl_seconds: ttl, max_views: 5 } });
    error ? setErr("Could not create the QR code.") : setShare({ url: data.url, expires: Date.parse(data.expires_at), name: f.name });
  };
  const remaining = share ? Math.max(0, Math.round((share.expires - now) / 1000)) : 0;

  return (
    <main>
      <header><h1>QRDrop</h1><button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></header>
      <label className="drop"><input type="file" hidden onChange={(e) => upload(e.target.files?.[0])} />Choose a file to upload (up to 20 MB)</label>
      {err && <p role="alert" className="error">{err}</p>}
      <div className="row"><label htmlFor="ttl">QR code valid for</label>
        <select id="ttl" value={ttl} onChange={(e) => setTtl(+e.target.value)}>
          <option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={3600}>1 hour</option><option value={86400}>24 hours</option>
        </select></div>
      {files.length === 0 ? <p className="muted">No files yet. Upload one to generate a QR code.</p> :
        <ul className="files">{files.map((f) => (
          <li key={f.id}><div><strong>{f.name}</strong><span className="muted">{fmt(f.size)}</span></div>
            <div className="row"><button onClick={() => makeLink(f)}>Show QR</button>
              <button className="ghost" onClick={async () => { await supabase.from("files").delete().eq("id", f.id); load(); }}>Delete</button></div></li>))}</ul>}
      {share && (
        <div className="modal" role="dialog" aria-label="QR code" onClick={() => setShare(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h2>{share.name}</h2>
            {remaining > 0 ? <QRCodeSVG value={share.url} size={240} marginSize={2} /> : <p className="error">This QR code has expired.</p>}
            <p className="muted">{remaining > 0 ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Create a new one to share again."}</p>
            <button onClick={() => setShare(null)}>Done</button>
          </div></div>)}
    </main>
  );
}

function Receiver() {
  const { token } = useParams(); const ran = useRef(false);
  const [f, setF] = useState<{ name: string; mime: string; size: number; stream_url: string } | null>(null); const [err, setErr] = useState("");
  useEffect(() => {
    if (ran.current) return; ran.current = true; // each resolve consumes a view; avoid StrictMode double-call
    fetch(`${SUPABASE_URL}/functions/v1/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => (r.ok ? setF(await r.json()) : setErr((await r.json()).error ?? "Link unavailable"))).catch(() => setErr("Network error. Try scanning again."));
  }, [token]);
  if (err) return <main className="narrow"><h1>Link unavailable</h1><p className="error" role="alert">{err}</p><p className="muted">Ask the sender for a new QR code.</p></main>;
  if (!f) return <main className="narrow"><p className="muted">Checking link…</p></main>;
  return (
    <main className="narrow">
      <h1>{f.name}</h1><p className="muted">{fmt(f.size)}</p>
      <div className="player">
        {f.mime.startsWith("video/") ? <video src={f.stream_url} controls playsInline preload="metadata" /> :
         f.mime.startsWith("audio/") ? <audio src={f.stream_url} controls /> :
         f.mime.startsWith("image/") ? <img src={f.stream_url} alt={f.name} /> :
         f.mime === "application/pdf" ? <iframe src={f.stream_url} title={f.name} /> : null}
      </div>
      <a className="btn" href={f.stream_url} download={f.name}>Download</a>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s)); return () => data.subscription.unsubscribe(); }, []);
  return (
    <Routes>
      <Route path="/r/:token" element={<Receiver />} />
      <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
      <Route path="/" element={session === undefined ? null : session ? <Dashboard /> : <Navigate to="/login" />} />
    </Routes>
  );
}
