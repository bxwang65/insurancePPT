#!/usr/bin/env python3
"""
Ralph Loop: 20次循环压力测试 — 先生(匠心传承5年缴) + 小姐(守护家倍198) 综合方案
测试稳定性: 上传 → 提取 → 生成 完整流水线
"""
import subprocess
import time
import json
import sys
import os
from pathlib import Path

ROOT = Path("/Users/soldier/free-code/packages/insurance-ppt")
MR_PDF = ROOT / "uploads/f1e275a3_匠心傳承儲蓄計劃2尊尚版.pdf"
MS_PDF = ROOT / "uploads/9e0b3eb1_守護家倍198.pdf"
SERVER = "http://localhost:3000"
OUT_DIR = ROOT / "public/downloads"
OUT_DIR.mkdir(exist_ok=True)

def upload_pdfs(pdfs):
    """Upload PDFs, return sessionId"""
    import urllib.request
    
    boundary = "----FormBoundary7MA4YWxkTrZu0gW"
    body_parts = []
    
    for pdf_path, ptype in pdfs:
        with open(pdf_path, "rb") as f:
            content = f.read()
        fname = pdf_path.name
        body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{fname}"\r\nContent-Type: application/pdf\r\n\r\n'.encode())
        body_parts.append(content + b'\r\n')
        body_parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="types"\r\n\r\n{ptype}\r\n'.encode())
    
    body_parts.append(f'--{boundary}--\r\n'.encode())
    body = b''.join(body_parts)
    
    req = urllib.request.Request(
        f"{SERVER}/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["sessionId"]

def parse(session_id):
    import urllib.request
    req = urllib.request.Request(
        f"{SERVER}/api/parse/{session_id}",
        data=b"",
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())

def generate(session_id, style="modern"):
    import urllib.request
    req = urllib.request.Request(
        f"{SERVER}/api/generate/{session_id}",
        data=json.dumps({"style": style}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())

def run_iteration(i):
    """Run one full pipeline iteration"""
    start = time.time()
    label = f"Iter {i:02d}"
    errors = []
    
    try:
        # 1. Upload
        t0 = time.time()
        sid = upload_pdfs([(MR_PDF, "savings"), (MS_PDF, "ci")])
        print(f"  [{label}] Upload {time.time()-t0:.1f}s session={sid}")
        
        # 2. Parse/extract
        t0 = time.time()
        result = parse(sid)
        parse_time = time.time() - t0
        
        status = result.get("status", "?")
        extractions = result.get("extractions", [])
        parse_errors = [e for e in extractions if e.get("status") == "error"]
        if parse_errors:
            errors.append(f"parse: {[e.get('error','?')[:50] for e in parse_errors]}")
        
        print(f"  [{label}] Parse {parse_time:.1f}s status={status}")
        for e in extractions:
            print(f"    {e['pdfName']}: {e.get('status')} | {e.get('productName','?')} | years={e.get('yearCount',0)}")
        
        # 3. Generate PPT
        t0 = time.time()
        gen_result = generate(sid, style="modern")
        gen_time = time.time() - t0
        
        gen_status = gen_result.get("status", "?")
        download_url = gen_result.get("downloadUrl", "")
        
        ppt_path = ROOT / "public" / download_url.lstrip("/")
        if ppt_path.exists():
            size_kb = ppt_path.stat().st_size // 1024
        else:
            size_kb = 0
            errors.append("PPT file not found")
        
        total = time.time() - start
        ok = len(errors) == 0 and size_kb > 50
        icon = "✅" if ok else "❌"
        print(f"  [{label}] Gen {gen_time:.1f}s {gen_status} {size_kb}KB {icon}")
        if errors:
            print(f"  [{label}] ERRORS: {errors}")
        
        return {
            "iteration": i,
            "ok": ok,
            "parse_time": round(parse_time, 1),
            "gen_time": round(gen_time, 1),
            "total_time": round(total, 1),
            "size_kb": size_kb,
            "errors": errors
        }
        
    except Exception as e:
        print(f"  [{label}] EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return {
            "iteration": i,
            "ok": False,
            "error": str(e),
            "total_time": round(time.time() - start, 1)
        }

def main():
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    print(f"🚀 Ralph Loop: {N} iterations — 先生(匠心傳承5年繳) + 小姐(守護家倍198)")
    print(f"   Server: {SERVER}")
    print(f"   MR: {MR_PDF.name} | MS: {MS_PDF.name}")
    print()
    
    results = []
    for i in range(1, N + 1):
        r = run_iteration(i)
        results.append(r)
        time.sleep(1)
    
    print()
    print("=" * 60)
    print("RALPH LOOP SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for r in results if r.get("ok"))
    failed = N - passed
    
    parse_times = [r["parse_time"] for r in results if "parse_time" in r]
    gen_times = [r["gen_time"] for r in results if "gen_time" in r]
    total_times = [r["total_time"] for r in results if "total_time" in r]
    sizes = [r["size_kb"] for r in results if "size_kb" in r]
    
    print(f"Total:    {N} iterations")
    print(f"Passed:   {passed} ✅")
    print(f"Failed:   {failed} ❌")
    if parse_times:
        print(f"Parse:    avg={sum(parse_times)/len(parse_times):.1f}s | min={min(parse_times):.1f}s | max={max(parse_times):.1f}s")
    if gen_times:
        print(f"Gen:      avg={sum(gen_times)/len(gen_times):.1f}s | min={min(gen_times):.1f}s | max={max(gen_times):.1f}s")
    if total_times:
        print(f"Total:    avg={sum(total_times)/len(total_times):.1f}s | min={min(total_times):.1f}s | max={max(total_times):.1f}s")
    if sizes:
        print(f"PPT size: avg={sum(sizes)/len(sizes):.0f}KB | min={min(sizes)}KB | max={max(sizes)}KB")
    
    failed_results = [r for r in results if not r.get("ok")]
    if failed_results:
        print()
        print("FAILED DETAIL:")
        for r in failed_results:
            errs = r.get("errors", [r.get("error", "?")])
            print(f"  Iter {r['iteration']}: {errs}")
    
    print()
    if failed == 0:
        print(f"🎉 ALL {N} PASSED — Pipeline stable!")
    else:
        print(f"⚠️  {failed}/{N} FAILED — needs fix before content-planner work")
    
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())