#!/usr/bin/env node
/**
 * Bytos API — production authenticated validation harness.
 *
 * SECURITY CONTRACT
 *  - Email/password are read from THIS terminal only (password masked).
 *  - Credentials and tokens live in memory for the duration of the run.
 *  - Nothing is written to disk, files, env vars, or logs.
 *  - All output is sanitized: HTTP status codes, error codes, and booleans only.
 *    No credential, token, code, verifier, or state value is ever printed.
 *  - Exits non-zero if any check fails.
 *
 * USAGE (run in your own VS Code terminal, not through an agent):
 *   node scripts/validate-auth.mjs
 */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { Writable } from "node:stream"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = "https://bytos-api.contact-altinay.workers.dev"
const CALLBACK_URI = "vscode://bytos.bytos/auth/callback"
const CLIENT_ID = "vscode"

// Only SUPABASE_URL and SUPABASE_ANON_KEY are read from .dev.vars.
// Both are public by design. The service-role key is never read.
const DEV_VARS = path.resolve(process.cwd(), "apps/bytos-api/.dev.vars")

// ---------------------------------------------------------------------------
// Output helpers (sanitized only)
// ---------------------------------------------------------------------------

const results = []
let hardFailure = false

function record(id, title, status, detail) {
  results.push({ id, title, status, detail })
  process.stdout.write(`[${status}] ${id}. ${title}${detail ? ` — ${detail}` : ""}\n`)
}

function pass(id, title, detail) {
  record(id, title, "PASS", detail)
}

function fail(id, title, detail) {
  record(id, title, "FAIL", detail)
  hardFailure = true
}

function skip(id, title, detail) {
  record(id, title, "BLOCKED", detail)
}

function section(name) {
  process.stdout.write(`\n--- ${name} ---\n`)
}

// ---------------------------------------------------------------------------
// Hidden input (masked password, visible email)
// ---------------------------------------------------------------------------

function ask(question, { mask = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("No interactive TTY. Run this directly in your VS Code terminal."))
      return
    }
    const muted = new Writable({
      write(_chunk, _enc, cb) {
        cb()
      },
    })
    const rl = readline.createInterface({
      input: process.stdin,
      output: mask ? muted : process.stdout,
      terminal: true,
    })

    // Hard timeout: never hang forever waiting for input that cannot arrive.
    const timer = setTimeout(() => {
      rl.close()
      reject(new Error("Input timed out after 180s — no interactive terminal detected."))
    }, 180_000)
    timer.unref()

    if (mask) process.stdout.write(question)
    rl.question(mask ? "" : question, (answer) => {
      clearTimeout(timer)
      rl.close()
      if (mask) process.stdout.write("\n")
      resolve(answer)
    })
  })
}

// ---------------------------------------------------------------------------
// Config loading (public values only)
// ---------------------------------------------------------------------------

