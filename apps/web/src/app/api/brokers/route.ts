import { brokerRoster } from "@/server/sync";
import { handler, ok } from "@/server/api";

/** Broker roster from the SDK, with current Trading 212 credential fields. */
export const GET = handler(() => ok({ brokers: brokerRoster() }));
