# Prior-Art Report: AI-Powered Architecture Harness
Empirical research for OSS planning — competitive analysis, retrieval corpus design, evaluation methodology.
Compiled 2026-08-25 by researcher (team harness-hyperplan). All facts web-verified; URLs included.

---

## (A) Agent / Codegen Scaffolds

**MetaGPT** — https://github.com/FoundationAgents/MetaGPT (~70k stars, MIT) · paper: https://arxiv.org/abs/2308.00352 (ICLR 2024 oral)
Takeaway: Encodes a software-company SOP ("Code = SOP(Team)") as ProductManager→Architect→ProjectManager→Engineer→QA roles that emit structured artifacts (PRD, data structures, interface definitions, code) through a publish-subscribe message pool — the closest existing thing to "NL → design docs," but the design docs are intermediate scaffolding for codegen, not validated deliverables.

**ChatDev** — https://github.com/OpenBMB/ChatDev · paper: https://arxiv.org/abs/2307.07924 (ACL 2024)
Takeaway: Chat-chain of dual-agent phases (design/coding/testing) with "communicative dehallucination"; found natural language best for system design, programming language best for debugging; ChatDev 2.0 (Jan 2026) pivoted to a zero-code multi-agent platform (DevAll), leaving the virtual-software-company line as legacy.

**GPT-Engineer** — https://github.com/AntonOsika/gpt-engineer
Takeaway: Spec-in → whole-codebase-out generation with iterative refinement prompts; spawned the Lovable product; produces no architecture artifacts (no diagrams, ADRs, or tradeoff rationale).

**Aider** — https://github.com/Aider-AI/aider (~48k stars, Apache-2.0) · https://aider.chat
Takeaway: Git-native terminal pair programmer (repo map, auto-commits, lint/test loop, public polyglot leaderboard) that edits *existing* codebases — orthogonal to greenfield architecture generation and useful as a downstream consumer of harness output.

**Differentiators across class:** MetaGPT = structured SOP + role specialization; ChatDev = conversational phase protocol; GPT-Engineer = one-shot repo synthesis; Aider = incremental in-repo editing. None retrieve from curated external knowledge; all rely on parametric model knowledge for design decisions.

**Shared gaps:** no grounding in reference architectures/pattern libraries; no machine-checkable target format (C4/Structurizr); no evaluation of design quality (only executability of code); design artifacts are unvalidated pass-throughs.

---

## (B) Reference-Architecture Knowledge Bases

**AWS Well-Architected Framework** — https://docs.aws.amazon.com/wellarchitected/latest/framework/ (6 pillars) + AWS Architecture Center https://aws.amazon.com/architecture/
Takeaway: Six-pillar question-driven review framework plus a large library of vetted reference architectures — prime retrieval-corpus material, published as versioned PDFs/pages (staleness-prone).

**Azure Well-Architected Framework + Architecture Center** — https://learn.microsoft.com/en-us/azure/well-architected/pillars · https://learn.microsoft.com/en-us/azure/architecture
Takeaway: Five pillars wired into an assessment tool and Azure Advisor scoring, plus reference architectures, cloud design patterns, and technology decision guides ("choose a compute/data store service") — decision guides are exactly the shape an architecting agent must imitate.

**Google Cloud Well-Architected Framework + Architecture Center** — https://docs.cloud.google.com/architecture/framework
Takeaway: Six pillars + cross-pillar "perspectives" (AI/ML, financial services) and an explicit documentation-quality mandate — newest-refreshed of the three big clouds (reviewed 2026-01).

**C4 model** — https://c4model.com · tooling list: https://c4model.com/tooling
Takeaway: Abstraction-first hierarchy (context/container/component/code + dynamic/deployment) whose author explicitly frames models as directed graphs ("a model is just data") — i.e., a machine-checkable target representation for generated designs.

**Structurizr** — https://docs.structurizr.com/ (DSL by C4's author)
Takeaway: "Models as code" DSL that renders multiple diagram views from one model — the natural serialization format if the harness wants diffable, PR-reviewable architecture output.

**arc42** — https://arc42.org · template repo: https://github.com/arc42/arc42-template
Takeaway: Free 12-chapter architecture-documentation template (context, building-block/runtime/deployment views, decisions, risks) with lean/thorough tailoring — a ready-made output skeleton for generated design documents.

**adr-tools (Nygard)** — https://github.com/npryce/adr-tools
Takeaway: Bash CLI creating numbered Nygard-format ADRs (title/status/context/decision/consequences); de-facto baseline with ports in Go/Rust/Node/Python/PowerShell.

