#!/usr/bin/env bash
# Prints the SubjectPublicKeyInfo SHA-256 pins (the value Android's
# network_security_config <pin digest="SHA-256"> expects) for:
#   tools/spki-pin.sh host api.example.com        every certificate in the live chain
#   tools/spki-pin.sh pem  some-root.pem           one PEM certificate (e.g. a downloaded root)
# T4.10. Needs openssl.
set -euo pipefail

pin_of_pem() {
  openssl x509 -pubkey -noout \
    | openssl pkey -pubin -outform der \
    | openssl dgst -sha256 -binary \
    | openssl enc -base64
}

case "${1:-}" in
  host)
    host="${2:?host}"
    port="${3:-443}"
    chain="$(openssl s_client -connect "${host}:${port}" -servername "${host}" -showcerts </dev/null 2>/dev/null)"
    n=0
    while IFS= read -r line; do
      if [[ "$line" == "-----BEGIN CERTIFICATE-----" ]]; then buf="$line"$'\n'; inside=1; continue; fi
      if [[ "${inside:-0}" == 1 ]]; then
        buf+="$line"$'\n'
        if [[ "$line" == "-----END CERTIFICATE-----" ]]; then
          inside=0
          subject="$(printf '%s' "$buf" | openssl x509 -noout -subject 2>/dev/null | sed 's/^subject=//')"
          pin="$(printf '%s' "$buf" | pin_of_pem)"
          printf '%d  %s\n    %s\n' "$n" "$subject" "$pin"
          n=$((n + 1))
        fi
      fi
    done <<< "$chain"
    ;;
  pem)
    pin_of_pem < "${2:?pem file}"
    ;;
  *)
    echo "usage: $0 host <hostname> [port] | pem <file.pem>" >&2
    exit 2
    ;;
esac
