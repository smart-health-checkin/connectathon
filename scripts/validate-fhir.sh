#!/usr/bin/env bash
# Validates this repo's FHIR content with the latest HL7 validator.
#   Questionnaire/*.json    against FHIR R4
#   testing-wallet/data/*   against US Core and the CARIN digital insurance card IG (when present)
# Downloads validator_cli.jar into .tools/ if missing. Exits 1 on any error.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tools
JAR=.tools/validator_cli.jar
if [ ! -f "$JAR" ] || [ "${REFRESH_VALIDATOR:-}" = 1 ]; then
  curl -sSL -o "$JAR" https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar
fi
java -jar "$JAR" -version 2>/dev/null | head -1 || true

run() { # label, output, args...
  local label=$1 out=$2; shift 2
  echo "== $label"
  java -jar "$JAR" "$@" -output "$out" > "$out.log" 2>&1 || true
  python3 scripts/report-validation.py "$out"
}

status=0
run "Questionnaires against R4" .tools/questionnaires.json Questionnaire/*.json -version 4.0.1 || status=1
if compgen -G "testing-wallet/data/*.json" > /dev/null; then
  run "Wallet patient data against US Core and CARIN" .tools/wallet-data.json testing-wallet/data/*.json \
    -version 4.0.1 -ig hl7.fhir.us.core -ig hl7.fhir.us.insurance-card || status=1
fi
exit $status
