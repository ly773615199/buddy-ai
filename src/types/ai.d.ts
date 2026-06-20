declare module 'ai' {
  export function generateText(options: any): Promise<any>;
  export function streamText(options: any): any;
  export function generateObject(options: any): Promise<any>;
  export function streamObject(options: any): any;
  export function tool(config: any): any;
  export function stepCountIs(n: number): any;
  export function cosineSimilarity(a: number[], b: number[]): number;
  export const experimental_generateSpeech: any;
  export const experimental_transcribe: any;
  export type LanguageModel = any;
  export type ToolSet = any;
  export type ModelMessage = any;
}
