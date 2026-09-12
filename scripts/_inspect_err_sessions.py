import json, sys, os
files = ["c2ca5f3b-e47b-4091-99b6-e435b734ff26.json", "d6ef78ba-f3c9-4817-8742-2181a3125eac.json", "e2fd35f5-da7c-474c-900b-df8498a66bbf.json", "f468c18e-38d1-4e43-aef0-1a2d939cfd7c.json"]
for fn in files:
    path = f"/opt/insurance-ppt/sessions/{fn}"
    if not os.path.exists(path):
        print(f"MISSING: {fn}")
        continue
    d = json.load(open(path))
    status = d.get("status")
    files_list = d.get("files", [])
    ch = d.get("chatHistory", [])
    exs = d.get("extractions", [])
    print(f"=== {fn} ===")
    print(f"  status: {status}")
    print(f"  files: {len(files_list)}")
    for f_ in files_list:
        nm = f_.get("name")
        ty = f_.get("type")
        co = f_.get("companyId")
        print(f"    - {nm} ({ty}/{co})")
    print(f"  extractions: {len(exs)}")
    print(f"  chat history: {len(ch)}")
    for i, m in enumerate(ch):
        if isinstance(m, dict):
            role = m.get("role")
            content = (m.get("content") or "")[:300].replace("\n", " | ")
            print(f"    [{i}] {role}: {content}")
    print(f"  slideCount: {d.get('slideCount')}")
    print(f"  pptPath: {d.get('pptPath')}")
    print()