function loadPublicConfig() {
  if (!fs.existsSync(DEV_VARS)) throw new Error(`Missing ${DEV_VARS}`)
  const kv = {}
  for (const raw of fs.readFileSync(DEV_VARS, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const i = line.indexOf("=")
    if (i < 0) continue
    kv[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const url = (kv.SUPABASE_URL || "").replace(/\/+$/, "")
  const anon = kv.SUPABASE_ANON_KEY || ""
  if (!url) throw new Error("SUPABASE_URL missing from .dev.vars")
  if (!anon) throw new Error("SUPABASE_ANON_KEY missing from .dev.vars")
  return { url, anon }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function callApi(method, pathName, { token, body } = {}) {
  const h = {}
  if (token) h.Authorization = `Bearer ${token}`
  if (body !== undefined) h["Content-Type"] = "application/json"
  const res = await fetch(`${API_BASE}${pathName}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

/** Extracts only a non-sensitive error code from an API error body. */
function errorCode(json) {
  if (!json || typeof json !== "object") return "no_body"
  return typeof json.code === "string" ? json.code : "no_code"
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function makeVerifier() {
  return b64url(crypto.randomBytes(32)) // 43 chars, matches server pattern
}

function makeChallenge(verifier) {
  return b64url(crypto.createHash("sha256").update(verifier).digest())
}

function makeState() {
  return b64url(crypto.randomBytes(32)) // 43 chars, matches ^[A-Za-z0-9_-]{32,256}$
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false
  const A = Buffer.from(a, "utf8")
  const B = Buffer.from(b, "utf8")
  if (A.length !== B.length) return false
  return crypto.timingSafeEqual(A, B)
}

/** Sanitized token shape descriptor. Never reveals content. */
function tokenShape(t) {
  if (typeof t !== "string" || !t) return "absent"
  return `present,len=${t.length}`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  process.stdout.write("Bytos API — production authenticated validation\n")
  process.stdout.write("Credentials are read here only. Nothing is written to disk.\n\n")

  // ---- 0. Config ----------------------------------------------------------
  section("0. Environment")
  let cfg
  try {
    cfg = loadPublicConfig()
  } catch (err) {
    fail("0.1", "Load public Supabase config", String(err.message))
    return
  }
  pass("0.1", "Load public Supabase config", "SUPABASE_URL + anon key present")

  const email = (await ask("Supabase test account email: ")).trim()
  const password = await ask("Supabase test account password (hidden): ", { mask: true })
  if (!email || !password) {
    fail("0.2", "Read credentials", "empty input")
    return
  }
  pass("0.2", "Read credentials", "provided interactively")

  // ---- 1. Authenticate ----------------------------------------------------
  section("1. Authenticate against production Supabase")
  let session
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: cfg.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (res.status !== 200) {
      let code = "unknown"
      try {
        const j = await res.json()
        code = j.error_code || j.error || "unknown"
      } catch {
        /* ignore */
      }
      fail("1.1", "Password grant", `HTTP ${res.status} error=${code}`)
      return
    }
    session = await res.json()
  } catch {
    fail("1.1", "Password grant", "network_error")
    return
  }

  const accessToken = session.access_token
  const refreshToken = session.refresh_token
  const user = session.user || {}

  if (!accessToken) {
    fail("1.1", "Password grant", "no access_token in response")
    return
  }
  pass("1.1", "Password grant", `HTTP 200, access_token=${tokenShape(accessToken)}`)
  pass("1.2", "Refresh token issued", tokenShape(refreshToken))

  const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at)
  const oauthVerified = (user.identities || []).some(
    (i) => i && i.provider && i.provider !== "email",
  )
  if (confirmed || oauthVerified) {
    pass("1.3", "Test account verified", confirmed ? "email_confirmed_at set" : "non-email identity")
  } else {
    fail("1.3", "Test account verified", "not confirmed — handoff will 403")
  }

  const sub = user.id
  if (typeof sub === "string" && sub.length > 0) {
    pass("1.4", "Session carries user id", "id present")
  } else {
    fail("1.4", "Session carries user id", "missing user.id")
    return
  }

  // ---- 2. GET /users/me ---------------------------------------------------
  section("2. Authenticated GET /api/v1/users/me")
  const meRes = await callApi("GET", "/api/v1/users/me", { token: accessToken })

  if (meRes.status === 200 && meRes.json) {
    pass("2.1", "GET /users/me", "HTTP 200")
    const data = meRes.json.data || {}
    if (data.id === sub) {
      pass("2.2", "Returned id matches token sub", "match")
    } else {
      fail("2.2", "Returned id matches token sub", "mismatch")
    }
    const displayName = typeof data.displayName === "string" ? data.displayName : ""
    if (displayName.length > 0) {
      pass("2.3", "displayName populated", `len=${displayName.length}`)
    } else {
      fail("2.3", "displayName populated", "empty displayName")
    }
    if (typeof data.email === "string" && data.email.length > 0) {
      pass("2.4", "email returned", "present")
    } else {
      fail("2.4", "email returned", "empty email")
    }
    record(
      "2.5",
      "Profile row readable (profiles RLS)",
      data.createdAt ? "PASS" : "WARN",
      data.createdAt
        ? "profiles row read successfully"
        : "no profiles row returned — displayName fell back to email/JWT",
    )
  } else if (meRes.status === 401) {
    fail("2.1", "GET /users/me", `HTTP 401 error=${errorCode(meRes.json)}`)
    skip("2.2", "Returned id matches token sub", "blocked by 401")
    skip("2.3", "displayName populated", "blocked by 401")
    skip("2.4", "email returned", "blocked by 401")
    skip("2.5", "Profile row readable (profiles RLS)", "blocked by 401")
  } else if (meRes.status >= 500) {
    fail("2.1", "GET /users/me", `HTTP ${meRes.status} error=${errorCode(meRes.json)}`)
    record(
      "2.5",
      "Profile row readable (profiles RLS)",
      "WARN",
      "5xx suggests profiles RLS denies SELECT for authenticated",
    )
  } else {
    fail("2.1", "GET /users/me", `HTTP ${meRes.status} error=${errorCode(meRes.json)}`)
  }

  // ---- 3. Handoff creation ------------------------------------------------
  section("3. POST /api/v1/auth/handoff/code")
  const verifier = makeVerifier()
  const challenge = makeChallenge(verifier)
  const state = makeState()

  const handoffRes = await callApi("POST", "/api/v1/auth/handoff/code", {
    token: accessToken,
    body: {
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    },
  })

  let handoffCode = null
  if (handoffRes.status === 200 && handoffRes.json && typeof handoffRes.json.code === "string") {
    handoffCode = handoffRes.json.code
    pass("3.1", "Handoff code issued", `HTTP 200, code=${tokenShape(handoffCode)}`)
    const ttl = handoffRes.json.expires_in
    record("3.2", "Code TTL is 300s", ttl === 300 ? "PASS" : "WARN", `expires_in=${ttl}`)
  } else {
    fail("3.1", "Handoff code issued", `HTTP ${handoffRes.status} error=${errorCode(handoffRes.json)}`)
    skip("4.1", "Wrong verifier rejected", "no code issued")
    skip("4.2", "Wrong state rejected", "no code issued")
    skip("5.1", "Exchange succeeded", "no code issued")
    skip("6.1", "Replay rejected", "no code issued")
    return
  }


  // ---- 4. Binding negatives (do not consume the row) ----------------------
  // Wrong challenge/state/redirect all miss the DB lookup, so the row survives
  // for the happy path below.
  section("4. PKCE and state binding negatives")

  const wrongVerifierRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: makeVerifier(),
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state,
    },
  })
  if (wrongVerifierRes.status === 400) {
    pass("4.1", "Wrong verifier rejected", `HTTP 400 error=${errorCode(wrongVerifierRes.json)}`)
  } else {
    fail("4.1", "Wrong verifier rejected", `HTTP ${wrongVerifierRes.status}`)
  }

  const wrongStateRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: verifier,
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state: makeState(),
    },
  })
  if (wrongStateRes.status === 400) {
    pass("4.2", "Wrong state rejected", `HTTP 400 error=${errorCode(wrongStateRes.json)}`)
  } else {
    fail("4.2", "Wrong state rejected", `HTTP ${wrongStateRes.status}`)
  }

  const badRedirectRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: verifier,
      redirect_uri: "vscode://evil.example/auth/callback",
      client_id: CLIENT_ID,
      state,
    },
  })
  if (badRedirectRes.status === 400) {
    pass("4.3", "Wrong redirect_uri rejected", `HTTP 400 error=${errorCode(badRedirectRes.json)}`)
  } else {
    fail("4.3", "Wrong redirect_uri rejected", `HTTP ${badRedirectRes.status}`)
  }

  const badFormatRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: "short",
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state,
    },
  })
  if (badFormatRes.status === 400) {
    pass("4.4", "Malformed verifier rejected", `HTTP 400 error=${errorCode(badFormatRes.json)}`)
  } else {
    fail("4.4", "Malformed verifier rejected", `HTTP ${badFormatRes.status}`)
  }

  // ---- 5. Happy path ------------------------------------------------------
  section("5. PKCE exchange (happy path)")
  const exchangeRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: verifier,
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state,
    },
  })

  if (exchangeRes.status === 200 && exchangeRes.json) {
    pass("5.1", "Exchange succeeded", "HTTP 200")
    const out = exchangeRes.json
    if (timingSafeEqualStr(out.access_token, accessToken)) {
      pass("5.2", "access_token matches session", "byte-identical (in-memory compare)")
    } else {
      fail("5.2", "access_token matches session", "mismatch")
    }
    if (timingSafeEqualStr(out.refresh_token, refreshToken)) {
      pass("5.3", "refresh_token matches session", "byte-identical (in-memory compare)")
    } else {
      fail("5.3", "refresh_token matches session", "mismatch")
    }
    record(
      "5.4",
      "token_type",
      out.token_type === "bearer" ? "PASS" : "WARN",
      `token_type=${out.token_type}`,
    )
    record(
      "5.5",
      "expires_in",
      out.expires_in === 3600 ? "PASS" : "WARN",
      `expires_in=${out.expires_in}`,
    )
    if (out.user && out.user.id === sub) {
      pass("5.6", "Returned user id matches", "match")
    } else {
      fail("5.6", "Returned user id matches", "mismatch")
    }
  } else {
    fail("5.1", "Exchange succeeded", `HTTP ${exchangeRes.status} error=${errorCode(exchangeRes.json)}`)
    skip("5.2", "access_token matches session", "exchange failed")
    skip("5.3", "refresh_token matches session", "exchange failed")
  }

  // ---- 6. Replay and unknown code ----------------------------------------
  section("6. Replay and invalid code rejection")
  const replayRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: handoffCode,
      code_verifier: verifier,
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state,
    },
  })
  if (replayRes.status === 400) {
    pass("6.1", "Replay of consumed code rejected", `HTTP 400 error=${errorCode(replayRes.json)}`)
  } else {
    fail("6.1", "Replay of consumed code rejected", `HTTP ${replayRes.status}`)
  }

  const bogusRes = await callApi("POST", "/api/v1/auth/exchange", {
    body: {
      code: b64url(crypto.randomBytes(32)),
      code_verifier: makeVerifier(),
      redirect_uri: CALLBACK_URI,
      client_id: CLIENT_ID,
      state: makeState(),
    },
  })
  if (bogusRes.status === 400) {
    pass("6.2", "Unknown code rejected", `HTTP 400 error=${errorCode(bogusRes.json)}`)
  } else {
    fail("6.2", "Unknown code rejected", `HTTP ${bogusRes.status}`)
  }

  // ---- 7. Unauthenticated control ----------------------------------------
  section("7. Unauthenticated control")
  const noAuthRes = await callApi("GET", "/api/v1/users/me")
  record(
    "7.1",
    "No-token request rejected",
    noAuthRes.status === 401 ? "PASS" : "FAIL",
    `HTTP ${noAuthRes.status} error=${errorCode(noAuthRes.json)}`,
  )
  if (noAuthRes.status !== 401) hardFailure = true

  const forgedRes = await callApi("GET", "/api/v1/users/me", {
    token: b64url(crypto.randomBytes(48)),
  })
  record(
    "7.2",
    "Forged token rejected",
    forgedRes.status === 401 ? "PASS" : "FAIL",
    `HTTP ${forgedRes.status} error=${errorCode(forgedRes.json)}`,
  )
  if (forgedRes.status !== 401) hardFailure = true

  // ---- 8. Expiry (not exercised) -----------------------------------------
  section("8. Expiry guard")
  skip(
    "8.1",
    "Expired code rejected",
    "NOT TESTED — requires waiting 300s; covered indirectly by 6.1/6.2",
  )
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    // Deliberately minimal: do not dump the error object, which could
    // carry request context.
    process.stdout.write(`\n[FAIL] harness error — ${err && err.message ? err.message : "unknown"}\n`)
    hardFailure = true
  })
  .finally(() => {
    const tally = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {})
    section("SUMMARY")
    process.stdout.write(
      `PASS=${tally.PASS || 0}  FAIL=${tally.FAIL || 0}  WARN=${tally.WARN || 0}  BLOCKED=${tally.BLOCKED || 0}\n`,
    )
    process.stdout.write(
      "NOTE: encrypted-field cleanup is NOT covered here — run the separate SQL query.\n",
    )
    process.stdout.write(`Exit: ${hardFailure ? "1 (failures present)" : "0"}\n`)
    process.exitCode = hardFailure ? 1 : 0
  })