**MADR** — https://adr.github.io/madr/ (v4.0.0, Sep 2024) · tooling index: https://adr.github.io/adr-tooling/
Takeaway: Markdown ADR template emphasizing considered-options-with-pros/cons, supported by ADR-Manager (web/VS Code), Log4brains, adr-log, Backstage plugin, pyadr — mature capture tooling but zero generation intelligence; new YAML variant (YADR) exists for tool-processability.

**Ecosystem note:** docToolchain (https://doctoolchain.github.io/) automates arc42+C4+ADR builds (docs-as-code); AWS Prescriptive Guidance publishes an official ADR process guide. No KB here is exposed as a queryable API — all are prose sites/PDFs requiring corpus engineering.

---

## (C) Hybrid Retrieval Practice

**Hybrid BM25+dense+RRF** — practitioner consensus + BEIR ablations; e.g., https://topreviewed.ai/blog/hybrid-search-rag-in-production-bm25-dense-vectors-rrf-with-measured-results
Takeaway: Dense-only recall@5 ≈0.72 vs ≈0.91 for hybrid+rerank on domain corpora; BM25 is non-negotiable for exact tokens (SKU IDs, `29 CFR`-style citations, API names) that dominate technical corpora.

**RRF fusion** — default k=60, rank-based (no score calibration needed), robust under load; weighted/calibrated fusion only pays off with labeled data.
Source: https://seraro.com/ai-technologies/rag-systems/hybrid-search-and-reranking ; https://academy.datalumina.com/blog/how-to-build-hybrid-search-for-rag

**Rerankers** — cross-encoders (BAAI/bge-reranker-large/v2-m3 self-hosted on GPU; Cohere Rerank managed) applied to top-30–50 fused candidates only; typical fan-out retrieve-50→rerank-10→pass-5.
Takeaway: Rerank stage is where precision comes from, but it's the latency/cost bottleneck — profile before adopting.

**Rollout checklist (empirical):** build ~100-item golden set first; baseline BM25-only (often sufficient on technical text); add dense+RRF; add cross-encoder; pre-filter metadata (tenant/freshness) at index time, never post-hoc.

**GraphRAG (Microsoft)** — https://github.com/microsoft/graphrag (~33k stars) · https://microsoft.github.io/graphrag/ · blog: https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/
Takeaway: LLM-extracted entity/relation graph + Leiden community detection + hierarchical community summaries enables global/thematic queries flat RAG fails; indexing is expensive (LLM call per chunk) and best suited to static corpora — survey: ACM TOIS 2025 "Graph RAG: A Survey" https://dl.acm.org/doi/10.1145/3777378.

**Staleness handling** — https://tianpan.co/blog/2026-04-20-rag-knowledge-base-freshness-index-rot · https://www.amicited.com/faq/how-do-rag-systems-handle-outdated-information
Takeaway: Standard practice = content-hash change detection + incremental upserts + freshness scoring at query time + deprecation flags/versioned docs + conflict resolution (recency + authority); full re-embeds treated like schema migrations (embedding-model changes force them). Key finding: vector search has NO inherent recency preference — stale docs stay semantically attractive forever unless freshness signals are injected; standard eval suites have no temporal component, so a system can score 95% while serving superseded guidance.

**Corpus-design implication for the harness:** cloud Well-Architected/reference-architecture pages change continuously → CDC-style sync + version-tagged chunks + authority weighting (official docs > blogs) are required infrastructure, not nice-to-haves.

---

## (D) LLM Evaluation Frameworks & the Benchmark Question

**promptfoo** — https://github.com/promptfoo/promptfoo (~21k stars, MIT)
Takeaway: YAML-driven CLI for multi-model matrix evals + best-in-class red-teaming (OWASP LLM Top 10 plugins); acquired by OpenAI in 2026 (reported ~$86M) with open-source commitment intact — pin versions if multi-provider.

**DeepEval** — https://github.com/confident-ai/deepeval (~15k stars)
Takeaway: pytest-native Python framework, 50+ metrics incl. G-Eval/DAG custom judges — the natural CI quality-gate for a Python harness.

**OpenAI Evals** — https://github.com/openai/evals
Takeaway: The original registry-style eval harness is on light maintenance since late 2025; teams actively migrate to DeepEval/promptfoo — do not build on it.

**RAGAS** — https://github.com/explodinggradients/ragas
Takeaway: Canonical RAG-specific metrics (faithfulness, context precision/recall, answer relevancy) — right tool for gating the retrieval layer specifically.

**LLM-as-judge reliability (empirical findings):**
- MT-Bench (Zheng et al. 2023, https://arxiv.org/abs/2306.05685): ~80%+ agreement with humans on chat, BUT position bias swings winrate 10–15 pts by slot order; self-preference 10–25%.
- Verbosity bias (Wang et al. 2023, https://arxiv.org/abs/2305.17926): judges prefer longer answers by 15–30 pts independent of correctness; length-control raises benchmark-arena rank correlation 0.94→0.98.
- Position-bias systematic study (https://arxiv.org/abs/2406.07791, IJCNLP 2025): bias varies strongly with quality gap between candidates, weakly with prompt length.
- Practitioner consensus (https://llm-academy.dev/observability/llm-as-judge/): judge-human agreement 70–85% on well-defined tasks, <60% on subjective ones → judges OK for structural/format checks, risky for "is this design good."
- Mitigations with evidence: order-swapping, multi-judge cross-family panels, length matching, rubric calibration against ~100–300 human-labeled examples.

### Does a public benchmark exist for "quality of generated software architecture"?

**Direct answer: essentially no comprehensive one; one narrow direct prior art exists.**

- **R2ABench** — https://arxiv.org/abs/2604.06683 (v1 Apr 2026: 17 projects; v2 Jul 2026: 68 human-validated projects; data: https://figshare.com/s/01f0a5fb6243a6a60f23)
  Takeaway: THE only requirement-to-architecture benchmark — SRS/PRD in, PlantUML architecture-view out, scored by layered hybrid eval (syntax validation → structural graph metrics → semantic/evidence scoring → anti-pattern detection); its own findings: component identification >> edge recovery, **edge hallucination is the dominant failure mode**, and structural fidelity does NOT guarantee requirement coverage/traceability.
  Scope limits: single architecture-view diagram only — no APIs, schemas, ADRs, deployment views, NFR tradeoffs, or Well-Architected compliance; small-n; authors themselves flag dataset size/diversity as the top limitation.
- **False friends (not software architecture):** Arch-Eval (https://www.nature.com/articles/s41598-025-98236-0) = building/civil architecture domain knowledge in Chinese; DesignQA (https://www.research.autodesk.com/publications/designqa/) = mechanical-engineering documentation comprehension (Formula SAE).
- **Adjacent only:** UML class/sequence-diagram benchmarks from curated NL inputs (per R2ABench related work); CodeWiki (https://arxiv.org/html/2510.24428v2) evaluates holistic *documentation* generation for existing codebases (68.79% quality score ceiling for proprietary models); a Springer 2026 study (https://link.springer.com/chapter/10.1007/978-3-032-24216-7_4) compares LLM vs architect document reviews but ships no public benchmark.

**Explicit absence finding:** No public benchmark measures end-to-end NL-requirements → production-ready design bundle (component model + API contracts + schemas + ADRs + deployment + NFR rationale). R2ABench covers one artifact type at small scale. This absence is itself a finding and an opportunity.

---

## (E) Gap Analysis — what none of them cover (harness claims)

1. **Retrieval-grounded architecture generation.** MetaGPT/ChatDev/GPT-Engineer make every design decision from parametric knowledge; no scaffold retrieves from Well-Architected/reference-architecture corpora at design time. Claimable: hybrid-retrieval-grounded design with citations back to authoritative guidance.
2. **Full design-bundle output with machine-checkable formats.** Nobody emits C4/Structurizr models-as-code + arc42 documents + MADR ADRs as validated, diffable artifacts; MetaGPT's design.md is prose scaffolding. Claimable: schema-validated multi-artifact output.
3. **Evaluation methodology for architecture quality.** Only R2ABench exists (single view, n=68); nothing scores APIs+schemas+ADRs+tradeoff rationale. Claimable: deterministic structural checks (graph metrics, anti-pattern detection à la R2ABench) + calibrated multi-judge panels + human-calibration set — directly addressing documented judge biases.
4. **Requirement traceability.** R2ABench empirically shows structural fidelity ≠ requirement coverage; no tool enforces req→artifact trace links. Claimable: first-class traceability matrix.
5. **Staleness-aware technical corpus.** Cloud guidance churns; practitioner staleness lore (hash-based sync, freshness scoring, deprecation flags) is unbuilt productized infrastructure anywhere in the agent-scaffold space. Claimable: freshness-governed retrieval corpus as a core subsystem.
6. **ADR synthesis integrated into orchestration.** ADR tooling is capture-only; LLM ADR capability is demonstrated in research but not pipelined with decision drivers/options/pros-cons grounded in retrieved evidence.
7. **Anti-hallucination for structure.** Edge hallucination is the dominant R2A failure mode; no scaffold validates generated relationships against a typed meta-model (C4/Structurizr DSL validation exists and is unused by any AI tool).

**Positioning one-liner:** the harness sits in the empty intersection of (A) orchestration scaffolds that generate designs blindly, (B) authoritative KBs locked in prose, (C) mature-but-unapplied retrieval practice, and (D) an evaluation vacuum with exactly one narrow benchmark.
