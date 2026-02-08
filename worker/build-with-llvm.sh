#!/bin/bash
# Wrapper that sets NM_PATH from LIBCLANG_PATH (or uses existing NM_PATH) then runs cargo.
# Use this when running from the worker dir so the llama_cpp_sys build sees llvm-nm.
if [ -n "$LIBCLANG_PATH" ]; then
    export NM_PATH="${LIBCLANG_PATH}/llvm-nm.exe"
    echo "NM_PATH set from LIBCLANG_PATH: $NM_PATH"
fi
if [ -z "$NM_PATH" ]; then
    echo "Warning: Set LIBCLANG_PATH or NM_PATH (e.g. export NM_PATH='C:/Program Files/LLVM/bin/llvm-nm.exe')"
fi
exec cargo "$@"
