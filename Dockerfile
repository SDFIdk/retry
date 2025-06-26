FROM node:24-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy files to the container
COPY . .    

# Install dependencies
RUN npm ci

# Run the tests
CMD ["npm", "run", "test"]
