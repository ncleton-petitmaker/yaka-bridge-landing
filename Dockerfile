FROM node:24-alpine

WORKDIR /app

COPY public/ ./public/
COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
