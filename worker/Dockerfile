# syntax=docker/dockerfile:1
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
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release \
    && cp /app/target/release/worker /app/worker-bin

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/worker-bin /usr/local/bin/worker
EXPOSE 3001
CMD ["worker"]
