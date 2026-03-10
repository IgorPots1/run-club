import { NextResponse } from 'next/server'

const DEBUG_ENDPOINT = 'http://127.0.0.1:7626/ingest/46c1bc3f-1e85-492e-a842-c0160f231db0'
const DEBUG_SESSION_ID = 'f33647'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    await fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': DEBUG_SESSION_ID,
      },
      body: JSON.stringify({
        sessionId: DEBUG_SESSION_ID,
        ...body,
      }),
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
