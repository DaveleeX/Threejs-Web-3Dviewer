"""Encode real browser frame recordings from smoke-out/recordings into hover clips.

Requires Pillow and FFmpeg. Usage: python scripts/build-preview-videos.py --ffmpeg PATH [ids...]
Each recording contains frame files plus timing.json: [{"file": "frame-0000.png", "t": 0.0}].
"""
import argparse
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
INFO = {
    'materials': ('材质实验室', '金属、玻璃与陶瓷 · 实时材质和光影', (32, 180, 1210, 532)),
    'iron-front': ('废土战线', '驾驶装甲战车 · 探索三维战场', (32, 135, 1210, 620)),
    'armour-atlas': ('装甲蓝图', '程序化坦克 · 结构分解与蓝图展示', (32, 135, 1210, 620)),
    'tank-museum': ('微缩坦克博物馆', '五个微缩展区 · 沉浸式三维导览', (32, 135, 1210, 620)),
    'drink-and-run': ('喝一杯就撤', '午夜吧台 · 玻璃、酒液与实时光影', (32, 135, 1210, 620)),
    '6XoBH': ('Cyberpunk City', '霓虹城市 · 赛博朋克建筑场景', (0, 0, 1280, 720)),
    '6UnGs': ('Ironman Prototype', '机械原型 · 金属结构与细节展示', (0, 0, 1280, 720)),
    '6xzEA': ('A wheel of Lamborghini', '轮毂与制动系统 · 汽车部件细节', (0, 0, 1280, 720)),
    '6XqEI': ('Venom', '毒液角色 · 造型、材质与动画展示', (0, 0, 1280, 720)),
}

def build(key, ffmpeg):
    title, description, crop = INFO[key]
    folder = ROOT / 'smoke-out' / 'recordings' / key
    frames = json.loads((folder / 'timing.json').read_text())
    # Preserve the actual sampling times instead of speeding up slow captures.
    lines = ['ffconcat version 1.0']
    for i, frame in enumerate(frames):
        end = frames[i+1]['t'] if i+1 < len(frames) else frame['t'] + 1/24
        lines += [f"file '{frame['file']}'", f"duration {max(0.001, end-frame['t']):.6f}"]
    lines += [f"file '{frames[-1]['file']}'"]
    listing = folder / 'frames.ffconcat'
    listing.write_text('\n'.join(lines), encoding='utf-8')
    overlay = Image.new('RGBA', (960, 540))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 21)
    small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
    width = max(draw.textlength(title, font=font), draw.textlength(description, font=small)) + 40
    draw.rounded_rectangle((22, 22, 22+width, 101), radius=12, fill=(5, 10, 18, 205))
    draw.text((40, 32), title, font=font, fill=(238, 245, 255))
    draw.text((40, 66), description, font=small, fill=(174, 201, 224))
    overlay.save(folder / 'caption.png')
    output = ROOT / 'public' / 'projects' / 'previews' / f'{key}.mp4'
    output.parent.mkdir(parents=True, exist_ok=True)
    x, y, w, h = crop
    filters = f'[0:v]crop={w}:{h}:{x}:{y},scale=960:540:force_original_aspect_ratio=increase,crop=960:540,setsar=1,fps=24[scene];[scene][1:v]overlay=0:0,format=yuv420p[out]'
    subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), '-i', str(folder/'caption.png'), '-filter_complex', filters, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-movflags', '+faststart', str(output)], check=True)
    print(f'{key}: {len(frames)} frames, {frames[-1]["t"]:.1f}s, {output.stat().st_size//1024} KiB', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('ids', nargs='*')
    args = parser.parse_args()
    for key in args.ids or INFO:
        build(key, args.ffmpeg)
