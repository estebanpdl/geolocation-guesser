import { NextRequest, NextResponse } from 'next/server';
import { analyzeImage } from '@/lib/gemini';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BASE64_LENGTH = 14_000_000; // ~10MB raw

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, mimeType } = body;

    if (!image || typeof image !== 'string') {
      return NextResponse.json({ error: 'Missing image data' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { error: `Invalid mime type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (image.length > MAX_BASE64_LENGTH) {
      return NextResponse.json({ error: 'Image too large (max ~10MB)' }, { status: 400 });
    }

    if (!process.env.GOOGLE_GENERATIVE_AI_KEY) {
      return NextResponse.json(
        { error: 'AI analysis is not configured. Set GOOGLE_GENERATIVE_AI_KEY.' },
        { status: 503 }
      );
    }

    const analysis = await analyzeImage(image, mimeType);

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('AI analysis upload error:', err);
    const message = err instanceof Error ? err.message : 'AI analysis failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
