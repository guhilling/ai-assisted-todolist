FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# The version the footer shows; release.yml passes the tag's, every other build leaves it empty.
ARG VITE_TASKFEST_VERSION=
ENV VITE_TASKFEST_VERSION=$VITE_TASKFEST_VERSION
RUN npm run build

# Red Hat's hardened Apache image: non-root on 8080, and no shell in it at all, so anything
# the runtime needs has to be COPYed in rather than assembled with RUN.
FROM registry.access.redhat.com/hi/httpd:2
COPY docker/httpd.conf /etc/httpd/conf.d/taskfest.conf
COPY --from=build /app/dist /var/www/html
EXPOSE 8080
