FROM node:22-alpine AS build
WORKDIR /app/bff
COPY bff/package.json bff/package-lock.json ./
RUN npm ci
COPY backend/src/main/proto/ /app/backend/src/main/proto/
COPY bff/codegen.yml bff/tsconfig.json ./
COPY bff/schema/ ./schema/
COPY bff/src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app/bff
COPY --from=build /app/bff/node_modules ./node_modules
COPY --from=build /app/bff/dist ./dist
COPY --from=build /app/bff/schema ./schema
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
