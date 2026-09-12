import { headers } from "next/headers";

import { asText, llmsIndex, originFrom } from "../(docs)/llms";

/** The framework's edge and nothing else: read the request's origin, hand it to the builder. */
export async function GET(): Promise<Response> {
  return asText(llmsIndex(originFrom(await headers())));
}
