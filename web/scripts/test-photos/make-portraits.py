# Makes the stand-in test pictures (a head-and-shoulders illustration with photo grain) for scripts/shoot-pages.mjs: python make-portraits.py
from PIL import Image, ImageDraw, ImageFilter
import random, math
random.seed(7)
def portrait(w,h,name,face_cy):
    # studio-style stand-in: soft grey-blue backdrop, shoulders, neck, head, hair; blurred + grain. Face centre at face_cy*h.
    S=2
    W,H=w*S,h*S
    im=Image.new('RGB',(W,H))
    px=im.load()
    d=ImageDraw.Draw(im)
    for y in range(H):
        t=y/H
        c=(int(150-40*t),int(165-45*t),int(185-50*t))
        d.line([(0,y),(W,y)],fill=c)
    u=min(W,H)
    cx=W*0.5; cy=H*face_cy
    hr=u*0.17
    # shoulders
    d.ellipse([cx-u*0.46,cy+hr*1.9,cx+u*0.46,cy+hr*1.9+u*0.8],fill=(40,52,78))
    # shirt collar
    d.polygon([(cx-hr*0.6,cy+hr*1.9),(cx+hr*0.6,cy+hr*1.9),(cx,cy+hr*3.0)],fill=(232,232,236))
    # neck
    d.rectangle([cx-hr*0.42,cy+hr*0.7,cx+hr*0.42,cy+hr*2.1],fill=(196,146,116))
    # hair back
    d.ellipse([cx-hr*1.12,cy-hr*1.25,cx+hr*1.12,cy+hr*1.0],fill=(36,26,22))
    # face
    d.ellipse([cx-hr*0.86,cy-hr*1.0,cx+hr*0.86,cy+hr*1.15],fill=(214,164,132))
    # fringe
    d.pieslice([cx-hr*0.95,cy-hr*1.2,cx+hr*0.95,cy+hr*0.5],180,360,fill=(36,26,22))
    # eyes, brows, mouth
    for s in(-1,1):
        d.ellipse([cx+s*hr*0.36-hr*0.11,cy-hr*0.12,cx+s*hr*0.36+hr*0.11,cy+hr*0.04],fill=(250,248,246))
        d.ellipse([cx+s*hr*0.36-hr*0.055,cy-hr*0.1,cx+s*hr*0.36+hr*0.055,cy+hr*0.02],fill=(50,34,28))
        d.line([cx+s*hr*0.6,cy-hr*0.3,cx+s*hr*0.2,cy-hr*0.27],fill=(40,28,24),width=int(hr*0.05))
    d.line([cx,cy-hr*0.05,cx-hr*0.06,cy+hr*0.35],fill=(176,122,96),width=int(hr*0.04))
    d.arc([cx-hr*0.3,cy+hr*0.38,cx+hr*0.3,cy+hr*0.7],20,160,fill=(150,70,70),width=int(hr*0.06))
    im=im.filter(ImageFilter.GaussianBlur(S*1.6)).resize((w,h),Image.LANCZOS)
    px=im.load()
    for y in range(h):
        for x in range(w):
            n=random.randint(-9,9); r,g,b=px[x,y]; px[x,y]=(max(0,min(255,r+n)),max(0,min(255,g+n)),max(0,min(255,b+n)))
    im.save(name,quality=88)
portrait(600,800,'portrait.jpg',0.33)
portrait(900,600,'landscape.jpg',0.40)
portrait(700,700,'square.jpg',0.36)
