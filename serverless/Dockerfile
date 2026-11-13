# The Go backend's API as a plain HTTP server (#556), for the local stacks and the end-to-end
# suite, which run the same code as Lambda: cmd/api serves HTTP wherever it is not on Lambda. Not
# deployed anywhere; a release builds the functions themselves (serverless/build.sh, #555).

# The toolchain go.mod names, so the image builds what CI tests; passed in rather than written
# twice (e2e-serverless.yml, end-to-end-stack.md).
ARG GO_VERSION
FROM docker.io/library/golang:${GO_VERSION} AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# Nothing but the binary: it needs no shell, and the stacks ask whether it serves from outside.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
EXPOSE 8080
ENTRYPOINT ["/api"]
