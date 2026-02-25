import { NextRequest, NextResponse } from 'next/server';
import { analyzeScene } from '@/lib/gemini';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lat, lng, heading = 0, pitch = 0 } = body;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'Invalid coordinates' }, { status: 400 });
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_KEY) {
      return NextResponse.json(
        { error: 'AI analysis is not configured. Set GOOGLE_GENERATIVE_AI_KEY.' },
        { status: 503 }
      );
    }

    const analysis = await analyzeScene(lat, lng, heading, pitch);

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('AI analysis error:', err);
    const message = err instanceof Error ? err.message : 'AI analysis failed.';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
