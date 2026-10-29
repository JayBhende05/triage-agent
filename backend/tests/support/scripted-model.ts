import type { BaseMessage } from "@langchain/core/messages";
import type { z } from "zod";
import type { Model, ToolRequest } from "../../src/agent/model.ts";

export interface ToolStep {
  content?: string;
  toolCalls?: ToolRequest[];
}

export interface Script {
  triage?: unknown[];
  propose?: unknown[];
  tools?: ToolStep[];
}

/**
 * A fake model with the same two methods the agent calls. Each call takes the next scripted
 * answer. Structured answers go through the real Zod schema, so a bad one fails like a real
 * bad reply would. An Error in the script is thrown (a provider outage).
 */
export class ScriptedModel implements Model {
  calls: string[] = [];
  seen: BaseMessage[][] = [];

  constructor(private script: Script = {}) {}

  async structured<T>(name: string, schema: z.ZodType<T>, messages: BaseMessage[]): Promise<T> {
    this.calls.push(name);
    this.seen.push(messages);
    const next = (this.script as Record<string, unknown[] | undefined>)[name]?.shift();
    if (next === undefined) throw new Error(`model call "${name}" was not scripted`);
    if (next instanceof Error) throw next;
    return schema.parse(next);
  }

  async toolStep(messages: BaseMessage[]) {
    this.calls.push("tools");
    this.seen.push(messages);
    const next = this.script.tools?.shift();
    if (next === undefined) throw new Error("model call \"tools\" was not scripted");
    return { content: next.content ?? "", toolCalls: next.toolCalls ?? [] };
  }
}

export const lookup = (name: "lookup_customer" | "lookup_order", args: object, id = `c_${Math.random()}`): ToolRequest => ({
  id,
  name,
  args,
});
