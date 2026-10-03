# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (like argon2)
RUN apk add --no-cache python3 make g++

# Copy package files and install dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# Stage 2: Run the production application
FROM node:20-alpine

WORKDIR /app

# Copy necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Expose the port the app runs on
EXPOSE 3000

# Start the application in production mode
CMD ["npm", "run", "start:prod"]