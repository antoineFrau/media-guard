# MediaGuard Dataset Catalog

This document catalogs all datasets used for skill generation and evaluation in the MediaGuard project. Each dataset provides gold-annotated manipulation techniques at the span level, enabling both training of skills and quantitative evaluation of the LLM-based analyzer.

---

## 1. SemEval-2020 Task 11 (Propaganda Techniques Corpus)

### Overview

| Property | Value |
|----------|-------|
| **Source** | [HuggingFace: `SemEvalWorkshop/sem_eval_2020_task_11`](https://huggingface.co/datasets/SemEvalWorkshop/sem_eval_2020_task_11) |
| **Homepage** | [PTC Tasks](https://propaganda.qcri.org/ptc/index.html) |
| **Language** | English |
| **Format** | News articles with `technique_classification` (start/end char offset, technique id 0–13) |
| **Techniques** | 14 (merged from original 18) |
| **Use case** | Primary evaluation; definition examples; gold standard |
| **License** | Unknown |

### Schema

```json
{
  "article_id": "string",
  "text": "full article text",
  "span_identification": {
    "start_char_offset": [int],
    "end_char_offset": [int]
  },
  "technique_classification": {
    "start_char_offset": [int],
    "end_char_offset": [int],
    "technique": [int]  // 0-13
  }
}
```

### Technique Label Mapping (ID → Slug)

| ID | Slug | Canonical name |
|----|------|----------------|
| 0 | appeal-to-authority | Appeal to Authority |
| 1 | appeal-to-fear-prejudice | Appeal to Fear/Prejudice |
| 2 | bandwagon-reductio-ad-hitlerum | Bandwagon, Reductio ad Hitlerum |
| 3 | black-and-white-fallacy | Black-and-White Fallacy |
| 4 | causal-oversimplification | Causal Oversimplification |
| 5 | doubt | Doubt |
| 6 | exaggeration-minimisation | Exaggeration/Minimisation |
| 7 | flag-waving | Flag-Waving |
| 8 | loaded-language | Loaded Language |
| 9 | name-calling-labeling | Name Calling/Labeling |
| 10 | repetition | Repetition |
| 11 | slogans | Slogans |
| 12 | thought-terminating-cliches | Thought-terminating Cliches |
| 13 | whataboutism-straw-men-red-herring | Whataboutism, Straw Men, Red Herring |

### Splits

| Split | Articles |
|-------|----------|
| Train | 371 |
| Validation | 75 |
| Test | 90 |

### Download

- **HuggingFace Datasets**: `datasets.load_dataset("SemEvalWorkshop/sem_eval_2020_task_11")`
- **Datasets Server API**: `https://datasets-server.huggingface.co/`

### Citation

```bibtex
@misc{martino2020semeval2020,
  title={SemEval-2020 Task 11: Detection of Propaganda Techniques in News Articles},
  author={G. Da San Martino and A. Barrón-Cedeño and H. Wachsmuth and R. Petrov and P. Nakov},
  year={2020},
  eprint={2009.02696},
  archivePrefix={arXiv},
  primaryClass={cs.CL}
}
```

### Limitations

- English-only
- News domain (2017–2019); may not generalize to video transcripts
- Test set annotations not publicly released (only train/validation)
- Merged techniques (e.g. Bandwagon+Reductio, Whataboutism+Straw Men+Red Herring) reduce granularity

---

## 2. PropaInsight Data (PropaGaze)

### Overview

| Property | Value |
|----------|-------|
| **Source** | [HuggingFace: `Lumos-Jiateng/PropaInsight_Data`](https://huggingface.co/datasets/Lumos-Jiateng/PropaInsight_Data) |
| **Repository** | [GitHub: PropaInsight](https://github.com/Lumos-Jiateng/PropaInsight) |
| **Language** | English |
| **Format** | Articles + technique spans + appeals + intent |
| **Techniques** | 16 |
| **Use case** | Richer definitions; appeals; intent modeling |
| **License** | Check repository |

### Technique Set (16 techniques)

Loaded Language, Name Calling/Labeling, Repetition, Obfuscation, Doubt, Straw Man, Flag-waving, Causal Oversimplification, Slogans, Black-and-White Fallacy, Appeal to Authority, Thought-terminating Cliche, Whataboutism, Reductio ad Hitlerum, Smears, Glittering Generalities.

### Subsets

| Subset | Size | Origin |
|--------|------|--------|
| PTC-Gaze | 79 articles | Human-annotated (PTC-based) |
| RUWA-Gaze | 497 articles | Synthetic (Russia-Ukraine War) |
| Politifact-Gaze | 593 articles | Synthetic (political domain) |

### Citation

```bibtex
@inproceedings{liu2024propainsight,
  title={PropaInsight: Toward Deeper Understanding of Propaganda in Terms of Techniques, Appeals, and Intent},
  author={Liu, Jiateng and Ai, Lin and Liu, Zizhou and others},
  booktitle={Proceedings of COLING 2025},
  year={2025}
}
```

### Limitations

- PTC-Gaze is human-annotated; RUWA-Gaze and Politifact-Gaze are synthetic
- Appeals and intent require careful schema alignment with MediaGuard skills
- English-only

---

## 3. MAFALDA

### Overview

| Property | Value |
|----------|-------|
| **Source** | [ACL Anthology](https://aclanthology.org/2024.naacl-long.270/), [HAL-Inria](https://hal.inria.fr/hal-04631163) |
| **Language** | Multiple (depending on source datasets) |
| **Format** | Fallacy annotations with explanations |
| **Techniques** | Unified fallacy taxonomy (merged from prior datasets) |
| **Use case** | Fallacy-specific skills; logical argumentation |
| **License** | Check paper |

MAFALDA unifies prior fallacy datasets into a single benchmark with a refined taxonomy. It focuses on logical fallacies rather than propaganda techniques, but there is overlap (e.g. straw man, false dilemma, appeal to authority).

### Citation

```bibtex
@inproceedings{helwe2024mafalda,
  title={MAFALDA: A Benchmark and Comprehensive Study of Fallacy Detection and Classification},
  author={Helwe, Chadi and Calamai, Tom and Paris, Pierre-Henri and Clavel, Chloé and Suchanek, Fabian M.},
  booktitle={Proceedings of NAACL 2024},
  pages={4810--4845},
  year={2024}
}
```

### Limitations

- Focus on argumentative fallacies, not media propaganda
- Access may require contacting authors
- Different taxonomy from SemEval/PropaInsight; mapping needed

---

## 4. CoCoLoFa

### Overview

| Property | Value |
|----------|-------|
| **Source** | [arXiv](https://arxiv.org/html/2410.03457) |
| **Language** | English |
| **Format** | News comments with fallacy labels |
| **Techniques** | 10+ fallacy types (slippery slope, false dilemma, etc.) |
| **Use case** | Optional augmentation; comment-level fallacies |
| **License** | Check paper |

CoCoLoFa is the largest known English logical fallacy dataset (7,706 comments across 648 news articles), created with LLM-assisted crowdsourcing.

### Limitations

- Comment-level, not article-level spans
- Different annotation granularity than SemEval
- May require custom ingestion pipeline

---

## 5. ZenPropaganda

### Overview

| Property | Value |
|----------|-------|
| **Source** | [ACL Anthology (LREC 2024)](https://aclanthology.org/anthology-files/anthology-files/pdf/lrec/2024.lrec-main.1548.pdf) |
| **Language** | Russian |
| **Format** | COVID-19-related texts from VKontakte/Yandex.Zen |
| **Use case** | Multilingual extension (future work) |
| **License** | Check paper |

### Limitations

- Russian-only
- Domain-specific (COVID-19)
- Not currently integrated into MediaGuard

---

## Unified Slug Mapping (MediaGuard)

For evaluation and skill generation, we map all dataset techniques to a canonical slug format:

- **Primary**: SemEval 14-technique taxonomy (see table in §1)
- **Extended**: PropaInsight adds Obfuscation, Smears, Glittering Generalities; these can be appended with slugs `obfuscation`, `smears`, `glittering-generalities`

When evaluating on SemEval, only the 14 overlapping techniques are scored. PropaInsight-extended skills can be evaluated on PropaGaze subsets when available.
