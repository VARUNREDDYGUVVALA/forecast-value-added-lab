FROM node:24-slim AS dashboard
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN VITE_USE_API=true npm run build

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    pip install --no-cache-dir -r requirements.txt
COPY --chown=65532:65532 backend ./backend
COPY --chown=65532:65532 src/catalog.json ./src/catalog.json
COPY --from=dashboard --chown=65532:65532 /app/dist ./dist
USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8080"]
