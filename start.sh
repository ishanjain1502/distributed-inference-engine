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
cd "$ROOT_DIR/worker"
cargo build
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to build worker!${NC}"
    cleanup
    exit 1
fi
echo -e "${GREEN}Worker built successfully${NC}"

echo -e "${YELLOW}Starting Worker on port 3001...${NC}"
cargo run &
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

