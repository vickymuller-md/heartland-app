export function DisclaimerFooter() {
  return (
    <footer className="border-t bg-muted/50 px-4 py-3 text-xs text-muted-foreground print:hidden">
      <div className="mx-auto max-w-5xl">
        <p>
          This application is a clinical decision support tool designed
          exclusively for healthcare professionals. It does not provide medical
          diagnoses, individual treatment recommendations, or replace clinical
          judgment. Not intended for direct patient care or use by patients. For
          professional use only.
        </p>
      </div>
    </footer>
  );
}
