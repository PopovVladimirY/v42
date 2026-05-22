# Stage 1: build -- full Go toolchain, thrown away after compilation
FROM golang:1.25-alpine AS builder

WORKDIR /app

# cache module downloads separately from source -- faster rebuilds
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /bin/v42 \
    ./cmd/api

# Stage 2: runtime -- 15MB instead of 800MB, as it should be
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=builder /bin/v42 ./v42

EXPOSE 8080
ENTRYPOINT ["./v42"]
