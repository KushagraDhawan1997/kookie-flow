import { headers } from "next/headers";

import { asText, llmsFull, originFrom } from "../(docs)/llms";

export async function GET(): Promise<Response> {
  return asText(llmsFull(originFrom(await headers())));
}
