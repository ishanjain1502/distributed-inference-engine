#!/bin/bash

# Simple test script for inference endpoint

echo "Testing inference with TinyLlama 1.1B..."
echo ""

PROMPT="${1:-What is the capital of France?}"
MAX_TOKENS="${2:-50}"

echo "Prompt: $PROMPT"
echo "Max tokens: $MAX_TOKENS"
echo ""
echo "Response:"

curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"$PROMPT\",
    \"model\": \"tinyllama-1.1b\",
    \"max_tokens\": $MAX_TOKENS
  }" \
  2>/dev/null | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
      # Extract token from JSON (requires jq)
      if command -v jq &> /dev/null; then
        echo -n "$line" | sed 's/data: //' | jq -r '.token' | tr -d '\n'
      else
        # Fallback: simple extraction without jq
        echo -n "$line" | sed 's/data: //' | grep -o '"token":"[^"]*"' | sed 's/"token":"\([^"]*\)"/\1/' | tr -d '\n'
      fi
    fi
  done

echo ""
echo ""
echo "Test complete!"
