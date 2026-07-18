FROM node:24-alpine AS builder
WORKDIR /app

ARG ENVIRONMENT=dev
ENV ENVIRONMENT=$ENVIRONMENT
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY package.json package-lock.json ./
RUN npm install

COPY . .

# ensure no accidental .env is present
RUN rm -f .env

# copy correct env file
RUN if [ "$ENVIRONMENT" = "prod" ]; then \
      cp .env.prod .env; \
    else \
      cp .env.dev .env; \
    fi


RUN npm run build -- --minify false

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY admin-proxy-common.conf /etc/nginx/snippets/admin-proxy-common.conf
COPY admin-proxy-legacy-rewrite.conf /etc/nginx/snippets/admin-proxy-legacy-rewrite.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
