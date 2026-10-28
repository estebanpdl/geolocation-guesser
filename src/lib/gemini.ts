import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from '@google/generative-ai';
import { ApiError } from '@/lib/server/api-error';
import { abortError } from '@/lib/server/deadline';
import { ANALYSIS_LIMITS } from '@/lib/server/limits';

export const GEMINI_MODEL = 'gemini-flash-latest';

const ANALYSIS_PROMPT = `You are an expert OSINT geolocation analyst. Analyze this Google Street View location image and provide a structured analysis to help determine where in the world this location might be.

Provide your analysis in the following categories. For each category, list specific observations. If you cannot determine anything for a category, say "No clear indicators."

**Text & Signs**: Any visible text, road signs, store names, or written language. Note the language(s) detected.

**Landmarks & Buildings**: Notable structures, architectural styles, building materials, and construction patterns.

**Road & Infrastructure**: Road markings, driving side (left/right), road surface quality, traffic signals, utility poles, street lighting.

**Vehicles & License Plates**: Vehicle types, license plate formats/colors, any visible registration details.

**Vegetation & Terrain**: Plant types, climate indicators, terrain features, elevation clues.

**Cultural Indicators**: Flags, clothing styles, advertisements, religious buildings, cultural elements.

**Overall Assessment**: Based on all observations, provide your best estimate of:
- Region/continent
- Country (with confidence: high/medium/low)
- City or area (if determinable)
- Key reasoning for your assessment

Be specific about what you observe. Focus on factual observations rather than speculation.`;

export interface SceneAnalysis {
  textAndSigns: string;
  landmarksAndBuildings: string;
  roadAndInfrastructure: string;
  vehiclesAndPlates: string;
  vegetationAndTerrain: string;
  culturalIndicators: string;
  overallAssessment: string;
  rawResponse: string;
}

export function parseAnalysis(text: string): SceneAnalysis {
  const sections: Record<string, string> = {};
  const sectionNames = [
    'Text & Signs',
    'Landmarks & Buildings',
    'Road & Infrastructure',
    'Vehicles & License Plates',
    'Vegetation & Terrain',
    'Cultural Indicators',
    'Overall Assessment',
  ];

  let currentSection = '';
  const lines = text.split('\n');

  for (const line of lines) {
    const matchedSection = sectionNames.find(
      (name) => line.includes(`**${name}**`) || line.toLowerCase().includes(name.toLowerCase())
    );
    if (matchedSection) {
      currentSection = matchedSection;
      // Get content after the header on the same line
      const afterHeader = line.replace(/\*\*[^*]+\*\*:?\s*/, '').trim();
      if (afterHeader) {
        sections[currentSection] = afterHeader;
      } else {
        sections[currentSection] = '';
      }
    } else if (currentSection && line.trim()) {
      sections[currentSection] = sections[currentSection]
        ? sections[currentSection] + '\n' + line.trim()
        : line.trim();
    }
  }

  return {
    textAndSigns: sections['Text & Signs'] || 'No analysis available',
    landmarksAndBuildings: sections['Landmarks & Buildings'] || 'No analysis available',
    roadAndInfrastructure: sections['Road & Infrastructure'] || 'No analysis available',
    vehiclesAndPlates: sections['Vehicles & License Plates'] || 'No analysis available',
    vegetationAndTerrain: sections['Vegetation & Terrain'] || 'No analysis available',
    culturalIndicators: sections['Cultural Indicators'] || 'No analysis available',
    overallAssessment: sections['Overall Assessment'] || 'No analysis available',
    rawResponse: text,
  };
}

export interface InferenceOptions {
  apiKey: string;
  /** Aborts the provider call; aborting does not cancel work already billed upstream. */
  signal: AbortSignal;
}

/**
 * Sends one image plus the analysis prompt to Gemini as a single request.
 * The SDK performs no automatic retries; failures map to safe ApiErrors
 * without provider messages, which can echo request details.
 */
export async function analyzeImage(
  image: { bytes: Uint8Array; mimeType: string },
  { apiKey, signal }: InferenceOptions
): Promise<SceneAnalysis> {
  if (signal.aborted) throw abortError(signal);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { maxOutputTokens: ANALYSIS_LIMITS.MAX_OUTPUT_TOKENS },
  });

  let text: string;
  try {
    const result = await model.generateContent(
      [
        ANALYSIS_PROMPT,
        { inlineData: { data: Buffer.from(image.bytes).toString('base64'), mimeType: image.mimeType } },
      ],
      { signal }
    );
    text = result.response.text();
  } catch (err) {
    throw providerError(err, signal);
  }

  if (!text.trim()) {
    throw new ApiError(502, 'empty_output', 'The AI provider returned no analysis.');
  }
  if (text.length > ANALYSIS_LIMITS.MAX_OUTPUT_CHARS) {
    throw new ApiError(502, 'output_too_large', 'The AI provider returned an oversized analysis.');
  }
  return parseAnalysis(text);
}

function providerError(err: unknown, signal: AbortSignal): ApiError {
  if (signal.aborted) return abortError(signal);
  if (err instanceof GoogleGenerativeAIResponseError) {
    return new ApiError(422, 'analysis_refused', 'The AI provider declined to analyze this image.');
  }
  if (err instanceof GoogleGenerativeAIFetchError) {
    const upstreamStatus = err.status;
    if (upstreamStatus === 429) {
      return new ApiError(429, 'provider_quota', 'The AI provider is rate limited or out of quota. Try again later.', { upstreamStatus });
    }
    if (upstreamStatus === 400 || upstreamStatus === 401 || upstreamStatus === 403) {
      return new ApiError(502, 'provider_rejected', 'The AI provider rejected the request.', { upstreamStatus });
    }
    return new ApiError(502, 'provider_error', 'The AI provider failed to respond.', { upstreamStatus });
  }
  return new ApiError(502, 'provider_error', 'The AI provider failed to respond.');
}
