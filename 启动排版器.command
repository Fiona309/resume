#!/bin/zsh
cd "${0:A:h}"
PORT=4173
open "http://localhost:${PORT}"
python3 -m http.server "$PORT"
