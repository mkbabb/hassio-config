# Best Match Selection

You are selecting the best TypeScript source file match for a Node-RED function from a list of candidates.

## Function Node:
- **Name**: {{NODE_NAME}}
- **Description**: {{NODE_DESCRIPTION}}

## Candidate Matches (confidence > {{THRESHOLD}}%):
{{CANDIDATES}}

## Instructions:
1. Review all candidate matches and their confidence scores
2. Consider the reasoning provided for each match
3. Select the single best match OR indicate if no match is suitable
4. A match must be highly certain to be selected

## Output Format:
```json
{
  "selected_file": "path/to/file.ts",
  "confidence": 95,
  "reasoning": "Selected based on exact function signature match and identical business logic"
}
```

OR if no suitable match:
```json
{
  "selected_file": null,
  "confidence": 0,
  "reasoning": "No candidate has sufficient confidence. Risk of incorrect mapping too high."
}
```

Be very selective - it's better to have no match than a wrong match.