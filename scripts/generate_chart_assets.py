#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

def _safe_name(s: str) -> str:
    keep = []
    for ch in s:
        if ch.isalnum() or ch in ("-", "_"):
            keep.append(ch)
        else:
            keep.append("_")
    return "".join(keep).strip("_") or "plan"

def _render_with_plotly(x, y1, y2, title, out_path):
    import plotly.graph_objects as go
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=x, y=y1, mode="lines+markers", name="总退保价值"))
    if y2:
      fig.add_trace(go.Scatter(x=x, y=y2, mode="lines+markers", name="已缴保费"))
    fig.update_layout(
      title=title,
      paper_bgcolor="#0b1b2b",
      plot_bgcolor="#0f2740",
      font=dict(color="#EAF2FF"),
      margin=dict(l=50, r=30, t=60, b=50),
      height=560,
      width=1000,
    )
    fig.update_xaxes(gridcolor="#2a4261")
    fig.update_yaxes(gridcolor="#2a4261")
    fig.write_image(out_path, scale=2)

def _render_with_matplotlib(x, y1, y2, title, out_path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#f8fbff")
    ax.plot(x, y1, color="#2f6fb2", marker="o", linewidth=2.6, label="总退保价值")
    if y2:
      ax.plot(x, y2, color="#b8893c", marker="s", linewidth=2.2, label="已缴保费")
    ax.set_title(title, color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a")
    for s in ax.spines.values():
      s.set_color("#d2dfec")
    ax.grid(color="#d7e3ef", alpha=0.8)
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    fig.tight_layout()
    fig.savefig(out_path, dpi=180)
    plt.close(fig)

def _render_stacked(yrs, g, ng, title, out_path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#f8fbff")
    ax.bar(yrs, g, color="#2f6fb2", label="保证")
    ax.bar(yrs, ng, bottom=g, color="#d3a35b", label="非保证")
    ax.set_title(title, color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a")
    ax.grid(axis="y", color="#d7e3ef", alpha=0.7)
    for s in ax.spines.values():
      s.set_color("#d2dfec")
    ax.legend(facecolor="#ffffff", edgecolor="#d2dfec", labelcolor="#23415f")
    fig.tight_layout()
    fig.savefig(out_path, dpi=180)
    plt.close(fig)

def _render_radar(labels, values, title, out_path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    import numpy as np
    n = len(labels)
    if n < 3:
      return
    angles = np.linspace(0, 2*np.pi, n, endpoint=False).tolist()
    values = values + values[:1]
    angles = angles + angles[:1]
    fig = plt.figure(figsize=(6.2, 6.2), facecolor="#ffffff")
    ax = plt.subplot(111, polar=True)
    ax.set_facecolor("#f8fbff")
    ax.plot(angles, values, color="#2f6fb2", linewidth=2.2)
    ax.fill(angles, values, color="#2f6fb2", alpha=0.2)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(labels, color="#35506a")
    ax.set_yticklabels([])
    ax.set_title(title, color="#17324d", y=1.08, fontweight="bold")
    fig.tight_layout()
    fig.savefig(out_path, dpi=180)
    plt.close(fig)

def _render_cashflow(yrs, vals, title, out_path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    matplotlib.rcParams["font.sans-serif"] = ["Arial Unicode MS", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False
    fig, ax = plt.subplots(figsize=(8.2, 4.6))
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#f8fbff")
    bars = ["#c79a4e" if v < 0 else "#2f9f8d" for v in vals]
    ax.bar(yrs, vals, color=bars)
    ax.axhline(0, color="#8aa2b8", linewidth=1)
    ax.set_title(title, color="#17324d", fontsize=14, fontweight="bold")
    ax.tick_params(colors="#35506a")
    for s in ax.spines.values():
      s.set_color("#d2dfec")
    ax.grid(axis="y", color="#d7e3ef", alpha=0.7)
    fig.tight_layout()
    fig.savefig(out_path, dpi=180)
    plt.close(fig)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="json string")
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    payload = json.loads(args.data)
    exts = payload.get("extractions", [])
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    assets = []
    for idx, e in enumerate(exts):
      data = e.get("data", {}) or {}
      ptype = e.get("planType") or e.get("plan_type") or "savings"
      name = data.get("product_name") or e.get("pdfName") or f"plan_{idx+1}"
      rows = data.get("benefit_illustration", []) or []
      if not rows:
        continue
      display_rows = []
      for r in rows:
        y = r.get("policy_year")
        if y is None:
          continue
        if ptype == "savings" and int(y) > 80:
          continue
        display_rows.append(r)
      x = []
      y_tsv = []
      y_paid = []
      for r in display_rows:
        y = r.get("policy_year")
        x.append(y)
        y_tsv.append(float(r.get("total_surrender_value") or r.get("surrender_value_total") or r.get("non_guaranteed_cash_value") or 0))
        y_paid.append(float(r.get("total_premium_paid") or 0))
      if len(x) < 3:
        continue
      safe = _safe_name(f"{idx+1}_{name}")
      out_path = str(out_dir / f"{safe}_growth.png")
      title = f"{name} - 价值增长轨迹"
      _render_with_matplotlib(x, y_tsv, y_paid, title, out_path)
      assets.append({"planType": ptype, "productName": name, "kind": "growth", "path": out_path})

      # 强制图表矩阵：保证/非保证堆叠
      g = [float(r.get("guaranteed_cash_value") or r.get("guaranteed_account_value") or 0) for r in display_rows]
      ng = [max(0.0, float((r.get("reversionary_bonus") or 0) + (r.get("terminal_dividend") or 0) + (r.get("non_guaranteed_cash_value") or 0))) for r in display_rows]
      stacked_path = str(out_dir / f"{safe}_stacked.png")
      _render_stacked(x, g, ng, f"{name} - 保证/非保证结构", stacked_path)
      assets.append({"planType": ptype, "productName": name, "kind": "stacked", "path": stacked_path})

      # 强制图表矩阵：现金流对比（缴费为负，价值变化为正）
      cashflow = []
      last = 0.0
      for i, r in enumerate(display_rows):
        paid = float(r.get("total_premium_paid") or 0)
        cur = y_tsv[i]
        delta = cur - last
        last = cur
        flow = delta - max(0.0, paid - (float(display_rows[i-1].get("total_premium_paid") or 0) if i > 0 else 0.0))
        cashflow.append(flow)
      cf_path = str(out_dir / f"{safe}_cashflow.png")
      _render_cashflow(x, cashflow, f"{name} - 年度净现金流", cf_path)
      assets.append({"planType": ptype, "productName": name, "kind": "cashflow", "path": cf_path})

      # 强制图表矩阵：组合雷达（5维）
      breakeven = None
      total_paid = max(y_paid) if y_paid else 0
      for i, v in enumerate(y_tsv):
        if y_paid[i] > 0 and v >= y_paid[i]:
          breakeven = x[i]
          break
      y20 = 0
      for i, yr in enumerate(x):
        if yr == 20:
          y20 = y_tsv[i]
      radar_vals = [
        min(100, (total_paid / max(1, total_paid)) * 100),
        min(100, (y20 / max(1, total_paid)) * 40),
        100 - min(100, (breakeven or 30) * 3),
        min(100, (max(y_tsv) / max(1, total_paid)) * 20),
        min(100, (len(rows) / 120) * 100),
      ]
      radar_path = str(out_dir / f"{safe}_radar.png")
      _render_radar(["投入规模", "20年收益", "回本速度", "终值潜力", "期限弹性"], radar_vals, f"{name} - 组合雷达", radar_path)
      assets.append({"planType": ptype, "productName": name, "kind": "radar", "path": radar_path})

    print(json.dumps({"assets": assets}, ensure_ascii=False))

if __name__ == "__main__":
    main()
