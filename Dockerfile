
# Use lightweight Node.js image
FROM node:18-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy server source code
COPY server ./server

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "server/server.js"]
