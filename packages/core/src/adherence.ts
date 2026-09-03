import type { AnnotatedTrade } from "./types";
import { summarizeGroup } from "./analysis";

export interface RuleAssessment {
  tradeKey: string;
  playbookId: string;
  rule: string;
  followed: boolean;
}

/** Index assessments once instead of repeatedly searching every trade/check pair. */
export function analyzeAdherence(
  trades: AnnotatedTrade[],
  books: { id: string; rules: string[] }[],
  checks: RuleAssessment[],
) {
  const tradesByBook = new Map<string, AnnotatedTrade[]>();
  for (const trade of trades) {
    const id = trade.annotations?.playbook;
    if (!id || trade.status === "open") continue;
    const group = tradesByBook.get(id) ?? [];
    group.push(trade);
    tradesByBook.set(id, group);
  }
  const checksByBook = new Map<string, Map<string, Map<string, boolean>>>();
  for (const check of checks) {
    const book = checksByBook.get(check.playbookId) ?? new Map<string, Map<string, boolean>>();
    const trade = book.get(check.tradeKey) ?? new Map<string, boolean>();
    trade.set(check.rule, check.followed);
    book.set(check.tradeKey, trade);
    checksByBook.set(check.playbookId, book);
  }
  return books.map((book) => {
    const ts = tradesByBook.get(book.id) ?? [];
    const rules = [...new Set(book.rules)].map((rule) => ({
      rule,
      followed: [] as AnnotatedTrade[],
      broken: [] as AnnotatedTrade[],
    }));
    const followed: AnnotatedTrade[] = [],
      broken: AnnotatedTrade[] = [];
    let evaluated = 0,
      positive = 0;
    for (const trade of ts) {
      const assessed = checksByBook.get(book.id)?.get(trade.key);
      let complete = rules.length > 0,
        hasBroken = false;
      for (const rule of rules) {
        const result = assessed?.get(rule.rule);
        if (result === undefined) {
          complete = false;
          continue;
        }
        evaluated++;
        if (result) {
          positive++;
          rule.followed.push(trade);
        } else {
          hasBroken = true;
          rule.broken.push(trade);
        }
      }
      if (hasBroken) broken.push(trade);
      else if (complete) followed.push(trade);
    }
    return {
      id: book.id,
      total: ts.length,
      evaluated,
      possible: ts.length * rules.length,
      rate: evaluated ? positive / evaluated : null,
      accountIds: [...new Set(ts.map((t) => t.accountId))],
      followed: summarizeGroup(followed),
      broken: summarizeGroup(broken),
      unassessed: ts.length - followed.length - broken.length,
      rules: rules.map((rule) => ({
        rule: rule.rule,
        evaluated: rule.followed.length + rule.broken.length,
        rate:
          rule.followed.length + rule.broken.length
            ? rule.followed.length / (rule.followed.length + rule.broken.length)
            : null,
        followed: summarizeGroup(rule.followed),
        broken: summarizeGroup(rule.broken),
      })),
    };
  });
}
