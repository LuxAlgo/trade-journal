"use client";

import { Suspense, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { AdherenceReport } from "@/components/adherence-report";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatApiError } from "@/lib/api-error";
import { postJson, useApi } from "@/lib/use-api";

interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
  tradeCount: number;
}

export default function PlaybooksPage() {
  return (
    <Suspense>
      <Playbooks />
    </Suspense>
  );
}

function Playbooks() {
  const t = useTranslations("playbooks");
  const tCommon = useTranslations("common");
  // Root-level translator: formatApiError looks up "errors.<code>" itself.
  const tErrors = useTranslations();
  const { data, error, errorInfo, loading, refresh } = useApi<{ playbooks: Playbook[] }>(
    "/api/playbooks",
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [failure, setFailure] = useState("");

  const create = async () => {
    try {
      await postJson("/api/playbooks", {
        name,
        description,
        rules: rules
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
      });
      setOpen(false);
      setName("");
      setDescription("");
      setRules("");
      setFailure("");
      refresh();
    } catch (e) {
      setFailure(formatApiError(t, e));
    }
  };

  return (
    <div>
      <FilterBar
        title={t("title")}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus />
            {t("new")}
          </Button>
        }
      />
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {(error || failure) && (
          <p role="alert" className="col-span-full text-sm text-destructive">
            {error ? formatApiError(tErrors, errorInfo ?? error) : failure}
          </p>
        )}
        {loading && !data && (
          <p
            role="status"
            className="col-span-full py-16 text-center text-sm text-muted-foreground"
          >
            {tCommon("loading.page")}
          </p>
        )}
        {data?.playbooks.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        )}
        {data?.playbooks.map((playbook) => (
          <Card key={playbook.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-foreground text-base font-semibold">
                {playbook.name}
              </CardTitle>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("tradeCount", { count: playbook.tradeCount })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  aria-label={t("deleteAria", { name: playbook.name })}
                  onClick={async () => {
                    // User-written playbook names stay verbatim as a message parameter.
                    if (confirm(t("deleteConfirm", { name: playbook.name }))) {
                      try {
                        await postJson(`/api/playbooks/${playbook.id}`, undefined, "DELETE");
                        setFailure("");
                        refresh();
                      } catch (e) {
                        setFailure(formatApiError(t, e));
                      }
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {playbook.description && (
                <p className="text-sm text-muted-foreground">{playbook.description}</p>
              )}
              {playbook.rules.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {playbook.rules.map((rule, index) => (
                    <li key={index} className="flex min-w-0 gap-2 break-words">
                      <span className="text-muted-foreground">{index + 1}.</span>
                      {rule}
                    </li>
                  ))}
                </ul>
              )}
              <AdherenceReport bookId={playbook.id} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
            <Textarea
              value={rules}
              onChange={(event) => setRules(event.target.value)}
              placeholder={t("rulesPlaceholder")}
              className="min-h-32"
            />
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button onClick={create} disabled={!name}>
              {t("create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
