"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, User } from "lucide-react";

const DEMO_EMAIL = "demo@lumen.ai";
const DEMO_PASSWORD = "lumen123";

export function AuthPage({ mode, signedIn }: { mode: "login" | "register"; signedIn: boolean }) {
  const register = mode === "register";
  const router = useRouter();
  const [name, setName] = useState(register ? "Maya Chen" : "");
  const [email, setEmail] = useState(register ? "maya@lumen.ai" : DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/demo-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, name, email, password }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to continue.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to continue.");
    } finally { setBusy(false); }
  };

  return <main className="auth-canvas min-h-screen overflow-hidden bg-[#07101f] text-white">
    <div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" />
    <header className="relative z-10 mx-auto flex max-w-[1180px] items-center justify-between px-6 py-6"><Link href="/" className="group flex items-center gap-3"><span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-white text-[#07101f]"><span className="relative z-10 font-mono text-sm font-black">L</span><span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-[#b8ed3a] transition-transform duration-500 group-hover:scale-150" /></span><span><strong className="block text-sm tracking-[.15em]">LUMEN</strong><span className="text-[9px] uppercase tracking-[.2em] text-white/45">Decision intelligence</span></span></Link><Link href="/" className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/65 transition-all duration-300 hover:border-white/30 hover:text-white">Back to home</Link></header>
    <section className="relative z-10 mx-auto grid min-h-[calc(100vh-92px)] max-w-[1180px] items-center gap-12 px-6 pb-14 lg:grid-cols-[1fr_460px]">
      <div className="auth-copy hidden lg:block"><span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#b8ed3a]/20 bg-[#b8ed3a]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-[#b8ed3a]"><Sparkles className="h-3.5 w-3.5" /> Intelligence at decision speed</span><h1 className="max-w-xl text-6xl font-semibold leading-[.96] tracking-[-.065em]">Your data already knows what comes next.</h1><p className="mt-6 max-w-lg text-base leading-7 text-white/55">Lumen turns spreadsheets and reports into clear signals, defensible decisions, and board-ready narratives.</p><div className="mt-10 grid max-w-lg grid-cols-3 gap-3">{[{ value: "20 sec", label: "to first insight" }, { value: "14+", label: "chart types" }, { value: "3", label: "AI providers" }].map((item) => <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[.04] p-4 backdrop-blur"><strong className="block text-xl text-[#b8ed3a]">{item.value}</strong><span className="mt-1 block text-[10px] uppercase tracking-wider text-white/40">{item.label}</span></div>)}</div></div>
      <div className="auth-card relative rounded-[28px] border border-white/10 bg-[#0d1829]/85 p-7 shadow-2xl shadow-black/40 backdrop-blur-2xl sm:p-9"><span className="mb-6 grid h-11 w-11 place-items-center rounded-2xl bg-[#2764ff] shadow-lg shadow-[#2764ff]/30">{register ? <Sparkles className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}</span><h2 className="text-3xl font-semibold tracking-[-.045em]">{register ? "Create your workspace" : "Sign in to Lumen"}</h2><p className="mt-2 text-sm leading-6 text-white/50">{register ? "Use the sample profile or enter your own demo details. Passwords are never persisted." : "Use the demo credentials below to explore the complete workspace."}</p>
        {signedIn && <Link href="/dashboard" className="mt-5 flex items-center justify-between rounded-xl border border-[#b8ed3a]/20 bg-[#b8ed3a]/10 px-4 py-3 text-xs font-semibold text-[#b8ed3a] transition-all hover:border-[#b8ed3a]/40"><span>Session already active</span><span className="flex items-center gap-1">Dashboard <ArrowRight className="h-3.5 w-3.5" /></span></Link>}
        {!register && <div className="mt-5 rounded-xl border border-white/10 bg-white/[.04] p-3"><p className="text-[9px] font-bold uppercase tracking-[.15em] text-[#b8ed3a]">Demo credentials</p><div className="mt-2 grid gap-1 font-mono text-[11px] text-white/60 sm:grid-cols-2"><span>{DEMO_EMAIL}</span><span>{DEMO_PASSWORD}</span></div></div>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          {register && <label className="block text-[10px] font-bold uppercase tracking-[.12em] text-white/45">Full name<div className="relative mt-2"><User className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"/><input required value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} autoComplete="name" className="auth-input h-12 w-full rounded-xl border border-white/10 bg-white/[.05] pl-10 pr-4 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/20 focus:border-[#5f8cff] focus:bg-white/[.07] focus:ring-4 focus:ring-[#2764ff]/10" placeholder="Maya Chen" /></div></label>}
          <label className="block text-[10px] font-bold uppercase tracking-[.12em] text-white/45">Email address<div className="relative mt-2"><Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"/><input required type="email" value={email} onChange={(event) => setEmail(event.target.value.slice(0, 120))} autoComplete="email" className="auth-input h-12 w-full rounded-xl border border-white/10 bg-white/[.05] pl-10 pr-4 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/20 focus:border-[#5f8cff] focus:bg-white/[.07] focus:ring-4 focus:ring-[#2764ff]/10" placeholder="you@company.com" /></div></label>
          <label className="block text-[10px] font-bold uppercase tracking-[.12em] text-white/45">Password<div className="relative mt-2"><LockKeyhole className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"/><input required minLength={8} type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value.slice(0, 80))} autoComplete={register ? "new-password" : "current-password"} className="auth-input h-12 w-full rounded-xl border border-white/10 bg-white/[.05] pl-10 pr-11 text-sm text-white outline-none transition-all duration-300 placeholder:text-white/20 focus:border-[#5f8cff] focus:bg-white/[.07] focus:ring-4 focus:ring-[#2764ff]/10" placeholder="Minimum 8 characters"/><button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button></div></label>
          {error && <p role="alert" className="rounded-xl border border-[#ff6a4d]/20 bg-[#ff6a4d]/10 px-3 py-2.5 text-xs text-[#ff9c89]">{error}</p>}
          <button disabled={busy} type="submit" className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white font-semibold text-[#07101f] transition-all duration-300 hover:-translate-y-0.5 hover:bg-[#b8ed3a] hover:shadow-xl hover:shadow-[#b8ed3a]/15 disabled:cursor-wait disabled:opacity-60">{busy ? "Opening workspace…" : register ? "Create demo account" : "Sign in with demo"}<ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" /></button>
        </form>
        <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-white/10" /><span className="text-[9px] uppercase tracking-[.16em] text-white/25">Demo environment</span><span className="h-px flex-1 bg-white/10" /></div>
        <ul className="space-y-2">{["Password is validated but never stored", "Session uses an HTTP-only demo cookie", "Use a real identity provider before production"].map((item) => <li key={item} className="flex items-center gap-3 text-[11px] text-white/45"><span className="grid h-5 w-5 place-items-center rounded-full bg-[#b8ed3a]/15 text-[#b8ed3a]"><Check className="h-3 w-3" /></span>{item}</li>)}</ul>
        <p className="mt-6 text-center text-xs text-white/35">{register ? "Already have demo access?" : "New to Lumen?"} <Link href={register ? "/login" : "/register"} className="font-semibold text-white transition-colors hover:text-[#b8ed3a]">{register ? "Sign in" : "Create an account"}</Link></p>
      </div>
    </section>
  </main>;
}
