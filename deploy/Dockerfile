# Xyvera MD — container image.
#
# Base image choice: node:22-slim (Debian/glibc). Alpine/musl is smaller, but
# the `sharp` media pipeline is happiest with the glibc prebuilt binaries; the
# size difference is not worth a broken image pipeline on a bot that spends its
# life on a network socket.
#
# Build:  docker build -f deploy/Dockerfile -t xyvera-md .
# Run:    docker run -d --name xyvera-md --env-file .env \
#           -v "$PWD/data:/app/data" --restart unless-stopped xyvera-md
#
# The WhatsApp session lives in /app/data/session — mount it or you re-pair
# after every container replacement.

FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first so the layer is cached across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code.
COPY . .

# data/ holds settings + the WhatsApp session; tmp/ holds media scratch.
VOLUME ["/app/data"]
ENV DATA_DIR=data TMP_DIR=tmp

# Non-root runtime user.
RUN chown -R node:node /app
USER node

# No -it, no shell: the process must own the terminal and handle SIGTERM.
CMD ["node", "src/index.js"]
