import type { Triage } from "../src/agent/types.ts";

export interface TriageEvalCase {
  id: string;

  input: {
    from_email: string;
    subject: string;
    body: string;
  };

  expected: {
    category: Triage["category"];
  };

  tags: string[];
}