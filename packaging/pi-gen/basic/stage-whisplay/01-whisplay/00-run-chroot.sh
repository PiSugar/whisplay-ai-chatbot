#!/bin/bash -e

/usr/local/lib/whisplay-image/provision-basic.sh
# Remove build-time helpers while keeping the boot selector and its profiles.
rm -f /usr/local/lib/whisplay-image/{install-*.sh,provision-basic.sh}
