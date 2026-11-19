#!/usr/bin/env python3
"""构建期：为所有预置厂商下载官方图标 → assets/logos/<id>.png（128×128，透明背景，HiDPI 清晰）。
候选：官网 <link rel=apple-touch-icon|icon> → /apple-touch-icon.png → Google s2 favicons(256) → DuckDuckGo。
每张图用 PIL 解码校验（≥32px、非全透明/纯色），失败则跳过（运行时回退首字母头像）。"""
import io, json, re, subprocess, sys, urllib.request, urllib.parse, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'logos'); os.makedirs(OUT, exist_ok=True)
meta = json.loads(subprocess.check_output(['node', '-e', 'process.stdout.write(JSON.stringify(require("./src/core/brandmeta").BRAND_META))'], cwd=ROOT))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'}
def get(u, t=12):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r: return r.read(3_000_000), r.headers.get('content-type', '')
    except Exception: return None, ''
def decode(b, ct, u):
    if not b: return None
    if b'<svg' in b[:800] or 'svg' in ct or u.endswith('.svg'):
        try:
            p = subprocess.run(['convert', '-background', 'none', '-density', '600', 'svg:-', '-resize', '256x256', 'png:-'], input=b, capture_output=True, timeout=30)
            b = p.stdout
        except Exception: return None
    try:
        im = Image.open(io.BytesIO(b))
        if getattr(im, 'n_frames', 1) > 1 or im.format == 'ICO':
            best = None
            for s in sorted(getattr(im, 'ico', None).sizes() if im.format == 'ICO' else [im.size], reverse=True):
                if im.format == 'ICO': im.size = s
                best = im; break
            im = best
        im = im.convert('RGBA')
    except Exception: return None
    if min(im.size) < 32: return None
    ex = im.getextrema()
    if ex[3][1] == 0 or all(e[0] == e[1] for e in ex[:3]) and ex[3][0] == ex[3][1]: return None
    return im
def candidates(dom):
    if '/' in dom: dom = dom.split('/')[0]
    html, _ = get('https://' + dom + '/')
    c = []
    if html:
        h = html.decode('utf-8', 'ignore')
        for m in re.finditer(r'<link[^>]+>', h, re.I):
            tag = m.group(0); rel = re.search(r'rel=["\']([^"\']+)', tag, re.I); href = re.search(r'href=["\']([^"\']+)', tag, re.I)
            if not rel or not href or 'icon' not in rel.group(1).lower() or 'mask' in rel.group(1).lower(): continue
            sz = re.search(r'sizes=["\'](\d+)', tag); score = int(sz.group(1)) if sz else (180 if 'apple' in rel.group(1).lower() else (300 if href.group(1).endswith('.svg') else 32))
            c.append((score, urllib.parse.urljoin('https://' + dom + '/', href.group(1).replace('&amp;', '&'))))
    c.sort(reverse=True)
    out = [u for _, u in c] + ['https://' + dom + '/apple-touch-icon.png']
    out += ['https://www.google.com/s2/favicons?domain=%s&sz=256' % dom, 'https://icons.duckduckgo.com/ip3/%s.ico' % dom]
    return out
report = {}
ALT = {'ms-copilot': ['copilot.microsoft.com', 'www.microsoft.com/en-us/microsoft-copilot', 'bing.com'], 'kimi': ['kimi.com', 'kimi.moonshot.cn', 'moonshot.ai'], 'spark': ['xfyun.cn', 'xinghuo.xfyun.cn'], 'minimax': ['minimax.io', 'hailuoai.com', 'minimaxi.com'], 'dyson': ['dyson.com', 'dyson.co.uk', 'dyson.cn'], 'lenovo': ['lenovo.com', 'lenovo.com.cn'], 'sony': ['sony.com', 'sony.net'], 'adidas': ['adidas.com', 'adidas.com.cn']}
only = sys.argv[1:]
for bid, m in meta.items():
    if only and bid not in only: continue
    got = None
    for dom in ALT.get(bid, [m['domain']]):
        for u in candidates(dom):
            b, ct = get(u)
            im = decode(b, ct, u)
            if im and (got is None or min(im.size) > min(got[0].size)): got = (im, u)
            if got and min(got[0].size) >= 96: break
        if got and min(got[0].size) >= 96: break
    if not got: report[bid] = None; print('FAIL', bid); continue
    im, u = got
    bbox = im.getbbox(); im = im.crop(bbox) if bbox else im
    w, h = im.size; s = max(w, h); canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0)); canvas.paste(im, ((s - w) // 2, (s - h) // 2))
    canvas = canvas.resize((128, 128), Image.LANCZOS)
    canvas.save(os.path.join(OUT, bid + '.png'), optimize=True)
    report[bid] = {'src': u, 'orig': list(got[0].size)}
    print('OK', bid, got[0].size, u[:90])
old = json.load(open(os.path.join(OUT, 'sources.json'))) if os.path.exists(os.path.join(OUT, 'sources.json')) else {}
old.update(report); report = old
json.dump(report, open(os.path.join(OUT, 'sources.json'), 'w'), indent=1)
