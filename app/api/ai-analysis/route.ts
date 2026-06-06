import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { prompt, mode } = await req.json()
    if (!prompt) return NextResponse.json({ error: 'No prompt' }, { status: 400 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // fast & cheap for analysis
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Anthropic error:', err)
      return NextResponse.json({ error: 'AI error' }, { status: 500 })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
