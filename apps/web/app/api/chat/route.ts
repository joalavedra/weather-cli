import { deepseek } from "@ai-sdk/deepseek";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { UIMessage } from "ai";
import { brokerTools } from "@/lib/tools";
import { BROKER_SYSTEM_PROMPT } from "@/lib/system-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: deepseek("deepseek-chat"),
    system: BROKER_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: brokerTools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
