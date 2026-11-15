export function getDockerfile(): string {
  return `FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production INCANTERM_HOST=0.0.0.0
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node game ./game
USER node
EXPOSE 7101
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.INCANTERM_HTTP_PORT||process.env.PORT||7101)+'/health',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js", "--project", "./game", "--no-ssh"]
`;
}

export function getDockerignore(): string {
  return `**
!Dockerfile
!package.json
!package-lock.json
!dist/
!dist/**
!game/
!game/**
**/node_modules/
**/.git/
**/.data/
**/.env*
**/.npmrc
**/*.pem
**/*.key
`;
}

export function getReleaseReadme(name: string): string {
  return `# ${name}

This is an exported Incanterm game, not the editor or source project.

## Node.js

Install Node.js 22+, then run from this directory:

\`\`\`sh
npm ci --omit=dev
npm start
\`\`\`

Open http://127.0.0.1:7101/play. The runtime also exposes /health and /ws.
Set INCANTERM_HOST=0.0.0.0 to listen outside localhost. Set PORT or
INCANTERM_HTTP_PORT to change the HTTP port (INCANTERM_HTTP_PORT takes precedence).
SSH is disabled by the start command; no writable host-key directory is needed.

## Docker

\`\`\`sh
docker build -t incanterm-game .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -p 127.0.0.1:7101:7101 incanterm-game
\`\`\`

The image runs as the non-root node user and exposes only HTTP/WebSocket on 7101.
Put an HTTPS reverse proxy in front of the container for public access. Proxy /ws
with WebSocket upgrades and an appropriate idle timeout, not just /play.
Do not deploy the Incanterm editor or expose SSH port 7102.

Sessions are in memory and tied to their WebSocket connection. Restarting the
service or losing a connection does not persist or resume a game. Start with one
instance; persistent saves and cross-instance session routing are not implemented.
This package does not add authentication, rate limits, or account management.

Game data is under game/. Only runtime assets were exported; editor reference
images, folder metadata, story notes, engine tests and development dependencies
are not included. release.json records the engine version and selected entry scene.
Re-export into a new output directory to publish updated game content.
`;
}
