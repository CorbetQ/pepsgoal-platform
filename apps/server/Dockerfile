# Image de production du serveur PepsGoal (contexte de build : racine du dépôt)
FROM node:20-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
# Espace de travail réduit au serveur : l'application mobile n'est pas nécessaire dans l'image
RUN printf '{"private":true,"workspaces":["packages/shared","apps/server"]}' > package.json \
 && npm install \
 && npm run build -w packages/shared \
 && npm run build -w apps/server \
 && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/apps/server/media && chown -R node:node /app/apps/server/media
USER node
WORKDIR /app/apps/server
EXPOSE 8080
# Migrations puis démarrage : une base vide ou ancienne est mise à jour automatiquement
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
