#!/bin/sh
# Starts agentCowork. Started as root (compose.example.yaml), it isolates the agents first:
#  1. A firewall rule keeps the agents' user (`agent`) off the network: only loopback, where the platform's proxy lets
#     it reach the allowed hosts (src/egress.ts). Docker's DNS is refused too: names would reach the internet.
#  2. The platform runs as `node`, with only what it needs to run agents as `agent` (SETUID, SETGID), stop them (KILL)
#     and read and remove what they write (DAC_OVERRIDE). NET_ADMIN ends here.
# Started as any other user, it runs the platform as it is: agents then share the platform's user (the UI says so).
# Run again with another command (`docker exec <container> agentcowork-entrypoint node src/golden.ts …`), it runs that
# command as the platform runs; the firewall rule is replaced, not added twice.
set -eu

if [ "$(id -u)" != 0 ]; then exec "$@"; fi

# CAP_DAC_OVERRIDE (1), CAP_KILL (5), CAP_SETGID (6), CAP_SETUID (7).
needed=$((0xe2))
effective=$((0x$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)))
if [ $((effective & needed)) != "$needed" ]; then
  echo 'agentCowork: started as root without the capabilities it needs. Add cap_add: [SETUID, SETGID, KILL, DAC_OVERRIDE, NET_ADMIN] (see compose.example.yaml), or start it as user node to run agents as the platform'"'"'s user.' >&2
  exit 1
fi

uid=$(id -u agent)
if error=$(nft -f - 2>&1 <<EOF
table inet agentcowork
delete table inet agentcowork
table inet agentcowork {
  chain output {
    type filter hook output priority filter; policy accept;
    meta skuid $uid ip daddr 127.0.0.11 reject
    meta skuid $uid oifname != "lo" reject
  }
}
EOF
); then
  export AGENTCOWORK_FIREWALL=on
else
  export AGENTCOWORK_FIREWALL="off: nftables refused the rules (does the container have NET_ADMIN?): $(printf %s "$error" | head -c 200)"
fi

exec setpriv --reuid=node --regid=node --init-groups \
  --inh-caps=-all,+setuid,+setgid,+kill,+dac_override \
  --ambient-caps=-all,+setuid,+setgid,+kill,+dac_override \
  -- "$@"
