# NotebookFlow engine — production container for Fly.io / Railway / Render / etc.
#
# Builds the FastAPI engine into a single-stage image. uv handles the Python
# environment; the wheel bundles every nodebookflow.* module so `uv run
# notebookflow` brings up the server immediately.

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH=/app/.venv/bin:$PATH

# Install uv from the official Astral image — small, statically linked.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app
COPY engine/ ./engine/

# Install the engine + its optional 'dev' extras (pytest etc.) so the same
# container can run tests on demand. Drop --all-extras if you want a smaller
# image for pure production.
RUN cd engine && uv sync --frozen --all-extras

EXPOSE 8765

# Fly / Railway / most PaaS expose a PORT env var; server.py reads it.
ENV PORT=8765

CMD ["uv", "--project", "engine", "run", "notebookflow"]
