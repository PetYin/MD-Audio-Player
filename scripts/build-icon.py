"""Render the project's geometric wave mark to the Windows icon container."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
size, scale = 256, 4
image = Image.new("RGBA", (size * scale, size * scale))
draw = ImageDraw.Draw(image)
def box(values): return tuple(int(v * scale) for v in values)
draw.rounded_rectangle(box((8,8,248,248)), radius=58*scale, fill="#111418")
draw.line([(x*scale,y*scale) for x,y in [(128,35),(221,128),(128,221),(35,128),(128,35)]], fill="#D6B66F", width=5*scale, joint="curve")
for x, top, bottom in [(83,109,147),(113,84,172),(143,61,197),(173,106,152)]:
    draw.rounded_rectangle(box((x-6.5,top-6.5,x+6.5,bottom+6.5)),radius=6.5*scale,fill="#D6B66F")
image = image.resize((size,size),Image.Resampling.LANCZOS)
image.save(root/"resources"/"icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.save(root/"resources"/"icon.png")
