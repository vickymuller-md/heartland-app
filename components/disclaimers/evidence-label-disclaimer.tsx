"use client";

import { Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function EvidenceLabelDisclaimer({
  children,
}: {
  children?: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          children ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" className="gap-1 text-xs" />
          )
        }
      >
        {children ?? (
          <>
            <Info className="h-3 w-3" />
            Evidence classification
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Evidence Classification</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-green-700">Established</p>
            <p className="text-muted-foreground">
              Supported by current guideline recommendations and robust trial
              evidence.
            </p>
          </div>
          <div>
            <p className="font-semibold text-yellow-600">Emerging</p>
            <p className="text-muted-foreground">
              Supported by recent trial evidence with guideline integration
              ongoing.
            </p>
          </div>
          <div>
            <p className="font-semibold text-gray-500">Pragmatic</p>
            <p className="text-muted-foreground">
              Informed by clinical reasoning and evidence synthesis but not yet
              validated as a standalone tool.
            </p>
          </div>
          <p className="text-xs text-muted-foreground border-t pt-3">
            Users should consult current AHA/ACC/HFSA guidelines for
            authoritative recommendations.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
