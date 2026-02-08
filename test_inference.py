#!/usr/bin/env python3
"""
Simple test script for the inference endpoint.
Usage: python test_inference.py "Your prompt here" [max_tokens]
"""

import requests
import json
import sys

def test_inference(prompt, max_tokens=50):
    url = "http://localhost:1337/coordinator/infer"
    payload = {
        "prompt": prompt,
        "model": "gemma-3-270m",
        "max_tokens": max_tokens
    }
    
    print(f"Prompt: {prompt}")
    print(f"Max tokens: {max_tokens}")
    print("\nResponse: ", end="", flush=True)
    
    try:
        response = requests.post(url, json=payload, stream=True, timeout=30)
        
        if response.status_code != 200:
            print(f"\nError: HTTP {response.status_code}")
            print(response.text)
            return False
        
        token_count = 0
        for line in response.iter_lines():
            if line:
                line = line.decode('utf-8')
                if line.startswith('data: '):
                    try:
                        data = json.loads(line[6:])
                        token = data.get('token', '')
                        print(token, end='', flush=True)
                        token_count += 1
                    except json.JSONDecodeError:
                        pass
        
        print(f"\n\nGenerated {token_count} tokens")
        return True
        
    except requests.exceptions.ConnectionError:
        print("\nError: Could not connect to coordinator. Is it running?")
        print("Try: curl http://localhost:1337/coordinator/health")
        return False
    except Exception as e:
        print(f"\nError: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 1:
        prompt = sys.argv[1]
    else:
        prompt = "What is the capital of France?"
    
    max_tokens = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    
    success = test_inference(prompt, max_tokens)
    sys.exit(0 if success else 1)
