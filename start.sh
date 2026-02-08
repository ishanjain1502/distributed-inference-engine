#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Inference Engine Startup Script      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Store the root directory
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Track PIDs for cleanup
COORDINATOR_PID=""
WORKER_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    
    if [ -n "$COORDINATOR_PID" ]; then
        kill $COORDINATOR_PID 2>/dev/null
        echo -e "${RED}Coordinator stopped${NC}"
    fi
    
    if [ -n "$WORKER_PID" ]; then
        kill $WORKER_PID 2>/dev/null
        echo -e "${RED}Worker stopped${NC}"
    fi
    
    exit 0
}

trap cleanup SIGINT SIGTERM

# Build and start Coordinator
echo -e "${YELLOW}[1/2] Building Coordinator...${NC}"
cd "$ROOT_DIR/coordinator"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build coordinator!${NC}"
    exit 1
fi
echo -e "${GREEN}Coordinator built successfully${NC}"

echo -e "${YELLOW}Starting Coordinator on port 1337...${NC}"
npm start &
COORDINATOR_PID=$!
echo -e "${GREEN}Coordinator started (PID: $COORDINATOR_PID)${NC}"
echo ""

# Build and start Worker
echo -e "${YELLOW}[2/2] Building Worker...${NC}"
# llama_cpp_sys needs llvm-nm and llvm-objcopy; derive from LIBCLANG_PATH if set (same LLVM bin dir)
if [ -n "$LIBCLANG_PATH" ]; then
    export NM_PATH="${LIBCLANG_PATH}/llvm-nm.exe"
    export OBJCOPY_PATH="${LIBCLANG_PATH}/llvm-objcopy.exe"
    echo -e "${CYAN}NM_PATH set from LIBCLANG_PATH: $NM_PATH${NC}"
    echo -e "${CYAN}OBJCOPY_PATH set from LIBCLANG_PATH: $OBJCOPY_PATH${NC}"
elif [ -z "$NM_PATH" ]; then
    echo -e "${YELLOW}Warning: LIBCLANG_PATH and NM_PATH not set; worker build may fail (need llvm-nm)${NC}"
fi
if [ -z "$OBJCOPY_PATH" ] && [ -z "$LIBCLANG_PATH" ]; then
    echo -e "${YELLOW}Warning: OBJCOPY_PATH not set; set to llvm-objcopy.exe path if worker build fails${NC}"
fi
cd "$ROOT_DIR/worker"
cargo build
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build worker!${NC}"
    cleanup
    exit 1
fi
echo -e "${GREEN}Worker built successfully${NC}"

echo -e "${YELLOW}Starting Worker on port 3001...${NC}"
if [ -z "$MODEL_PATH" ]; then
    echo -e "${YELLOW}Warning: MODEL_PATH not set, using default${NC}"
elif echo "$MODEL_PATH" | grep -q '\\'; then
    echo -e "${YELLOW}Tip: Use forward slashes in MODEL_PATH (e.g. E:/Projects/.../file.gguf) to avoid path corruption in Git Bash${NC}"
fi
MODEL_PATH=$MODEL_PATH cargo run &
WORKER_PID=$!
echo -e "${GREEN}Worker started (PID: $WORKER_PID)${NC}"
echo ""

echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║        Both servers are running!         ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Coordinator: http://localhost:1337      ║${NC}"
echo -e "${GREEN}║  Worker:      http://localhost:3001      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Press Ctrl+C to stop both servers${NC}"
echo ""

# Wait for both processes
wait

