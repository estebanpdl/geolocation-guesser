import { ANALYSIS_FIELDS, NO_CLEAR_INDICATORS, type AnalysisField } from '@/lib/analysis/contract';

/** Provider-neutral output schema; each adapter converts it to its own structured-output format. */
export interface AnalysisOutputSchema {
  type: 'object';
  properties: Record<AnalysisField, { type: 'string'; description: string }>;
  required: AnalysisField[];
  additionalProperties: false;
}

const FIELD_INSTRUCTIONS: Record<AnalysisField, string> = {
  textAndSigns: 'Visible text, road signs, store names or written language, naming the language(s) detected.',
  landmarksAndBuildings: 'Notable structures, architectural styles, building materials and construction patterns.',
  roadAndInfrastructure:
    'Road markings, driving side, road surface, traffic signals, utility poles and street lighting.',
  vehiclesAndPlates: 'Vehicle types, license plate formats and colors, and any visible registration details.',
  vegetationAndTerrain: 'Plant types, climate indicators, terrain features and elevation clues.',
  culturalIndicators: 'Flags, clothing styles, advertisements, religious buildings and other cultural elements.',
  overallAssessment:
    'Best estimate of region or continent, country (with confidence: high, medium or low), city or area if determinable, and the key reasoning.',
};

export const ANALYSIS_SCHEMA: AnalysisOutputSchema = {
  type: 'object',
  properties: Object.fromEntries(
    ANALYSIS_FIELDS.map(({ key }) => [key, { type: 'string', description: FIELD_INSTRUCTIONS[key] }])
  ) as AnalysisOutputSchema['properties'],
  required: ANALYSIS_FIELDS.map(({ key }) => key),
  additionalProperties: false,
};

export const ANALYSIS_PROMPT = `You are an expert OSINT geolocation analyst. Analyze this image and describe the evidence that could help determine where in the world it was taken.

Respond with a single JSON object with exactly these string fields:
${ANALYSIS_FIELDS.map(({ key, label }) => `- "${key}" (${label}): ${FIELD_INSTRUCTIONS[key]}`).join('\n')}

Each field may use short Markdown lists. If you cannot determine anything for a field, use "${NO_CLEAR_INDICATORS}"

Be specific about what you observe. Focus on factual observations rather than speculation; your assessment is a hypothesis to be checked, not established evidence.`;
