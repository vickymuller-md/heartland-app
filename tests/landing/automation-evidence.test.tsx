import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationEvidence } from "@/components/landing/automation-evidence";
import { EvidenceFoundation } from "@/components/landing/evidence";
import Home, { metadata } from "@/app/page";
import { APP_VERSION } from "@/lib/app-version";
import * as population from "@/lib/sandbox/population";

const { getUser, createClient, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("landing evidence walkthrough", () => {
  it("renders five ordered, named native disclosures without client JavaScript", () => {
    const { container } = render(<AutomationEvidence />);
    const steps = within(screen.getByTestId("synthetic-walkthrough")).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    ["Collection", "Record", "Signal", "Human review", "Documented outcome"].forEach((title, index) => {
      expect(steps[index].querySelector("summary")).toHaveTextContent(title);
      expect(steps[index].querySelector("details")).not.toBeNull();
    });
    expect(container.querySelectorAll("details")).toHaveLength(5);
    expect(renderToStaticMarkup(<AutomationEvidence />)).toContain("Not recorded");
  });

  it("opens and closes an explanation without changing other steps or producing effects", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<AutomationEvidence />);
    const details = container.querySelectorAll("details");
    const user = userEvent.setup();
    expect(details[0]).toHaveAttribute("open");
    await user.click(details[1].querySelector("summary")!);
    expect(details[1]).toHaveAttribute("open");
    expect(details[0]).toHaveAttribute("open");
    await user.click(details[1].querySelector("summary")!);
    expect(details[1]).not.toHaveAttribute("open");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(container.querySelector("form, input, audio, video, iframe")).toBeNull();
  });

  it("preserves native disclosure semantics and document order", () => {
    const { container } = render(<AutomationEvidence />);
    expect(container.querySelectorAll("summary")).toHaveLength(5);
    for (const summary of container.querySelectorAll("summary")) {
      expect(summary.parentElement?.tagName).toBe("DETAILS");
      expect(summary.parentElement?.firstElementChild).toBe(summary);
      expect(summary).not.toHaveAttribute("tabindex", "-1");
      expect(summary).not.toHaveAttribute("role");
    }
    // user-event's focus selector omits summary; native Tab/Enter/Space are checked in a real browser.
  });

  it("keeps release, simulation and local candidate labels outside disclosures", () => {
    render(<AutomationEvidence />);
    for (const label of ["Published release · v1.9.0", "Synthetic walkthrough · No clinical care", "Local candidate · Not deployed"]) {
      const element = screen.getByText(label);
      expect(element).toBeVisible();
      expect(element.closest("details")).toBeNull();
    }
  });

  it("does not turn the candidate into a public laboratory action", () => {
    render(<AutomationEvidence />);
    const candidate = screen.getByTestId("local-candidate");
    expect(candidate).toHaveTextContent("Laboratory submission recovery");
    expect(candidate).toHaveTextContent("not available in the public sandbox");
    expect(candidate).toHaveTextContent("Not recorded");
    expect(candidate).toHaveTextContent("Acknowledgment is not clinical review");
    expect(candidate.querySelector("a, button, form, input")).toBeNull();
  });

  it("preserves all nine capability groups and the synthetic sandbox destination", () => {
    render(<AutomationEvidence />);
    const map = screen.getByTestId("published-capabilities");
    expect(within(map).getAllByRole("article")).toHaveLength(9);
    for (const label of ["Command Center + Impact", "Outreach + Daily Loop + Patient 360", "Patient Today", "Provider copilot", "Assisted SBAR", "Pathways + Coordination", "Safety + Evidence Flow", "Protocol guide", "Explain this result"]) {
      expect(within(map).getByText(label)).toBeVisible();
    }
    expect(screen.getByRole("link", { name: /Open the Evidence Lab/ })).toHaveAttribute("href", "/sandbox");
  });

  it("distinguishes language, rules and people, and does not imply a completed real contact", () => {
    render(<AutomationEvidence />);
    const roles = screen.getByTestId("responsibility-layers");
    for (const label of ["AI language", "Registered rules", "Human review"]) expect(within(roles).getByText(label)).toBeVisible();
    expect(screen.getByTestId("synthetic-walkthrough")).toHaveTextContent("No real contact, delivery or clinical benefit is demonstrated");
    expect(screen.getByText(/Do not enter real patient, personal, or health information/)).toBeVisible();
  });
});

describe("clinical reading list", () => {
  it("links five specific studies and limits their relevance to clinical context", () => {
    render(<EvidenceFoundation />);
    const references = screen.getByRole("region", { name: "Clinical context, not product validation" });
    const links = within(references).getAllByRole("link");
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "https://doi.org/10.1056/NEJMoa2107038",
      "https://doi.org/10.1056/NEJMoa2407107",
      "https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2817466",
      "https://pubmed.ncbi.nlm.nih.gov/36356631/",
      "https://pubmed.ncbi.nlm.nih.gov/30153985/",
    ]);
    expect(references).toHaveTextContent("did not evaluate the HEARTLAND App or its AI");
    expect(references).not.toHaveTextContent(/53%|proves both safe|30%|71 citations|highest-quality/);
  });
});

