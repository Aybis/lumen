import { NextRequest, NextResponse } from "next/server";

const DEMO_EMAIL = "demo@lumen.ai";
const DEMO_PASSWORD = "lumen123";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { mode?: "login" | "register"; name?: string; email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() || "";
    const password = body.password || "";
    if (body.mode === "login" && (email !== DEMO_EMAIL || password !== DEMO_PASSWORD)) {
      return NextResponse.json({ error: "Use demo@lumen.ai with password lumen123." }, { status: 401 });
    }
    if (body.mode === "register" && (!body.name?.trim() || !email.includes("@") || password.length < 8)) {
      return NextResponse.json({ error: "Enter a name, valid email, and at least 8 password characters." }, { status: 400 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set("lumen-demo-session", "active", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 });
    return response;
  } catch {
    return NextResponse.json({ error: "The demo session could not be created." }, { status: 400 });
  }
}
