#!/usr/bin/env bash
# Avinstallerer doc-aide for ALLE AI-verktøy.
#
# Kjører hver implementations/<ai>/uninstall.sh. Hver enkelt ber om egen
# bekreftelse før den sletter noe.
#
# Vil du bare avinstallere én AI, kjør dens script direkte, f.eks.:
#   implementations/codex/uninstall.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🗑️  doc-aide — avinstallerer alle AI-verktøy"
echo "==============================================="

status=0
for ai in claude-code copilot codex gemini; do
  echo ""
  echo "═══════ $ai ═══════"
  if "$ROOT/implementations/$ai/uninstall.sh"; then
    echo "✅ $ai ferdig"
  else
    echo "⚠️  $ai feilet (hopper videre)"
    status=1
  fi
done

echo ""
if [ "$status" -eq 0 ]; then
  echo "✅ Alle avinstallert."
else
  echo "⚠️  Én eller flere feilet — se loggen over."
fi
exit "$status"
