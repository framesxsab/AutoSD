import { createCitationList } from "../../ui/CitationView.js";
import type { ViewContext, RouterView } from "../router.js";
import { withHeading } from "./shared.js";

export function createResearchView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Research");
  root.appendChild(withHeading("h2", "Research"));

  const form = document.createElement("form");
  const input = document.createElement("input");
  input.type = "search";
  input.setAttribute("aria-label", "Research question");
  input.placeholder = "Ask the corpus…";
  const runBtn = document.createElement("button");
  runBtn.type = "submit";
  runBtn.textContent = "Run research";
  form.appendChild(input);
  form.appendChild(runBtn);
  root.appendChild(form);

  const results = document.createElement("section");
  results.setAttribute("aria-label", "Research results");
  const initial = document.createElement("p");
  initial.setAttribute("role", "status");
  initial.textContent = "Run a query to see grounded results.";
  results.appendChild(initial);
  root.appendChild(results);

  let running = false;

  form.addEventListener("submit", e => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question || running) return;
    running = true;
    runBtn.disabled = true;
    initial.textContent = "Running…";

    void ctx.workflow
      .run({ id: `research-${Date.now()}`, question })
      .then(res => {
        const badge = document.createElement("p");
        badge.setAttribute("role", "status");
        badge.textContent = `Confidence ${Math.round(res.confidence * 100)}% · ${res.citations.length} sources`;
        const answer = document.createElement("p");
        answer.textContent = res.answer;
        results.replaceChildren(
          badge,
          answer,
          createCitationList(res, cit => ctx.announce(`Opened citation ${cit.chunkId}`)),
        );
        ctx.announce(
          `Research complete: ${res.citations.length} citations, confidence ${Math.round(res.confidence * 100)} percent`,
        );
      })
      .catch(() => {
        initial.textContent = "Research failed. Try another question.";
        ctx.announce("Research failed");
      })
      .finally(() => {
        running = false;
        runBtn.disabled = false;
      });
  });

  return {
    root,
    mount(host) {
      host.appendChild(root);
    },
    unmount() {
      root.remove();
    },
  };
}
