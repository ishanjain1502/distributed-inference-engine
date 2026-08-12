# syntax=docker/dockerfile:1
# Build context: repository root
FROM rust:1-bookworm AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    cmake \
    pkg-config \
    clang \
    libclang-dev \
    llvm \
    build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/Cargo.toml worker/Cargo.lock ./
COPY worker/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release \
    && cp /app/target/release/worker /app/worker-bin

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/worker-bin /usr/local/bin/worker
COPY scripts/ensure_model.sh scripts/worker-entrypoint.sh /app/scripts/
RUN chmod +x /app/scripts/ensure_model.sh /app/scripts/worker-entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/app/scripts/worker-entrypoint.sh"]
CMD ["worker"]
