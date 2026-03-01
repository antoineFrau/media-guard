#!/usr/bin/env python3
"""
Export SemEval-2020 Task 11 dataset to JSON for use by the skill generator and evaluator.

The HuggingFace SemEval dataset uses legacy loading scripts that are no longer supported.
This script generates a SAMPLE evaluation set from PRTA paper examples for pipeline testing.
For full evaluation, obtain the dataset from https://propaganda.qcri.org/ptc/ or use
an older datasets library version.
"""
import json
from pathlib import Path

# Technique ID to slug mapping (matches technique-mapping.ts)
SEMEVAL_TO_SLUG = {
    0: "appeal-to-authority",
    1: "appeal-to-fear-prejudice",
    2: "bandwagon-reductio-ad-hitlerum",
    3: "black-and-white-fallacy",
    4: "causal-oversimplification",
    5: "doubt",
    6: "exaggeration-minimisation",
    7: "flag-waving",
    8: "loaded-language",
    9: "name-calling-labeling",
    10: "repetition",
    11: "slogans",
    12: "thought-terminating-cliches",
    13: "whataboutism-straw-men-red-herring",
}

# Sample articles built from PRTA paper (ACL 2020) Table 1 examples
SAMPLE_ARTICLES = [
    {
        "article_id": "sample-1",
        "text": "Outrage as Donald Trump suggests injecting disinfectant to kill virus. The President made the comments during a White House briefing. Monsignor Jean-François Lantheaume, who served as first Counsellor of the Nunciature in Washington, confirmed that \"Vigano said the truth. That's all.\" Can the same be said for the Obama Administration?",
        "spans": [
            {"start_char": 0, "end_char": 60, "technique_id": 8, "technique_slug": "loaded-language", "quote": "Outrage as Donald Trump suggests injecting disinfectant to kill virus"},
            {"start_char": 110, "end_char": 195, "technique_id": 0, "technique_slug": "appeal-to-authority", "quote": "Monsignor Jean-François Lantheaume, who served as first Counsellor of the Nunciature in Washington, confirmed that \"Vigano said the truth. That's all.\""},
            {"start_char": 196, "end_char": 234, "technique_id": 5, "technique_slug": "doubt", "quote": "Can the same be said for the Obama Administration?"},
        ],
    },
    {
        "article_id": "sample-2",
        "text": "Coronavirus 'risk to the American people remains very low', Trump said. Mueller attempts to stop the will of We the People!!! It's time to jail Mueller. \"BUILD THE WALL!\" Trump tweeted.",
        "spans": [
            {"start_char": 0, "end_char": 58, "technique_id": 6, "technique_slug": "exaggeration-minimisation", "quote": "Coronavirus 'risk to the American people remains very low', Trump said"},
            {"start_char": 59, "end_char": 111, "technique_id": 7, "technique_slug": "flag-waving", "quote": "Mueller attempts to stop the will of We the People!!! It's time to jail Mueller"},
            {"start_char": 112, "end_char": 136, "technique_id": 11, "technique_slug": "slogans", "quote": "\"BUILD THE WALL!\" Trump tweeted"},
        ],
    },
    {
        "article_id": "sample-3",
        "text": "WHO: Coronavirus emergency is 'Public Enemy Number 1'. A dark, impenetrable and \"irreversible\" winter of persecution of the faithful by their own shepherds will fall. If France had not have declared war on Germany then World War II would have never happened.",
        "spans": [
            {"start_char": 0, "end_char": 49, "technique_id": 9, "technique_slug": "name-calling-labeling", "quote": "WHO: Coronavirus emergency is 'Public Enemy Number 1'"},
            {"start_char": 51, "end_char": 138, "technique_id": 1, "technique_slug": "appeal-to-fear-prejudice", "quote": "A dark, impenetrable and \"irreversible\" winter of persecution of the faithful by their own shepherds will fall"},
            {"start_char": 139, "end_char": 215, "technique_id": 4, "technique_slug": "causal-oversimplification", "quote": "If France had not have declared war on Germany then World War II would have never happened"},
        ],
    },
    {
        "article_id": "sample-4",
        "text": "Francis said these words: \"Everyone is guilty for the good he could have done and did not do. If we do not oppose evil, we tacitly feed it.\" President Trump —who himself avoided national military service in the 1960's— keeps beating the war drums over North Korea.",
        "spans": [
            {"start_char": 0, "end_char": 107, "technique_id": 3, "technique_slug": "black-and-white-fallacy", "quote": "Francis said these words: \"Everyone is guilty for the good he could have done and did not do. If we do not oppose evil, we tacitly feed it.\""},
            {"start_char": 108, "end_char": 210, "technique_id": 13, "technique_slug": "whataboutism-straw-men-red-herring", "quote": "President Trump —who himself avoided national military service in the 1960's— keeps beating the war drums over North Korea"},
        ],
    },
]

def main():
    output_dir = Path(__file__).parent.parent / "data"
    output_dir.mkdir(parents=True, exist_ok=True)

    technique_examples = {slug: [] for slug in SEMEVAL_TO_SLUG.values()}
    for article in SAMPLE_ARTICLES:
        for span in article["spans"]:
            slug = span["technique_slug"]
            quote = span.get("quote", "").strip()
            if quote and len(technique_examples[slug]) < 10:
                technique_examples[slug].append(quote[:300])

    result = {
        "splits": {
            "train": SAMPLE_ARTICLES[:2],
            "validation": SAMPLE_ARTICLES[2:4],
            "test": [],
        },
        "techniqueExamples": technique_examples,
        "_meta": {
            "source": "PRTA (ACL 2020) Table 1 sample articles",
            "note": "For full SemEval data, obtain from propaganda.qcri.org or use older datasets lib",
        },
    }

    output_path = output_dir / "semeval-export.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Exported sample to {output_path}")
    print(f"  train: {len(result['splits']['train'])} articles")
    print(f"  validation: {len(result['splits']['validation'])} articles")

if __name__ == "__main__":
    main()
