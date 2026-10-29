/**
 * The two things the agent asks of a model. Tests swap in a scripted object with these same
 * two methods, so no key or network is needed.
 */
import { tool } from "@langchain/core/tools";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatGroq } from "@langchain/groq";
import type { z } from "zod";
import { modelFacingSpecs } from "../tools/index.ts";

export interface ToolRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface Model {
  /** Structured output. Throws if the reply does not match the schema. */
  structured<T>(name: string, schema: z.ZodType<T>, messages: BaseMessage[]): Promise<T>;
  /** One turn of the lookup loop: the model answers or asks for tool calls. */
  toolStep(messages: BaseMessage[]): Promise<{ content: string; toolCalls: ToolRequest[] }>;
}

const MODEL = "openai/gpt-oss-20b";

export class GroqModel implements Model {
  private chat: ChatGroq;

  constructor(apiKey: string | undefined) {
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    this.chat = new ChatGroq({ model: MODEL, apiKey, temperature: 0 });
  }

  async structured<T>(name: string, schema: z.ZodType<T>, messages: BaseMessage[]): Promise<T> {
    return (await this.chat.withStructuredOutput(schema, { name }).invoke(messages)) as T;
  }

  async toolStep(messages: BaseMessage[]) {
    // Only the lookup tools are ever bound. The write tools do not exist as far as the model knows.
    const tools = modelFacingSpecs().map((t) =>
      tool(async () => "", { name: t.name, description: t.description, schema: t.input }),
    );
    const reply = await this.chat.bindTools(tools).invoke(messages);
    return {
      content: typeof reply.content === "string" ? reply.content : JSON.stringify(reply.content),
      toolCalls: (reply.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: c.args })),
    };
  }
}
