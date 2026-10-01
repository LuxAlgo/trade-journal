import { requireValue } from "./api";

/** A 400 with the problem a `…Problem()` validator reported, if any. */
export function requireNoProblem(problem: string | null): void {
  requireValue(!problem, problem ?? "");
}
