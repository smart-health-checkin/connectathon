"""Prints errors and warnings from a validator -output file; exits 1 on errors."""
import json, sys
# Accepted for this project's generated resources: missing narrative (dom-6).
IGNORE = ("dom-6",)
d = json.load(open(sys.argv[1]))
entries = d.get("entry") or [{"resource": d}]
errors = 0
for e in entries:
    oo = e["resource"]
    name = next((x.get("valueString") for x in oo.get("extension", []) if "file" in x.get("url", "")), "?")
    issues = [i for i in oo.get("issue", []) if i["severity"] in ("fatal", "error", "warning")
              and not any(k in i.get("details", {}).get("text", "") for k in IGNORE)]
    errors += sum(1 for i in issues if i["severity"] in ("fatal", "error"))
    print(f"{name}: {sum(1 for i in issues if i['severity'] in ('fatal','error'))} error(s), {sum(1 for i in issues if i['severity']=='warning')} warning(s)")
    for i in issues:
        where = (i.get("expression") or [""])[0]
        print(f"  {i['severity']}: {where}: {i.get('details', {}).get('text', '')}")
sys.exit(1 if errors else 0)
