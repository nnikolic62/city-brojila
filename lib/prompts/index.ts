import { PROMPT_V1 } from "./v1";

export const PROMPTS = { v1: PROMPT_V1 } as const;
export type PromptVersion = keyof typeof PROMPTS;
