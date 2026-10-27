import { GoogleGenerativeAI } from '@google/generative-ai';

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

export async function analyzeImage(base64Data: string, mimeType: string): Promise<SceneAnalysis> {
  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_KEY;
  if (!geminiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_KEY is not set');
  }

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  const result = await model.generateContent([
    ANALYSIS_PROMPT,
    {
      inlineData: {
        data: base64Data,
        mimeType,
      },
    },
  ]);

  const response = result.response;
  const text = response.text();

  return parseAnalysis(text);
}

export async function analyzeScene(lat: number, lng: number, heading: number = 0, pitch: number = 0): Promise<SceneAnalysis> {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!mapsKey) {
    throw new Error('Google Maps API key is not set. Add GOOGLE_MAPS_API_KEY to .env.local');
  }

  // Step 1: Fetch Street View image via Static API
  const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${heading}&pitch=${pitch}&radius=50000&key=${mapsKey}`;

  let imageResponse: Response;
  try {
    imageResponse = await fetch(imageUrl);
  } catch (err) {
    throw new Error(`Network error fetching Street View image: ${err}`);
  }

  if (!imageResponse.ok) {
    const body = await imageResponse.text().catch(() => '');
    throw new Error(
      `Street View Static API returned ${imageResponse.status}: ${body.slice(0, 300)}`
    );
  }

  const contentType = imageResponse.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    const body = await imageResponse.text().catch(() => '');
    throw new Error(
      `Street View Static API returned non-image content-type "${contentType}": ${body.slice(0, 300)}`
    );
  }

  // Step 2: Convert to base64
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');

  if (base64Image.length < 100) {
    throw new Error('Street View image is suspiciously small — possibly an error response');
  }

  // Step 3: Send to Gemini
  return analyzeImage(base64Image, contentType);
}

