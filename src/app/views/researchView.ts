import { createCitationList } from "../../ui/CitationView.js";
import type { RetrievalMode } from "../../retrieval/pipeline.js";
import type { ViewContext, RouterView } from "../router.js";
import { withHeading } from "./shared.js";

export function createResearchView(ctx: ViewContext): RouterView {
  const root = document.createElement("section");
  root.setAttribute("aria-label", "Research");
  root.appendChild(withHeading("h2", "Research"));

  const form = document.createElement("form");
  form.className = "autosd-search-form";
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

  const optionsBar = document.createElement("div");
  optionsBar.className = "autosd-toolbar";
  optionsBar.setAttribute("role", "group");
  optionsBar.setAttribute("aria-label", "Research query options");

  const scopeSelect = document.createElement("select");
  scopeSelect.setAttribute("aria-label", "Scope to corpus document");

  const modeSelect = document.createElement("select");
  modeSelect.setAttribute("aria-label", "Research retrieval mode");
  for (const [value, text] of [
    ["default", "Mode: Default"],
    ["hybrid", "Mode: Hybrid"],
    ["bm25", "Mode: BM25"],
    ["vector", "Mode: Vector"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    modeSelect.appendChild(opt);
  }

  optionsBar.append(scopeSelect, modeSelect);
  root.appendChild(optionsBar);

  const results = document.createElement("section");
  results.className = "autosd-results-panel";
  results.setAttribute("aria-label", "Research results");
  const initial = document.createElement("p");
  initial.setAttribute("role", "status");
  initial.textContent = "Run a query to see grounded results.";
  results.appendChild(initial);
  root.appendChild(results);

  const refreshScope = (): void => {
    const prev = scopeSelect.value || "all";
    scopeSelect.replaceChildren();
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All corpus documents";
    scopeSelect.appendChild(allOpt);
    for (const doc of ctx.workflow.listDocuments()) {
      const opt = document.createElement("option");
      opt.value = doc.id;
      opt.textContent = doc.path ?? doc.id;
      scopeSelect.appendChild(opt);
    }
    const stillExists = Array.from(scopeSelect.options).some(o => o.value === prev);
    scopeSelect.value = stillExists ? prev : "all";
  };

  let running = false;
  let unsubscribeSync: (() => void) | undefined;
  let queryTimestamps: number[] = [];
  const MAX_QUERY_CHARS = 500;
  const MAX_QUERIES_PER_MINUTE = 20;

  form.addEventListener("submit", e => {
    e.preventDefault();
    const question = input.value.trim().slice(0, MAX_QUERY_CHARS);
    if (!question || running) return;
    const now = Date.now();
    queryTimestamps = queryTimestamps.filter(t => now - t < 60_000);
    if (queryTimestamps.length >= MAX_QUERIES_PER_MINUTE) {
      initial.textContent = "Rate limit reached. Please wait before running more queries.";
      ctx.announce("Research rate limit reached");
      return;
    }
    queryTimestamps.push(now);
    running = true;
    runBtn.disabled = true;
    initial.textContent = "Running…";

    const corpusIds = scopeSelect.value !== "all" ? [scopeSelect.value] : undefined;
    const mode = modeSelect.value !== "default" ? (modeSelect.value as RetrievalMode) : undefined;

    void ctx.workflow
      .run({ id: `research-${Date.now()}`, question, corpusIds, mode })
      .then(res => {
        const badge = document.createElement("p");
        badge.className = "autosd-confidence-badge";
        badge.setAttribute("role", "status");
        badge.textContent = `Confidence ${Math.round(res.confidence * 100)}% · ${res.citations.length} sources`;
        const answer = document.createElement("p");
        answer.className = "autosd-answer-card";
        answer.textContent = res.answer;
        results.replaceChildren(
          badge,
          answer,
          createCitationList(res, cit => {
            ctx.openInReader?.({
              documentId: cit.documentId,
              chunkId: cit.chunkId,
              result: res,
            });
            ctx.announce(`Opened citation ${cit.chunkId}`);
          }),
        );
        ctx.onWorkspaceMutated?.();
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
      refreshScope();
      host.appendChild(root);
      if (ctx.liveSync) {
        unsubscribeSync?.();
        unsubscribeSync = ctx.liveSync.onStatusChange(status => {
          if (status === "Updated") refreshScope();
        });
      }
    },
    unmount() {
      unsubscribeSync?.();
      unsubscribeSync = undefined;
      root.remove();
    },
  };
}
