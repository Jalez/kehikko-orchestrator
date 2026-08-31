#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - No port on the `vite` line, and no `--strictPort`. Both used to be there,
#     with 7850 written here and again in `register.ts` — 7820 through 7960
#     belong to the other modules on this machine — so moving this one meant two
#     edits and then remembering that the file in `~/.roadmap/modules` still
#     named the old address. It is said once now, beside the id, as
#     `PREFERRED_PORT` in `manifest.ts`.
#
#     $PORT is still honoured, by `serves()` in `vite.config.ts` rather than by
#     this line, and for the reason this bullet always gave: whoever starts this
#     chose the port, and a module that picked its own would answer somewhere
#     nobody is looking. A host passes the port from the registration when it
#     spawns this script, which is the address it is about to go and read.
#
#     What `--strictPort` bought was a module that DIED on a taken port rather
#     than one answering quietly somewhere else, and that was the only honest
#     option while nothing handled a collision. It is a bad trade here in
#     particular: a host with no roster cannot offer to stop a session this
#     module started, so dying leaves running agents with nothing on screen
#     attached to them. `serves()` handles the collision instead — a free 7850 is
#     taken in silence, this module already answering there ends the start
#     cleanly instead of making a second roster over the same sessions, and
#     anything else is a loud move with the registration rewritten to the port
#     actually bound.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so the module runs beside its own
#     source however it was invoked.
#
# It does NOT register a module that had none. Registration is a deliberate act
# by a person — see `register.ts` — and a start script that quietly wrote into
# somebody's home directory would be doing it on their behalf, which is a sharper
# point here than elsewhere because what gets framed has a button that starts
# processes. That argument is untouched. What the Vite plugin now writes on every
# start is this module's ADDRESS, which is a different sentence: the person
# decided to be framed, they did not decide to be framed at 7850 in particular,
# and a registration still naming a port this module has drifted off is one the
# host sweeps to find nothing.
#
# ## $ORCHESTRATOR_DIRS, and why it is not set here
#
# This module starts Claude Code sessions, and the list of directories it may
# start one in comes from the environment of whoever starts this process. It is
# deliberately not defaulted in this file: a default here would be this script
# choosing a repository for somebody else's agent to edit, which is the one
# decision `scope.ts` refuses to make. Unset means the roster shows every
# session on the machine and the start button says, in words, which variable to
# set.
#
#     ORCHESTRATOR_DIRS=/Users/you/Projects/thing:/Users/you/Projects/other ./run.sh
#
# ## There is no build here, and no `dist`
#
# There was going to be. The argument for one is that starting should be
# starting: a start that shells out to a build is a start that fails when the
# network is down. The argument is fine and the shape is still wrong, because
# this program is not deployed — it runs on the machine of the person editing
# it. What `dist` actually buys is a STALE page served with a 200, every symptom
# of a working app and none of the changes, and that failure has cost this
# codebase whole afternoons three separate times in three different programs. A
# missing build announces itself. A stale one does not.
#
# So Vite serves the page, as Vite is for. The manifest, the health check and
# this module's own `/api` are middleware in front of the same server — see
# `doors()` in `vite.config.ts` — because a module is one origin or it is
# nothing, and because a page that fetched its own roster from a second port
# would be fetching it cross-origin.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite
