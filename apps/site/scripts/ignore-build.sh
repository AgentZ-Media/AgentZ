#!/bin/sh
# Vercel "ignoreCommand": exit 0 skips the deployment, exit 1 builds.
# Builds when the site, the design package or the workspace changed since
# the last deployment. When that commit is missing (first deployment, or
# outside the shallow clone after a large merge), it builds.
prev="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$prev" ] || ! git cat-file -e "$prev^{commit}" 2>/dev/null; then
  exit 1
fi
git diff --quiet "$prev" HEAD -- . ../../packages/design ../../pnpm-lock.yaml ../../pnpm-workspace.yaml ../../package.json
