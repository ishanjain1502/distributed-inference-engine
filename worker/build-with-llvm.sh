#!/bin/bash
# Wrapper that sets NM_PATH and OBJCOPY_PATH from LIBCLANG_PATH (or uses existing) then runs cargo.
# Use this when running from the worker dir so the llama_cpp_sys build sees llvm-nm and llvm-objcopy.
if [ -n "$LIBCLANG_PATH" ]; then
    export NM_PATH="${LIBCLANG_PATH}/llvm-nm.exe"
    export OBJCOPY_PATH="${LIBCLANG_PATH}/llvm-objcopy.exe"
    echo "NM_PATH set from LIBCLANG_PATH: $NM_PATH"
    echo "OBJCOPY_PATH set from LIBCLANG_PATH: $OBJCOPY_PATH"
fi
if [ -z "$NM_PATH" ]; then
    echo "Warning: Set LIBCLANG_PATH or NM_PATH (e.g. export NM_PATH='C:/Program Files/LLVM/bin/llvm-nm.exe')"
fi
if [ -z "$OBJCOPY_PATH" ]; then
    echo "Warning: Set OBJCOPY_PATH (e.g. export OBJCOPY_PATH='C:/Program Files/LLVM/bin/llvm-objcopy.exe')"
fi
exec cargo "$@"
