const AI_MODEL = 'gemini-3.1-pro-preview';
const AI_ENDPOINT = '/api/ai/generate';
const isBrowserRuntime = typeof window !== 'undefined';

export const JsonType = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  NUMBER: 'NUMBER',
} as const;

export interface ProxyGenerateRequest {
  prompt: string;
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

const getNodeClient = async () => {
  if (isBrowserRuntime) return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY not found in environment.');
    return null;
  }
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey });
};

export const withRetry = async <T>(operation: () => Promise<T>, maxRetries = 3, delayMs = 2000): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      const isTransient =
        error?.message?.includes("Model isn't available right now") ||
        error?.message?.includes('503') ||
        error?.message?.includes('429') ||
        error?.status === 503 ||
        error?.status === 429;

      if (isTransient && i < maxRetries - 1) {
        console.warn(`Gemini API transient error. Retrying in ${delayMs}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries reached');
};

export const callAiModel = async (request: ProxyGenerateRequest): Promise<{ text: string }> => {
  const model = request.model || AI_MODEL;

  if (isBrowserRuntime) {
    return withRetry(async () => {
      let response: Response;
      try {
        response = await fetch(AI_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, model }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          message.includes('Failed to fetch')
            ? 'Unable to reach the AI service. Restart the integrated app server with `npm run dev` and try again.'
            : message
        );
      }

      const rawPayload = await response.text().catch(() => '');
      let payload: Record<string, unknown> = {};
      if (rawPayload) {
        try {
          payload = JSON.parse(rawPayload);
        } catch {
          payload = { error: rawPayload };
        }
      }

      if (!response.ok) {
        const serverError = typeof payload?.error === 'string' ? payload.error : '';
        if (response.status === 404) {
          throw new Error('AI endpoint is unavailable. The app is probably running without the integrated Node server. Restart with `npm run dev`.');
        }
        throw new Error(serverError || `AI proxy request failed (${response.status})`);
      }
      return { text: String(payload?.text || '') };
    });
  }

  const ai = await getNodeClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY not found in environment.');
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: { parts: [{ text: request.prompt }] },
      config: {
        ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.responseMimeType ? { responseMimeType: request.responseMimeType } : {}),
        ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
      },
    })
  );

  return { text: response.text || '' };
};

export const formatAiServiceError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  if (!message) {
    return 'AI service error: Unknown failure while generating the response.';
  }

  if (message.includes('Unable to reach the AI service')) {
    return message;
  }

  if (message.includes('AI endpoint is unavailable')) {
    return message;
  }

  if (message.includes('AI service is not configured on the server') || message.includes('GEMINI_API_KEY')) {
    return 'AI service is not configured on the server. Add `GEMINI_API_KEY` to `.env.local`, restart `npm run dev`, and try again.';
  }

  return `AI service error: ${message}`;
};
