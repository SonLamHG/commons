export interface GeneratedImage {
  bytes: Buffer;
  mime: string; // e.g. 'image/png'
}

export interface ImageGenerator {
  generate(opts: {
    prompt: string;
    aspectRatio?: '1:1' | '16:9' | '9:16';
  }): Promise<GeneratedImage>;
}
