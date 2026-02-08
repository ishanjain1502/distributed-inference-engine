# Testing Guide for Gemma 3 270M

This guide will help you test the inference engine with a Gemma 3 270M model.

## Prerequisites

1. **Rust 1.88+** (required by `llama_cpp` crate)
   ```bash
   rustup update
   rustc --version  # Should show 1.88 or higher
   ```

2. **Node.js 18+** (for the coordinator)

3. **Gemma 3 270M GGUF Model File**

## Step 1: Get the Gemma 3 Model

You can download a GGUF quantized version of Gemma 3 270M from:

- **Hugging Face**: Search for "gemma-3-270m-it" or "gemma-3-270m" in GGUF format
- **Direct download example** (check for latest versions):
  ```bash
  # Example - adjust URL based on actual availability
  mkdir -p models
  cd models
  # Download a quantized version (Q8_0, Q4_K_M, or Q4_0 are good options)
  wget https://huggingface.co/.../gemma-3-270m-it-Q8_0.gguf
  ```

**Recommended quantizations:**
- `Q8_0` - Best quality, larger file (~500MB)
- `Q4_K_M` - Good balance of quality and size (~250MB)
- `Q4_0` - Smaller file, slightly lower quality (~200MB)

## Step 2: Set Up the Environment

### Option A: Using the Startup Script (Recommended)

1. Set the model path as an environment variable:
   ```bash
   export MODEL_PATH=/path/to/your/gemma-3-270m-it-Q8_0.gguf
   ```

2. Update `start.sh` to pass the environment variable to the worker:
   ```bash
   # Edit start.sh line 69 to:
   MODEL_PATH=$MODEL_PATH cargo run &
   ```

### Option B: Manual Setup

**Terminal 1 - Coordinator:**
```bash
cd coordinator
npm install
npm run build
npm start
```

**Terminal 2 - Worker:**
```bash
cd worker
export MODEL_PATH=/path/to/your/gemma-3-270m-it-Q8_0.gguf
cargo build --release
cargo run
```

**Note:** On Windows, use:
```cmd
set MODEL_PATH=E:\path\to\your\gemma-3-270m-it-Q8_0.gguf
```

## Step 3: Verify Services Are Running

Check that both services are up:

```bash
# Check coordinator health
curl http://localhost:1337/coordinator/health

# Check worker health
curl http://localhost:3001/worker/health

# List registered workers
curl http://localhost:1337/coordinator/health/workers
```

Expected responses:
- Coordinator: `{"alive":true,"workers":1}`
- Worker: `{"alive":true,"active_sessions":0,"kv_cache_bytes":0}`
- Workers list: Should show your worker

## Step 4: Test Inference

### Using curl (Server-Sent Events)

```bash
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the capital of France?",
    "model": "gemma-3-270m",
    "max_tokens": 50
  }'
```

You should see SSE events like:
```
data: {"token":"The","seq":0}
data: {"token":" capital","seq":1}
data: {"token":" of","seq":2}
...
```

### Using a Simple Test Script

Create `test_inference.sh`:

```bash
#!/bin/bash

echo "Testing inference with Gemma 3..."
echo ""

curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a haiku about programming:",
    "model": "gemma-3-270m",
    "max_tokens": 30
  }' \
  2>/dev/null | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
      echo "$line" | sed 's/data: //' | jq -r '.token' | tr -d '\n'
    fi
  done

echo ""
echo ""
echo "Test complete!"
```

Make it executable and run:
```bash
chmod +x test_inference.sh
./test_inference.sh
```

### Using Python

Create `test_inference.py`:

```python
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
    
    print(f"Prompt: {prompt}\n")
    print("Response: ", end="", flush=True)
    
    response = requests.post(url, json=payload, stream=True)
    
    if response.status_code != 200:
        print(f"Error: {response.status_code}")
        print(response.text)
        return
    
    for line in response.iter_lines():
        if line:
            line = line.decode('utf-8')
            if line.startswith('data: '):
                data = json.loads(line[6:])
                print(data['token'], end='', flush=True)
    
    print("\n")

if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "Hello, how are you?"
    test_inference(prompt)
```

Run it:
```bash
python test_inference.py "Explain quantum computing in simple terms:"
```

## Step 5: Monitor Logs

Watch the worker logs to see model operations:

```bash
# If running manually, logs will appear in the terminal
# Look for:
# - "Model loaded successfully"
# - "session.start" (when prefill completes)
# - "Emitted token" (during decode)
# - "session.end" (when generation completes)
```

## Troubleshooting

### Model Not Found

**Error:** `Model file not found: /models/gemma-3-270m-it-Q8_0.gguf`

**Solution:** 
- Verify the file exists: `ls -lh /path/to/model.gguf`
- Set `MODEL_PATH` environment variable correctly
- Use absolute path if relative path doesn't work

### Rust Version Too Old

**Error:** `rustc 1.85.0 is not supported`

**Solution:**
```bash
rustup update
rustc --version  # Verify it's 1.88+
```

### Worker Fails to Start

**Check:**
1. Model file exists and is readable
2. Sufficient memory (270M model needs ~1-2GB RAM)
3. Port 3001 is not in use: `lsof -i :3001` (Linux/Mac) or `netstat -ano | findstr :3001` (Windows)

### No Tokens Generated

**Possible causes:**
1. Model file is corrupted - re-download
2. Wrong model format - ensure it's GGUF, not safetensors
3. Check worker logs for error messages

### Coordinator Returns 503 "System at capacity"

**This is normal** if:
- Too many concurrent sessions
- KV cache limits exceeded

**Solution:** Wait for existing sessions to complete or increase limits in `worker/src/state.rs`

### Coordinator Returns 502 "Worker unreachable"

**Check:**
1. Worker is running: `curl http://localhost:3001/worker/health`
2. Worker registered with coordinator: `curl http://localhost:1337/coordinator/health/workers`
3. Network connectivity between coordinator and worker

## Performance Expectations

For Gemma 3 270M on typical hardware:

- **Prefill time**: 100-500ms (depends on prompt length)
- **Token generation**: 10-50 tokens/second (depends on hardware)
- **Memory usage**: ~1-2GB for model + KV cache

## Next Steps

Once basic inference works:

1. **Test with longer prompts** - verify KV cache estimation
2. **Test concurrent requests** - verify session management
3. **Monitor metrics** - check TPS and latency
4. **Test failure scenarios** - stop worker mid-generation, etc.

## Example Test Cases

```bash
# Short prompt
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hi","model":"gemma-3-270m","max_tokens":10}'

# Longer prompt
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a detailed explanation of how neural networks work:","model":"gemma-3-270m","max_tokens":100}'

# Code generation
curl -N -X POST http://localhost:1337/coordinator/infer \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a Python function to calculate fibonacci:","model":"gemma-3-270m","max_tokens":50}'
```
