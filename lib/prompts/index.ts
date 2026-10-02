import { PROMPT_V1 } from "./v1";
import { PROMPT_V2 } from "./v2";
import { PROMPT_V3 } from "./v3";
import { PROMPT_V4 } from "./v4";
import { PROMPT_V5 } from "./v5";
import { PROMPT_V6 } from "./v6";

export const PROMPTS = {
  v1: PROMPT_V1,
  v2: PROMPT_V2,
  v3: PROMPT_V3,
  v4: PROMPT_V4,
  v5: PROMPT_V5,
  v6: PROMPT_V6,
} as const;
export type PromptVersion = keyof typeof PROMPTS;
