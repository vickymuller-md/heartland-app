"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface ConsentDialogProps {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function ConsentDialog({ open, onAccept, onCancel }: ConsentDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      onCancel();
      setAcknowledged(false);
    }
  }

  function handleAccept() {
    onAccept();
    setAcknowledged(false);
  }

  function handleCancel() {
    onCancel();
    setAcknowledged(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Informed Consent</DialogTitle>
          <DialogDescription>
            Please read the following disclaimers carefully before creating your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground">
          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground mb-1">Clinical Decision Support Disclaimer</p>
            <p>
              This tool is designed for healthcare professionals as a clinical decision support
              resource. It does not provide medical diagnoses, treatment recommendations for
              individual patients, or replace clinical judgment. Not intended for direct patient
              care. For professional use only.
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground mb-1">Risk Stratification Framework Disclaimer</p>
            <p>
              The HEARTLAND Risk Stratification Framework is a proposed tool under development. It
              has not been validated against clinical outcomes data. Formal validation through
              registry data is a defined research objective.
            </p>
          </div>

          <div className="rounded-lg border p-3">
            <p className="font-medium text-foreground mb-1">Data and Privacy Notice</p>
            <p>
              By creating an account, you acknowledge that this application is a research and
              demonstration tool. Data entered is stored on secure servers but this system has not
              undergone HIPAA certification. Do not enter real patient identifiable information.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 pt-2">
          <Checkbox
            id="consent-checkbox"
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          <Label htmlFor="consent-checkbox" className="text-sm leading-normal font-normal cursor-pointer">
            I have read and understand the above disclaimers
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleAccept} disabled={!acknowledged}>
            Accept and Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
