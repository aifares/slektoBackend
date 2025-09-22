# Use the official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install any needed packages specified in package.json
RUN npm ci --only=production

# Install Supercronic for cron-like scheduling in containers
RUN wget -O /usr/local/bin/supercronic https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 \
  && chmod +x /usr/local/bin/supercronic

# Copy the rest of the application code
COPY . .

# Copy crontab
COPY cron/crontab /etc/crontab

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Define environment variable
ENV NODE_ENV=production

# Default command runs the web app process; cron is configured via Fly processes
CMD ["node", "backend/server.js"]