// This exercises the resolved server function, not Next's RSC transport or hosted auth.
describe("composed public home", () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: null } });
    createClient.mockReset().mockResolvedValue({ auth: { getUser } });
    redirect.mockReset().mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
  });

  it("preserves the seven-section composition and all educational capabilities", async () => {
    const { container } = render(await Home());
    expect(createClient).toHaveBeenCalledOnce();
    expect(getUser).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelectorAll("main > section")).toHaveLength(7);
    const modules = screen.getByRole("region", { name: "Eight modules, one shared protocol." });
    expect(within(modules).getAllByRole("article")).toHaveLength(8);
    expect(within(modules).getAllByText("Educational module")).toHaveLength(8);
    expect(within(screen.getByTestId("published-capabilities")).getAllByRole("article")).toHaveLength(9);
    expect(container.querySelectorAll("details")).toHaveLength(5);
    for (const label of ["Published release · v1.9.0", "Synthetic walkthrough · No clinical care", "Local candidate · Not deployed"]) {
      expect(screen.getByText(label).closest("details")).toBeNull();
    }
  });

  it("keeps authenticated visitors on the existing dashboard redirect", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "test-user" } } });
    await expect(Home()).rejects.toThrow("redirect:/dashboard");
    expect(getUser).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });

  it("uses the real seeded scenario and labels overlapping counts without claiming resolution", async () => {
    const day = population.simulatePopulationDay(2500, 0);
    const simulate = vi.spyOn(population, "simulatePopulationDay");
    render(await Home());
    expect(simulate).toHaveBeenCalledWith(2500, 0);
    const scale = screen.getByRole("region", { name: "Explore scale. Keep the unknowns visible." });
    for (const [label, count] of [
      ["Synthetic check-ins", day.counts.total],
      ["Review queue reported by this scenario", day.counts.reviewQueue],
      ["Unanswered after simulated retry", day.counts.unresolvedNoAnswer],
    ] as const) {
      expect(within(scale).getByRole("article", { name: label })).toHaveTextContent(new Intl.NumberFormat("en-US").format(count));
    }
    expect(scale).toHaveTextContent("Counts overlap and must not be added together");
    expect(scale).toHaveTextContent("Being outside the queue does not mean a case was resolved");
    expect(scale).toHaveTextContent("does not demonstrate completed clinical reviews");
    expect(scale).not.toHaveTextContent(/98\.1%|resolved by|One clinician|Every decision/);
    expect(scale).toHaveTextContent("not a clinical outcome, staffing estimate or coverage guarantee");
  });

  it("separates published article, toolkit and software in the mounted footer and metadata", async () => {
    const { container } = render(await Home());
    const footer = within(container.querySelector("footer")!);
    for (const [label, href] of [
      ["Peer-reviewed protocol article", "https://doi.org/10.7759/cureus.104817"],
      ["Implementation Toolkit · v3.3", "https://doi.org/10.5281/zenodo.19101219"],
      [`App software archive · ${APP_VERSION}`, "https://doi.org/10.5281/zenodo.22233054"],
      ["OSF deposit", "https://doi.org/10.17605/OSF.IO/YUSGH"],
      ["ORCID profile", "https://orcid.org/0009-0009-1099-5690"],
    ]) expect(footer.getByRole("link", { name: label })).toHaveAttribute("href", href);
    expect(footer.getByRole("link", { name: /Software Heritage · historical snapshot/ })).toHaveAttribute("href", "https://archive.softwareheritage.org/swh:1:snp:3e39be4952047172a2c1a131c2965bd580a6dc69/");
    expect(container.querySelector('a[href="https://www.cureus.com/"], a[href="https://www.medrxiv.org/"]')).toBeNull();
    expect(footer.getByText(/does not archive the local candidate/)).toBeVisible();
    expect(metadata.title).toContain(`HEARTLAND App ${APP_VERSION}`);
    expect(metadata.description).toContain("educational implementation companion");
    expect(metadata.description).toContain("synthetic");
    expect(screen.getByText(/Peer review applies to the protocol article/)).toBeVisible();
  });

  it("preserves existing navigation, CTA identifiers and all eight network destinations", async () => {
    const { container } = render(await Home());
    for (const id of ["start-sandbox", "start-sandbox-primary"]) {
      expect(container.querySelector(`[data-landing-cta="${id}"]`)).toHaveAttribute("href", "/sandbox");
    }
    const footer = within(container.querySelector("footer")!);
    for (const href of ["/sandbox", "/request-access", "/login", "/register?mode=tester", "/about"]) {
      expect(footer.getAllByRole("link").some(link => link.getAttribute("href") === href)).toBe(true);
    }
    const network = screen.getByRole("navigation", { name: "HEARTLAND network" });
    expect(within(network).getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "https://heartlandprotocol.org", "https://app.heartlandprotocol.org", "https://scoring.heartlandprotocol.org", "https://guide.heartlandprotocol.org", "https://atlas.heartlandprotocol.org", "https://redcap.heartlandprotocol.org", "https://synthetic.heartlandprotocol.org", "https://fhir.heartlandprotocol.org",
    ]);
    expect(within(network).getByRole("link", { name: "App" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps clinical, evaluation and export boundaries without promotional shortcuts", async () => {
    const { container } = render(await Home());
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("has not been validated against clinical outcomes data");
    expect(main).toHaveTextContent("does not resolve medical-device classification");
    expect(main).toHaveTextContent("Real PHI and unsupervised clinical use are not authorized");
    expect(main).toHaveTextContent("A request is not authorization for clinical use");
    expect(main).toHaveTextContent("do not independently establish de-identification or HIPAA compliance");
    expect(main).not.toHaveTextContent(/86%|\+53%|< 1%|\$15\/month|safe up-titration|Available now|complete provider workflow instantly|Request a clinical workspace/);
    expect(container.querySelector("form, input, audio, video, iframe")).toBeNull();
  });
});
