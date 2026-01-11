# Build stage for Rust backend
FROM rust:1.85-bookworm AS builder

WORKDIR /app

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

# Build the application
RUN cargo build --release

# Build stage for frontend
FROM node:20-bookworm AS frontend

WORKDIR /app

# Copy package files and install dependencies
COPY client/package*.json ./
RUN npm ci

# Copy source and build
COPY client ./
RUN npm run build

# Runtime stage
FROM debian:bookworm-slim

# Install TeX Live and other dependencies
# Using texlive-latex-extra instead of texlive-full for smaller image size
# Add texlive-full for complete LaTeX support (but larger image ~4GB)
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-science \
    texlive-bibtex-extra \
    biber \
    latexmk \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -u 1000 openleaf

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/target/release/openleaf-server ./

# Copy frontend build
COPY --from=frontend /app/dist ./static

# Create data directory
RUN mkdir -p /data/projects && chown -R openleaf:openleaf /data

# Switch to non-root user
USER openleaf

# Environment variables
ENV DATABASE_URL="sqlite:///data/openleaf.db?mode=rwc"
ENV STORAGE_PATH="/data/projects"
ENV PORT="3000"

# Expose port
EXPOSE 3000

# Volume for persistent data
VOLUME ["/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the server
CMD ["./openleaf-server"]
