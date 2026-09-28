#!/bin/sh
# v2.4.0 uses the upstream entrypoint directly. Kept for old tooling only;
# compatibility changes live in homepage-image and are applied before building.
set -eu
exec /usr/local/bin/docker-entrypoint.sh "$@"
