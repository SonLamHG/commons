import { GoogleGenAI, Modality } from '@google/genai';
import type { GeneratedImage, ImageGenerator } from './types.js';

/** Default image model (Nano Banana). Override with COMMONS_IMAGE_MODEL. */
const DEFAULT_MODEL = 'gemini-2.5-flash-image';

export function createImageGenerator(): ImageGenerator {
  return {
    async generate({ prompt, aspectRatio }) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set — cannot generate images.');
      }
      const ai = new GoogleGenAI({ apiKey });
      const model = process.env.COMMONS_IMAGE_MODEL ?? DEFAULT_MODEL;
      const fullPrompt = aspectRatio
        ? `${prompt}\n\n(aspect ratio: ${aspectRatio})`
        : prompt;

      const res = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: { responseModalities: [Modality.IMAGE] },
      });

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const data = part.inlineData?.data;
        if (data) {
          return {
            bytes: Buffer.from(data, 'base64'),
            mime: part.inlineData?.mimeType ?? 'image/png',
          };
        }
      }
      throw new Error('Gemini returned no image data.');
    },
  };
}
