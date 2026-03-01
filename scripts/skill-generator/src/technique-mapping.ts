/**
 * Mapping between SemEval-2020 Task 11 technique IDs and MediaGuard slugs.
 * Based on dataset class_label names from HuggingFace.
 */
export const SEMEVAL_TO_SLUG: Record<number, string> = {
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
};

export const SLUG_TO_SEMEVAL: Record<string, number> = Object.fromEntries(
  Object.entries(SEMEVAL_TO_SLUG).map(([id, slug]) => [slug, Number(id)])
);

/** Canonical English names for each technique (from SemEval/PTC). */
export const SLUG_TO_NAME: Record<string, string> = {
  "appeal-to-authority": "Appeal to Authority",
  "appeal-to-fear-prejudice": "Appeal to Fear/Prejudice",
  "bandwagon-reductio-ad-hitlerum": "Bandwagon, Reductio ad Hitlerum",
  "black-and-white-fallacy": "Black-and-White Fallacy",
  "causal-oversimplification": "Causal Oversimplification",
  "doubt": "Doubt",
  "exaggeration-minimisation": "Exaggeration/Minimisation",
  "flag-waving": "Flag-Waving",
  "loaded-language": "Loaded Language",
  "name-calling-labeling": "Name Calling/Labeling",
  "repetition": "Repetition",
  "slogans": "Slogans",
  "thought-terminating-cliches": "Thought-terminating Cliches",
  "whataboutism-straw-men-red-herring": "Whataboutism, Straw Men, Red Herring",
};
