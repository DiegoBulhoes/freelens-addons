import type { Tone } from "../../components/status";

export interface Verdict {
  tone: Tone;
  label: string;
  reason: string;
}
