# Build from the repository root, so that web/ is in the context:
#
#   docker build -f serve/Dockerfile -t reviewer .

FROM golang:1.25-alpine AS build

WORKDIR /src/serve

# The module has no dependencies, so there is nothing to download and no layer
# worth caching separately.
COPY serve/go.mod ./
COPY serve/*.go ./

# What gets served, copied in here rather than committed, so the image always
# embeds the tree of the commit it was built from. The placeholder web/ in the
# source tree is deliberately not copied.
#
# The marketing pages take the root and the interface sits under /app/, which is
# what the site's own markup assumes: one origin, so the demo the homepage pins
# into the page is a same-origin frame and the interface needs no second
# property to drift away from.
COPY site ./web
COPY web ./web/app

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
