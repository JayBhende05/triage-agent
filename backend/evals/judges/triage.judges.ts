import { z } from "zod";
import { Model } from "../../src/agent/model";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const TriageJudgeSchema = z.object({
  accuracy: z.object({
    score: z.number().int().min(1).max(5),
    reason: z.string(),
  }),

  faithfulness: z.object({
    score: z.number().int().min(1).max(5),
    reason: z.string(),
  }),

  completeness: z.object({
    score: z.number().int().min(1).max(5),
    reason: z.string(),
  }),
});

export type TriageJudgeResult = z.infer<
  typeof TriageJudgeSchema
>;


export const TRIAGE_JUDGE_PROMPT = `
You are an evaluator assessing the quality of an AI customer
support triage agent.

Your task is to evaluate the generated summary against the
original customer message.

Evaluate three dimensions:

1. Accuracy:
   Does the summary correctly represent what the customer
   is asking or reporting?

2. Faithfulness:
   Does the summary contain only information supported by
   the customer's message?
   Penalize invented details and assumptions.

3. Completeness:
   Does the summary capture the important details and
   intent of the customer's message?

Scoring rubric for each dimension:

5 = Excellent. Fully satisfies the criterion.
4 = Good. Minor issue, but meaning is preserved.
3 = Acceptable. Some important detail is missing or unclear.
2 = Poor. Significant inaccuracies or omissions.
1 = Very poor. Misrepresents the customer's message.

Rules:
- Evaluate only the information provided.
- Do not reward a summary for sounding professional.
- Do not assume facts that are not in the input.
- Be objective and explain each score briefly.
- Return scores according to the provided structured schema.
`;



export function judgeTriageSummary(
  model: Model,
  input: {
    from_email: string,
    subject: string,
    body: string
  },
  prediction: {
    category: string,
    summart: string
  }
): Promise<TriageJudgeResult> {

  const messages = [
    new SystemMessage(TRIAGE_JUDGE_PROMPT),
    new HumanMessage(`
Customer message:
${JSON.stringify(input, null, 2)}

Agent prediction:
${JSON.stringify(prediction, null, 2)}

Evaluate the agent's summary.
    `),
  ];

  return model.structured(
    "triage_summary_judge",
    TriageJudgeSchema,
    messages
  );
}