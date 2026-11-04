# pof-attest: the attestor service plus the demo holder.
# Build from the repo root (the image needs fixtures/ and the merged anchor table):
#   docker build -f backend/Dockerfile -t pof-attest .
#   docker run -p 8787:8787 -e POF_ATTEST_KEY=<32-byte hex> pof-attest

FROM rust:1-bookworm AS build
WORKDIR /src/backend
# rust-toolchain.toml pins the exact compiler; rustup installs it on first use
COPY backend/rust-toolchain.toml ./
RUN rustup show active-toolchain || rustup toolchain install
COPY backend/ ./
RUN cargo build --release --locked -p pof-attest && strip target/release/pof-attest

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/backend/target/release/pof-attest /usr/local/bin/pof-attest
# Anchors the attestor trusts (mainnet + testnet + demo), the demo ledger, and the demo revocation list
COPY frontend/src/data/anchors.json /app/anchors.json
COPY fixtures/demo-world.json /app/demo-world.json
COPY fixtures/revocations.demo.json /app/revocations.demo.json
ENV POF_ANCHORS=/app/anchors.json \
    POF_DEMO_WORLD=/app/demo-world.json \
    POF_REVOCATIONS_FILE=/app/revocations.demo.json \
    POF_AUDIENCE=pof-credit:usdc-pool-1 \
    PORT=8787 \
    RUST_LOG=info
EXPOSE 8787
USER nobody
CMD ["pof-attest"]
