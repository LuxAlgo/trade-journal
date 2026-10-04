"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { ManualTradeEntry } from "./manual-trade-entry";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export function AddTradeDialog({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations("manual-entry");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" />
          {t("addTrade")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("addTrade")}</DialogTitle>
          <DialogDescription>{t("addTradeDescription")}</DialogDescription>
        </DialogHeader>
        <ManualTradeEntry
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
