import json, os
files = ["c2ca5f3b-e47b-4091-99b6-e435b734ff26.json", "d6ef78ba-f3c9-4817-8742-2181a3125eac.json", "e2fd35f5-da7c-474c-900b-df8498a66bbf.json", "f468c18e-38d1-4e43-aef0-1a2d939cfd7c.json"]
for fn in files:
    path = f"/opt/insurance-ppt/sessions/{fn}"
    d = json.load(open(path))
    status = d.get("status")
    print(f"=== {fn[:8]} status={status} ===")
    print(f"  Keys at root: {list(d.keys())}")
    print(f"  chat history count: {len(d.get('chatHistory', []))}")
    last_msg = d.get("chatHistory", [])[-1] if d.get("chatHistory") else None
    if last_msg:
        print(f"  last msg role: {last_msg.get('role')}")
        print(f"  last msg content length: {len(last_msg.get('content', ''))}")
    # Look for any error field at root level
    for k, v in d.items():
        if 'error' in k.lower() and v:
            print(f"  {k}: {str(v)[:200]}")
