import { listBrokers } from "@/server/sync";
import { handler, ok } from "@/server/api";

/** Broker roster straight from @luxalgo/broker-sdk — the connect form renders itself. */
export const GET = handler(() => ok({ brokers: listBrokers() }));
