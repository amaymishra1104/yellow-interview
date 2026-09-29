FROM node:22-alpine

WORKDIR /app

# Install dependencies first for layer caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose standard container port
EXPOSE 3000

CMD ["node", "src/server.js"]
