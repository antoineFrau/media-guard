# MediaGuard: Scientific Hypotheses for LLM-Based Manipulation Detection

This document formulates research questions in the style of a scientific paper. These hypotheses are validated using the evaluation pipeline that runs the Mistral-based analyzer on gold-annotated datasets (SemEval-2020 Task 11, PropaGaze) and computes precision, recall, and F1 metrics.

---

## Abstract

MediaGuard uses large language models (LLMs) to detect rhetorical manipulation techniques in video transcripts and news text. We propose five testable hypotheses concerning (1) the impact of dataset-backed skill definitions on detection accuracy, (2) the benefits of taxonomy alignment, (3) the effect of few-shot examples in skills, (4) cross-domain generalization, and (5) the monotonicity of adding techniques. Evaluation is performed on a 50-item curated evaluation set (PRTA samples + SemEval-style + propaganda literature); see [docs/CONCLUSION.md](CONCLUSION.md) and [docs/DATASETS.md](DATASETS.md).

---

## Hypotheses

### H1: Skill Quality (Dataset-backed vs. YouTube-only)

**Hypothesis**: Skills generated from dataset-backed definitions yield higher detection accuracy than skills generated solely from YouTube transcript extraction.

**Rationale**: Dataset-derived skills (SemEval, PropaInsight) are grounded in expert-annotated examples and established taxonomies. YouTube-extracted skills may be noisier and less aligned with evaluation gold labels.

**Test**:
1. Generate skills using the YouTube flow (`generate`).
2. Generate skills using the dataset flow (`generate:datasets`).
3. Run evaluation on SemEval validation split with each skill set.
4. Compare macro-F1 and per-technique F1.

**Metric**: Macro-F1 over 14 SemEval techniques. Dataset-backed skills should achieve higher macro-F1.

---

### H2: Taxonomy Alignment

**Hypothesis**: Aligning the LLM taxonomy with the SemEval/PTC technique labels improves technique-level recall compared to a free-form technique vocabulary.

**Rationale**: When skills use slugs that exactly match gold labels (e.g. `appeal-to-authority`, `loaded-language`), the LLM can output matching technique names. Ad-hoc French or mixed vocabularies may cause label mismatches and lower recall.

**Test**:
1. Run evaluation with skills using exact SemEval slugs.
2. Run evaluation with skills using ad-hoc French names (e.g. `appel-a-la-peur`, `montee-en-generalite`).
3. Compare per-technique recall.

**Metric**: Per-technique recall. Aligned taxonomy should yield higher recall, especially for techniques with non-obvious mappings.

---

### H3: Few-Shot Augmentation

**Hypothesis**: Including 3–5 gold examples per technique in the skill "How to recognize" section improves detection over definition-only skills.

**Rationale**: LLMs benefit from in-context examples. Skills that embed representative spans from SemEval should provide clearer recognition criteria.

**Test**:
1. Generate skills with examples embedded (default).
2. Generate skills with definitions only (no examples).
3. Run evaluation for both.
4. Compare macro-F1.

**Metric**: Macro-F1. Skills with examples should outperform definition-only skills.

---

### H4: Cross-Domain Generalization

**Hypothesis**: Skills trained on SemEval (news) definitions generalize to video transcripts (political discourse) when evaluated on a small labeled subset of Clément Viktorovitch transcripts.

**Rationale**: Manipulation techniques are largely domain-invariant. If the analyzer performs well on news and the skills describe techniques in a general way, it should transfer to political video content.

**Test**:
1. Manually label 20–30 spans from 2–3 YouTube transcripts (Clément Viktorovitch channel).
2. Map labels to SemEval slugs where possible.
3. Run evaluator on this custom eval set.
4. Report F1.

**Metric**: Macro-F1 on custom eval set. Generalization is supported if F1 is above a reasonable threshold (e.g. > 0.5).

**Note**: This test requires manual annotation. It can be deferred or conducted with a smaller sample.

---

### H5: Monotonicity (More Techniques)

**Hypothesis**: Adding more techniques (e.g. PropaInsight's 16 vs. SemEval's 14) does not degrade performance on the overlapping SemEval subset.

**Rationale**: Expanding the skill set should not confuse the LLM for techniques that are already well-defined. Performance on the 14 SemEval techniques should remain stable or improve.

**Test**:
1. Evaluate with 14-technique skills (SemEval-only).
2. Evaluate with 16-technique skills (SemEval + PropaInsight extras: Obfuscation, Smears, Glittering Generalities).
3. Compare F1 on the 14 overlapping techniques.

**Metric**: Macro-F1 on SemEval subset. Adding techniques should not decrease F1.

---

## Evaluation Protocol

1. **Dataset**: 50-item curated evaluation set (PRTA samples + curated SemEval-style + propaganda literature). Export via `python3 scripts/skill-generator/scripts/export-semeval.py`.
2. **Pseudo-transcript**: Convert article text to transcript format with fake timestamps (sentence-level segments).
3. **Analyzer**: Mistral API with skills context; returns `alerts` with `quote`, `technique`, `start`, `end`.
4. **Matching**: Gold span (start_char, end_char, technique_id) matches prediction if:
   - Predicted `quote` overlaps with gold span (character-level).
   - Predicted `technique` maps to same gold technique (via slug mapping).
5. **Metrics**: Precision, Recall, F1 (micro and macro); per-technique F1. LLM-as-judge optional for semantic correctness.

---

## Results

Evaluation run on 2026-03-01. See `docs/CONCLUSION.md` for the full 50-item benchmark and methodology.

| Hypothesis | Metric | Expected | Actual | Supported? |
|------------|--------|----------|--------|------------|
| H1 | Span F1 (dataset vs YouTube skills) | Dataset > YouTube | Dataset: 64.2%, YouTube: 0% | Yes |
| H2 | Per-technique recall (aligned vs ad-hoc) | Aligned > Ad-hoc | YouTube skills use FR slugs (appel-a-la-peur, etc.) → 0% recall on SemEval gold | Yes |
| H3 | Macro-F1 (with vs without examples) | With examples > Without | Not yet tested | — |
| H4 | Macro-F1 on custom eval set | > 0.5 | Requires manual annotation | — |
| H5 | Macro-F1 on 14 techniques (14 vs 16 skills) | 16 ≥ 14 | Not yet tested | — |

### Summary

- **H1 (Skill Quality)**: Dataset-backed skills achieved **64.2% span F1** (70.0% LLM judge) vs 0% for YouTube-derived skills on the same 50-item eval set. Strong support.
- **H2 (Taxonomy Alignment)**: YouTube skills use French/ad-hoc slugs that do not match SemEval gold labels; the analyzer outputs technique names that fail to map to gold. Dataset skills use exact SemEval slugs. Supports the hypothesis that alignment improves recall.
