#!/usr/bin/env bash
# Installerer doc-aide for ALLE AI-verktøy.
#
# Kjører hver implementations/<ai>/install.sh. Hver enkelt er selvstendig og
# installerer felles scripts (core/scripts) + sitt eget AI-spesifikke oppsett.
# De felles scriptene kopieres derfor flere ganger — det er billig og bevisst.
#
# Vil du bare installere én AI, kjør dens script direkte, f.eks.:
#   implementations/codex/install.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 doc-aide — installerer alle AI-verktøy"
echo "============================================="

status=0
for ai in claude-code copilot codex gemini; do
  echo ""
  echo "═══════ $ai ═══════"
  if "$ROOT/implementations/$ai/install.sh"; then
    echo "✅ $ai ferdig"
  else
    echo "⚠️  $ai feilet (hopper videre)"
    status=1
  fi
done

echo ""
if [ "$status" -eq 0 ]; then
  echo "✅ Alle installert."
else
  echo "⚠️  Én eller flere feilet — se loggen over."
fi
exit "$status"
