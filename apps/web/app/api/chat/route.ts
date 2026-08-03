import { deepseek } from "@ai-sdk/deepseek";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import type { UIMessage } from "ai";
import { brokerTools } from "@/lib/tools";
import { BROKER_SYSTEM_PROMPT } from "@/lib/system-prompt";
import { getClient } from "@/lib/clients";

export const runtime = "nodejs";
export const maxDuration = 60;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Tell the assistant which client the broker is looking at.
 *
 * Without this it re-asks for the location and peril that are already on screen,
 * which reads as though the two halves of the app aren't talking to each other.
 */
async function clientContext(clientId: string | undefined): Promise<string> {
  if (!clientId) return "";
  try {
    const client = await getClient(clientId);
    const months =
      client.months.length > 0
        ? client.months.map((m) => MONTH_NAMES[m - 1]).join(", ")
        : "year-round";
    return [
      "\n\n# The client on screen",
      `The broker is currently looking at **${client.name}** — premises at ${client.premises}, exposed to ${client.peril} over ${months}.`,
      client.datasetId
        ? `Their revenue is uploaded as dataset \`${client.datasetId}\`; use it rather than asking for figures.`
        : "They have not uploaded revenue yet, so nothing can be measured until they do.",
      "Take these as given. Don't ask for them again.",
    ].join("\n");
  } catch {
    return "";
  }
}

export async function POST(req: Request): Promise<Response> {
  const { messages, clientId }: { messages: UIMessage[]; clientId?: string } = await req.json();

  const result = streamText({
    model: deepseek("deepseek-chat"),
    system: BROKER_SYSTEM_PROMPT + (await clientContext(clientId)),
    messages: await convertToModelMessages(messages),
    tools: brokerTools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
