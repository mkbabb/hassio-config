# Function Matching Task

You are analyzing a Node-RED function node to find its corresponding TypeScript source file.

## Function Node Details:
- **Name**: {{NODE_NAME}}
- **Flow**: {{FLOW_NAME}}
- **Node ID**: {{NODE_ID}}

## Function Code:
```javascript
{{FUNCTION_CODE}}
```

## Available TypeScript Files:
{{FILE_LIST}}

## Instructions:
1. Analyze the function code for patterns, imports, exports, function names, and logic
2. Compare against the provided TypeScript files
3. Look for matching:
   - Function signatures and names
   - Business logic patterns
   - Variable names and constants
   - Comments or documentation
   - Import statements or dependencies

## Output Format:
For each file, provide a confidence score (0-100) and reasoning:
```json
{
  "matches": [
    {
      "file": "filename.ts",
      "confidence": 85,
      "reasoning": "Strong match based on function name 'calculateCoolDown' and identical logic pattern"
    }
  ]
}
```

Only include files with confidence > 0. Be conservative - if unsure, give lower confidence.