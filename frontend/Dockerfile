FROM node:20-alpine AS builder
WORKDIR /app
# Copy package files from the frontend folder in the build context
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
# Copy the rest of the frontend source code
COPY frontend ./
RUN npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/dist/ /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
