# MediaGuard: Conclusion and Evaluation Summary

## Abstract

MediaGuard is an LLM-based system for detecting rhetorical manipulation techniques in video transcripts and news text. This document summarizes the methodology, experimental setup, and results of benchmarking two agent configurations—dataset-backed skills (SemEval taxonomy) and YouTube-derived skills (French/ad-hoc taxonomy)—on a 50-item evaluation set with gold-annotated spans. We employ both span-based metrics (precision, recall, F1) and an LLM-as-judge for semantic correctness assessment. The dataset-backed agent achieves 57.8% span F1 and 61.8% LLM judge score, strongly validating the hypothesis that taxonomy alignment and dataset-backed definitions improve detection accuracy.

---

## 1. Introduction

Propaganda and rhetorical manipulation in media pose significant risks to public discourse. MediaGuard addresses this by applying large language models (Mistral) to identify manipulation techniques in text, guided by skill definitions that encode technique taxonomies and recognition criteria. Two skill-generation flows exist: (1) extraction from YouTube transcripts (Clément Viktorovitch channel), producing French-named techniques; (2) generation from academic datasets (SemEval-2020 Task 11, PropaInsight), producing SemEval-aligned slugs. The research questions concern which approach yields better accuracy and how evaluation should be conducted when gold annotations exist.

---

## 2. Dataset

### 2.1 Construction

A 50-item evaluation set was compiled from multiple sources:

| Source | Articles | Gold Spans | Description |
|--------|----------|------------|-------------|
| semeval-prta | 4 | 11 | PRTA (ACL 2020) Table 1 sample articles |
| curated-semeval | 25 | 24 | Curated SemEval-style examples |
| curated-propaganda | 21 | 23 | Curated propaganda literature examples |
| **Total** | **50** | **58** | |

Each article contains gold spans with `start_char`, `end_char`, `technique_slug`, and `quote`. The taxonomy aligns with SemEval-2020 Task 11 (14 techniques: appeal-to-authority, appeal-to-fear-prejudice, loaded-language, etc.).

### 2.2 Limitations

- SemEval and PropaInsight full corpora require manual registration or legacy loading scripts; the curated set approximates their structure.
- Examples are English-only and news-style; generalization to video transcripts or other languages is not yet validated.
- Curated samples may differ in difficulty from human-annotated datasets.

---

## 3. Methodology

### 3.1 Agents

**Agent A: skills-dataset** — Skills generated from `technique-definitions-static.json` and SemEval examples. Uses exact SemEval slugs (e.g., `appeal-to-authority`, `loaded-language`).

**Agent B: skills-youtube** — Skills extracted from YouTube transcripts. Uses French/ad-hoc slugs (e.g., `appel-a-la-peur`, `fausse-dichotomie`) that do not map to SemEval gold labels.

### 3.2 Evaluation Protocol

1. **Input**: Article text converted to pseudo-transcript format (sentence-level segments with fake timestamps).
2. **Analysis**: Mistral API (`mistral-small-latest`) with skills context; returns JSON `alerts` with `technique`, `quote`, `start`, `end`.
3. **Span-Based Metrics**:
   - Gold span matches prediction if: (a) predicted quote overlaps gold span (character-level), and (b) predicted technique maps to same gold technique (via slug normalization).
   - Precision = TP / (TP + FP), Recall = TP / (TP + FN), F1 = 2·P·R / (P + R).
4. **LLM-as-Judge** (optional): For each article, Mistral receives the text, gold spans, and predicted alerts. It returns a score 0–1 indicating how well predictions match gold (overlapping quote + correct/equivalent technique). The mean score across articles is the judge metric.

---

## 4. Results

### 4.1 Span-Based Metrics (50 articles, 58 gold spans)

| Agent | Samples | Gold | Pred | TP | Precision | Recall | F1 |
|-------|---------|------|------|-----|-----------|--------|------|
| skills-dataset | 50 | 58 | 115 | 50 | 43.5% | 86.2% | **57.8%** |
| skills-youtube | 50 | 58 | 90 | 0 | 0.0% | 0.0% | **0.0%** |

The YouTube agent achieves zero span F1 because its output slugs do not match gold labels; the analyzer finds manipulations but uses a different taxonomy.

### 4.2 LLM-as-Judge (Semantic Correctness)

| Agent | Judge Score |
|-------|-------------|
| skills-dataset | **61.8%** |
| skills-youtube | **37.0%** |

The LLM judge rewards semantic overlap: even when span F1 is 0 (YouTube), the judge assigns ~37% for partial technique equivalence (e.g., `fausse-dichotomie` vs `black-and-white-fallacy`).

### 4.3 Per-Technique Performance (skills-dataset)

Techniques with highest F1: exaggeration-minimisation (88.9%), flag-waving (80%), bandwagon-reductio-ad-hitlerum (80%), repetition (80%), causal-oversimplification (72.7%). Techniques with lowest F1: slogans (35.3%), appeal-to-fear-prejudice (42.1%), black-and-white-fallacy (52.6%).

---

## 5. Discussion

### 5.1 Hypothesis Validation

- **H1 (Skill Quality)**: Dataset-backed skills significantly outperform YouTube-derived skills on SemEval-aligned evaluation (57.8% vs 0% span F1). **Supported.**
- **H2 (Taxonomy Alignment)**: When skills use SemEval slugs, the model outputs match gold labels. When skills use ad-hoc French names, span-based recall is zero despite the model detecting manipulations. **Supported.**

### 5.2 LLM-as-Judge

The LLM judge provides a complementary metric that captures semantic equivalence (e.g., technique name variations, partial span overlap). It is useful when:
- Gold labels exist but strict span overlap is too stringent.
- Multiple valid phrasings or techniques could apply.

Care should be taken: judge scores can be subjective and model-dependent.

### 5.3 Expected Output

All 50 items have expected output (gold spans). The evaluation pipeline uses these for both span F1 and LLM judge. For items without gold, the LLM judge could still assess correctness qualitatively, though we did not test that mode.

---

## 6. Conclusion

We have established a 50-item evaluation set with gold-annotated spans drawn from PRTA samples and curated SemEval-style and propaganda literature examples. We benchmarked two MediaGuard agents: one with dataset-backed skills (SemEval taxonomy) and one with YouTube-derived skills (French taxonomy). The dataset-backed agent achieves 57.8% F1 and 61.8% LLM judge score; the YouTube agent achieves 0% F1 but 37% judge score due to taxonomy mismatch. These results strongly support the use of dataset-backed, taxonomy-aligned skills for propaganda technique detection when evaluated against SemEval-style gold standards. Future work should include evaluation on the full SemEval validation set (upon access), cross-domain generalization to video transcripts, and exploration of LLM judge calibration and reliability.

---

## Appendix A: Commands

```bash
# Export 50-item dataset
cd scripts/skill-generator && python3 scripts/export-semeval.py

# Run benchmark (50 items, with LLM judge)
npm run evaluate:benchmark -- --limit=50 --judge

# Run evaluation for dataset skills only (validation split)
npm run evaluate -- --skills=output/skills-dataset
```

## Appendix B: Output Files

- `scripts/skill-generator/data/semeval-export.json` — 50 articles, splits: train, validation, eval50
- `scripts/skill-generator/output/benchmark-results.json` — Full benchmark results with per-technique and judge details
- `scripts/skill-generator/output/evaluation-results.json` — Standard evaluation results
