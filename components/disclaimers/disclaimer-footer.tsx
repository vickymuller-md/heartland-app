export function DisclaimerFooter() {
  return (
    <footer className="border-t bg-muted/50 px-4 py-3 text-xs text-muted-foreground print:hidden">
      <div className="mx-auto max-w-5xl">
        <p>
          Public tools are an educational sandbox; authenticated workspaces are
          controlled evaluation only. Outputs do not independently diagnose,
          prescribe, establish billing eligibility, replace source-record review,
          clinical judgment, or institutional policy. Real PHI and unsupervised
          clinical use are not authorized until organizational release gates are approved.
        </p>
      </div>
    </footer>
  );
}
