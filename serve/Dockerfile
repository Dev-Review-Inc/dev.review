# Build from the repository root, so that web/ is in the context:
#
#   docker build -f serve/Dockerfile -t reviewer .

FROM golang:1.25-alpine AS build

WORKDIR /src/serve

# The module has no dependencies, so there is nothing to download and no layer
# worth caching separately.
COPY serve/go.mod ./
COPY serve/*.go ./

# The interface, copied in here rather than committed, so the image always
# embeds the tree of the commit it was built from. The placeholder web/ in the
# source tree is deliberately not copied.
#
# It takes the root: this image is the app, served at dev.review. The
# marketing site is a separate image that builds on this one and mounts the
# interface under its own /app/, which is how the demo it frames stays
# same-origin without this image knowing anything about it.
COPY web ./web

# The install document, generated from the skills and advertised as an address
# people type. It sits at the repository root, where a reader looks for it, and
# is placed into the served tree here so that it answers at /install and so the
# marketing image can copy it out rather than keeping a second copy.
COPY install.md ./web/install.md

# Static, so the final stage needs no libc. -s -w drop the symbol and DWARF
# tables, which the binary does not need to serve files.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /reviewer-serve .

# distroless/static has no shell, no package manager, and no writable path. That
# is the whole appeal: this process reads nothing and writes nothing, so an
# image that cannot offer either is the honest shape for it.
#
# There is no HEALTHCHECK. It would need a shell or a second binary in the final
# image, which costs more than it is worth for a process whose liveness is
# exactly "the port answers". The orchestrator's own HTTP probe covers it, and
# Basecamp ONCE points that probe at /up.
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /reviewer-serve /reviewer-serve

# The interface again, this time as files rather than embedded in the binary.
# The binary does not need it; downstream images do. The marketing site is a
# separate image built on this one, and it copies the interface out of here so
# that the demo it frames is the published build rather than a second copy that
# drifts. A few hundred kilobytes buys that guarantee.
COPY --from=build /src/serve/web /web

# Runs as uid 65532, which the base image already provides. Nothing here needs
# root: Docker sets net.ipv4.ip_unprivileged_port_start=0, so an unprivileged
# user binds 80 without a capability being added.
USER nonroot:nonroot

EXPOSE 80

# Port 80 belongs here rather than in the -addr default, because it is a fact
# about the image and not about the program. Basecamp ONCE runs this container
# with no arguments and forwards to port 80, so the image has to answer there;
# development runs the binary directly and wants a port it can bind without
# privilege. CMD keeps both true, and being CMD rather than a baked-in default
# it is still one `docker run ... -addr :9000` away from being overridden.
ENTRYPOINT ["/reviewer-serve"]
CMD ["-addr", ":80"]
