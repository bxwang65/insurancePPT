import json, os
# Compare success vs error AIA sessions
success = ["16e53d98-788c-4667-85a7-1e2c27dc685b.json", "62e877c9-7987-4599-8035-d8bef4288101.json", "6ada1cd3-41b4-47c9-a5ae-7e0191781903.json", "998c2322-aeb6-4ab8-a515-f2cc32d2be90.json"]
errors = ["c2ca5f3b-e47b-4091-99b6-e435b734ff26.json", "d6ef78ba-f3c9-4817-8742-2181a3125eac.json", "e2fd35f5-da7c-474c-900b-df8498a66bbf.json", "f468c18e-38d1-4e43-aef0-1a2d939cfd7c.json"]
for label, files in [("SUCCESS", success), ("ERROR", errors)]:
    print(f"\n========= {label} =========")
    for fn in files:
        path = f"/opt/insurance-ppt/sessions/{fn}"
        if not os.path.exists(path):
            continue
        d = json.load(open(path))
        status = d.get("status")
        sc = d.get("slideCount")
        ppt = d.get("pptPath")
        print(f"\n{fn[:8]} status={status} slides={sc} ppt={bool(ppt)}")
        print(f"  Files ({len(d.get('files', []))}):")
        for f_ in d.get("files", []):
            print(f"    {f_.get('companyId', '?'):15s} | {f_.get('type', '?'):8s} | {f_.get('name')}")
        # show extractions product names
        for e in d.get("extractions", []):
            if isinstance(e, dict):
                data = e.get("data") or {}
                pname = data.get("product_name", "?") if isinstance(data, dict) else "?"
                ins = data.get("insured", {}) if isinstance(data, dict) else {}
                print(f"    EXTRACT: {pname} | age={ins.get('age', '?')} | err={bool(e.get('error'))}")
        # show last chat msg length
        ch = d.get("chatHistory", [])
        print(f"  Chat msgs: {len(ch)}")
        for m in ch[-2:]:
            if isinstance(m, dict):
                content = (m.get("content") or "")[:150].replace("\n", " | ")
                print(f"    [{m.get('role')}]: {content}")
